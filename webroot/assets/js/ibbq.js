var ws;
var serverDisconnectedBanner;
var ibbqConnection;
var ibbqBattery;
var ibbqUnitCelcius;
var chart;

// Match .probe-container:nth-child(...) .probe-idx .dot
var probeColors = [
  "#357bcc",
  "#32a852",
  "#d4872a",
  "#bdb320",
]
var STRIPLINE_TEMP_OPACITY = 0.5
var STRIPLINE_RANGE_OPACITY = 0.15

function CtoF(temp) {
   return (temp * 9 / 5) + 32
}

function FtoC(temp) {
   return (temp - 32) * 5 / 9
}

function tempCtoCurUnit(tempC) {
   if (tempC != null && !ibbqUnitCelcius.checked) {
      return CtoF(tempC);
   }
   return tempC;
}

function setUnit() {
   if (ws.readyState != 1) {
      // Not connected
      return
   }
   ws.send(JSON.stringify({
      cmd: 'set_unit',
      unit: this.checked ? 'C' : 'F',
   }))

   updateUnit()
}

function updateUnit() {
   for (var i = 0; i < chart.options.data.length; i++) {
      var dataSeries = chart.options.data[i];
      for (var j = 0; j < dataSeries.dataPoints.length; j++) {
         var dataPoint = dataSeries.dataPoints[j]
         dataPoint.y = tempCtoCurUnit(dataPoint.tempC)
      }
   }
   if (ibbqUnitCelcius.checked) {
      chart.options.axisY.maximum = 310
   } else {
      chart.options.axisY.maximum = 600
   }
   chart.render()
}

// TODO: support Celcius presets too
function updatePreset() {
   var probeTempMin = document.getElementById('probe-temp-min')
   var probeTempMax = document.getElementById('probe-temp-max')

   var preset = document.querySelector('#probe-preset option:checked')
   if (preset.value == 'custom.temp') {
      probeTempMin.disabled = true
      probeTempMin.value = null
      probeTempMax.disabled = false
   } else if (preset.value == 'custom.range') {
      probeTempMin.disabled = false
      probeTempMax.disabled = false
   } else {
      probeTempMin.disabled = true
      probeTempMin.value = preset.getAttribute('data-ibbq-target-min')
      probeTempMax.disabled = true
      probeTempMax.value = preset.getAttribute('data-ibbq-target-max')
   }
}

function clearProbeTarget() {
   var probeIdx = document.getElementById('probe-settings-index').value
   var probeContainer = document.getElementById('probe-container-' + probeIdx)
   probeContainer.removeAttribute('data-ibbq-preset')
   probeContainer.removeAttribute('data-ibbq-temp-min')
   probeContainer.removeAttribute('data-ibbq-temp-max')

   // TODO: Send clear to server

   bootstrap.Modal.getInstance(
      document.getElementById('probeSettingsModal')
   ).hide()

   updateProbeTempTargetText(probeIdx)
}

function saveProbeTarget() {
   var probeIdx = document.getElementById('probe-settings-index').value
   var probeContainer = document.getElementById('probe-container-' + probeIdx)

   var presetInput = document.getElementById('probe-preset')
   var preset = presetInput.value
   if (preset == '_invalid_') {
      presetInput.classList.add('is-invalid')
      return
   } else {
      presetInput.classList.remove('is-invalid')
   }

   var valid = true
   var minInput = document.getElementById('probe-temp-min')
   var min = parseInt(minInput.value)
   if (!minInput.disabled && isNaN(min)) {
      minInput.classList.add('is-invalid')
      valid = false
   } else {
      minInput.classList.remove('is-invalid')
   }

   var maxInput = document.getElementById('probe-temp-max')
   var max = parseInt(maxInput.value)
   if (isNaN(max) || (!isNaN(min) && min >= max)) {
      maxInput.classList.add('is-invalid')
      valid = false
   } else {
      maxInput.classList.remove('is-invalid')
   }

   if (valid) {
      probeContainer.setAttribute('data-ibbq-preset', preset)
      if (isNaN(min)) {
         probeContainer.removeAttribute('data-ibbq-temp-min')
      } else {
         probeContainer.setAttribute('data-ibbq-temp-min', min)
      }
      probeContainer.setAttribute('data-ibbq-temp-max', max)
      bootstrap.Modal.getInstance(
         document.getElementById('probeSettingsModal')
      ).hide()

      updateProbeTempTarget(probeIdx)

      // TODO: Send set to server
   }
}

function updateProbeTempTarget(probeIdx) {
   var probeContainer = document.getElementById('probe-container-' + probeIdx)
   var min = parseInt(probeContainer.getAttribute('data-ibbq-temp-min'))
   var max = parseInt(probeContainer.getAttribute('data-ibbq-temp-max'))

   /*
    * Update temp-target text on Probes tab
    */
   probeContainer.querySelector('.probe-temp-target').innerHTML =
      isNaN(max) ? '&nbsp;' :
      isNaN(min) ? max + '&deg;F' :
                   min + '&deg;F ~ ' + max + '&deg;F'

   /*
    * Update stripline on chart
    */
   var sl = chart.options.axisY.stripLines[probeIdx]
   if (isNaN(max)) {
      delete sl.value
      delete sl.startValue
      delete sl.endValue
      sl.opacity = 0
   } else if (isNaN(min)) {
      sl.value = max
      delete sl.startValue
      delete sl.endValue
      sl.opacity = STRIPLINE_TEMP_OPACITY
   } else {
      delete sl.value
      sl.startValue = min
      sl.endValue = max
      sl.opacity = STRIPLINE_RANGE_OPACITY
   }
   chart.render()
}

function appendChartData(ts, probeTemperaturesC) {
   for (var i = 0; i < probeTemperaturesC.length; i++) {
      var tempC = probeTemperaturesC[i]

      var probecontainer = document.getElementById('probe-container-' + i)
      if (probecontainer == null) {
         var template = document.getElementById('probe-container-template')
         probecontainer = template.content.firstElementChild.cloneNode(true)

         probecontainer.id = 'probe-container-' + i
         probecontainer.setAttribute('data-ibbq-probe-idx', i)
         probecontainer.querySelector('.probe-idx .dot').textContent = (i + 1)
         document.getElementById('probe-list').append(probecontainer);
      }

      probecontainer.querySelector('.probe-temp-current').innerHTML =
         tempC === null ? '--' : tempCtoCurUnit(tempC) + "&deg;"

      if (chart.options.data.length < i + 1) {
         var probeColor = i <= probeColors.length ? probeColors[i] : "#000"
         chart.options.data.push({
            type: "line",
            markerType: "none",
            name: "Probe " + (i+1),
            showInLegend: true,
            legendText: "N/A",
            color: probeColor,
            dataPoints: [],
         })

         chart.options.axisY.stripLines.push({
            value: null,
            opacity: 0,
            color: probeColor,
            labelFontColor: probeColor,
            label: "Probe " + (i+1) + " Target",
            labelBackgroundColor: 'transparent',
            labelFormatter: function(e) {
               var sl = e.stripLine
               if (sl.startValue !== null && sl.endValue !== null) {
                  return sl.startValue + '° ~ ' + sl.endValue + '°'
               } else if (sl.value !== null) {
                  return sl.value + '°'
               } else {
                  return ''
               }
            },
         })
      }

      if (tempC != null) {
         chart.options.data[i].dataPoints.push({
            x: ts,
            y: tempCtoCurUnit(tempC),
            tempC: tempC,
         })
         chart.options.data[i].legendText =
            tempC != null ? tempCtoCurUnit(tempC) + "°" : "N/A"
      }
   }

   if (ts >= chart.options.axisX.maximum) {
      // Increase by 25%
      var min = chart.options.axisX.minimum.getTime()
      var max = chart.options.axisX.maximum.getTime()
      var newmax = new Date(min + ((max-min) * 1.25))
      chart.options.axisX.maximum = new Date(newmax)
   }
}

function connectWebsocket() {
   ws = new WebSocket("ws://" + window.location.host + "/ws")

   ws.onopen = function(event) {
      if (serverDisconnectedBanner.classList.contains("show")) {
         console.log("websocket opened")
         serverDisconnectedBanner.classList.remove("show")
         chart.render();
      }
   }

   ws.onclose = function(event) {
      if (!serverDisconnectedBanner.classList.contains("show")) {
         console.warn("websocket closed: [" + event.code + "]")
         serverDisconnectedBanner.classList.add("show")
         ibbqConnection.classList.remove("connected")
         ibbqConnection.classList.remove("disconnected")
         chart.render();
      }
      setTimeout(connectWebsocket, 1000)
   }

   ws.onmessage = function (event) {
      data = JSON.parse(event.data)

      if (data.cmd == "temp_history") {
         /*
          * Reset chart data
          */
         chart.options.data = [];
         chart.options.axisY.stripLines = [];
         var xMin = new Date();
         for (var i = 0; i < data.probeHistory.length; i++) {
            if (data.probeHistory[i].probes.some(temp => temp != null)) {
               xMin = new Date(data.probeHistory[i].ts);
               break;
            }
         }
         var xMax = new Date(xMin.getTime() + (10 * 60 * 1000)); // +10 min
         chart.options.axisX.minimum = xMin;
         chart.options.axisX.maximum = xMax;

         /*
          * Populate chart with historic data from server
          */
         for (var i = 0; i < data.probeHistory.length; i++) {
            var history = data.probeHistory[i];
            appendChartData(new Date(history.ts), history.probes);
         }
         chart.render();
      } else if (data.cmd == "state_update") {
         /*
          * Update connection status
          */
         if (data.connected) {
            ibbqConnection.classList.add("connected")
            ibbqConnection.classList.remove("disconnected")
         } else {
            ibbqConnection.classList.add("disconnected")
            ibbqConnection.classList.remove("connected")
         }

         /*
          * Update battery status
          */
         ibbqBattery.classList.remove(
            'bi-battery',
            'bi-battery-charging',
            'bi-battery-full',
            'bi-battery-half',
            'text-danger',
            'text-warning',
         )
         if (data.batteryLevel == null) {
            ibbqBattery.textContent = "--"
            ibbqBattery.classList.add('bi-battery')
         } else if (data.batteryLevel == 0xffff) {
            ibbqBattery.textContent = "--"
            ibbqBattery.classList.add('bi-battery-charging', 'text-warning')
         } else {
            ibbqBattery.textContent = data.batteryLevel + "%"
            if (data.batteryLevel <= 10) {
               ibbqBattery.classList.add('bi-battery', 'text-danger')
            } else if (data.batteryLevel >= 90) {
               ibbqBattery.classList.add('bi-battery-full')
            } else {
               ibbqBattery.classList.add('bi-battery-half')
            }
         }

         /*
          * Update probe data (probe and chart tabs)
          */
         var now = new Date()
         if (data.connected) {
            appendChartData(new Date(), data.probeTemperaturesC)
            for (var i = 0; i < data.probeTemperaturesC.length; i++) {
               updateProbeTempTarget(i)
            }
            chart.render();
         }
      } else if (data.cmd == "unit_update") {
         $(ibbqUnitCelcius).bootstrapToggle((data.unit == "C") ? "on" : "off")
         updateUnit()
      }
   }
}

document.onreadystatechange = function() {
   if (document.readyState === "complete") {
      serverDisconnectedBanner = document.getElementById("server-disconnected-banner");
      ibbqConnection = document.querySelector("#ibbq-connection");
      ibbqBattery = document.querySelector("#ibbq-battery");
      ibbqUnitCelcius = document.getElementById("ibbq-unit-celcius");
      ibbqUnitCelcius.onchange = setUnit

      document.getElementById('probeSettingsModal').addEventListener(
         'show.bs.modal', function(event) {
            var probeContainer = event.relatedTarget
            while (!probeContainer.classList.contains('probe-container')) {
               probeContainer = probeContainer.parentElement
            }
            var probeIdx = probeContainer.getAttribute('data-ibbq-probe-idx')

            document.getElementById('probe-settings-index').value = probeIdx

            var preset = probeContainer.getAttribute('data-ibbq-preset') || '0'
            document.getElementById('probe-preset').value = preset

            document.getElementById('probe-temp-min').value =
               probeContainer.getAttribute('data-ibbq-temp-min')
            document.getElementById('probe-temp-max').value =
               probeContainer.getAttribute('data-ibbq-temp-max')
         }
      )

      document.getElementById('probe-preset').addEventListener(
         'change', function(event) {
            updatePreset()
         }
      )
      document.getElementById('probeSettingsClear').addEventListener(
         'click', function(event) {
            clearProbeTarget()
         }
      )
      document.getElementById('probeSettingsSave').addEventListener(
         'click', function(event) {
            saveProbeTarget()
         }
      )

      var options = {
         animationEnabled: true,
         legend: {
            cursor: "pointer",
            verticalAlign: "top",
            fontSize: 20,
         },
         toolTip: {
            shared: true,
            contentFormatter: function(e) {
               content =
                  '<div style="font-weight: bold; text-decoration: underline; margin-bottom: 5px;">' +
                     CanvasJS.formatDate(e.entries[0].dataPoint.x, "hh:mm:ss TT") +
                  '</div>';
               for (var entry of e.entries) {
                  if (entry.dataPoint.y === undefined) {
                     continue;
                  }
                  content +=
                     '<span style="font-weight: bold; color: ' + entry.dataSeries.color + ';">' +
                        entry.dataSeries.name + ': ' +
                     '</span>' +
                     entry.dataPoint.y.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
                     '</br>';
               }
               return content;
            },
         },
         zoomEnabled: true,
         axisX: {
            labelAngle: -25,
            labelFontSize: 20,
            labelFormatter: function (e) {
               return CanvasJS.formatDate(e.value, "hh:mm TT")
            },
            minimum: new Date(),
            maximum: new Date(new Date().getTime() + (10 * 60 * 1000)), // +10 min
         },
         axisY: {
            includeZero: true,
            labelFontSize: 20,
            logarithmic: false,
            logarithmBase: 10,
            minimum: 0,
            stripLines: [],
         },
         data: [],
      };
      chart = new CanvasJS.Chart("graph", options);

      // Workaround graph not rendering correct size initially
      document.querySelector('button[aria-controls="graph"]').addEventListener(
         'shown.bs.tab',
         function(event) {
            chart.render();
         }
      );

      connectWebsocket();
   }
}
