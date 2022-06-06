var ws;
var serverDisconnectedBanner;
var ibbqConnection;
var ibbqBattery;
var ibbqUnitCelcius;
var chart;
var tempAlertModal;
var inSilenceAlarmHandler = false;

var alertAudio = new Audio('/assets/audio/AlertTone.mp3');

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

function tempCurUnittoC(temp) {
   if (temp != null && !ibbqUnitCelcius.checked) {
      return FtoC(temp);
   }
   return temp;
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
}

function updateUnit() {
   ibbqUnitCelcius.labels.forEach(label =>
      label.textContent = ibbqUnitCelcius.checked ?
         label.dataset.on : label.dataset.off
   )

   for (var i = 0; i < chart.options.data.length; i++) {
      var dataSeries = chart.options.data[i];
      for (var j = 0; j < dataSeries.dataPoints.length; j++) {
         var dataPoint = dataSeries.dataPoints[j]
         dataPoint.y = tempCtoCurUnit(dataPoint.tempC)
      }
   }
   chart.options.axisY.maximum = ibbqUnitCelcius.checked ? 310 : 600;
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
   var probe = parseInt(probeIdx)
   if (isNaN(probe)) {
      return
   }

   if (ws.readyState != 1) {
      // Not connected
      return
   }
   ws.send(JSON.stringify({
      cmd: 'set_probe_target_temp',
      probe: probe,
      preset: null,
      min_temp: null,
      max_temp: null,
   }))

   bootstrap.Modal.getInstance(
      document.getElementById('probeSettingsModal')
   ).hide()
}

function saveProbeTarget() {
   var probeIdx = document.getElementById('probe-settings-index').value
   var probe = parseInt(probeIdx)
   if (isNaN(probe)) {
      return
   }

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
      if (ws.readyState != 1) {
         // Not connected
         return
      }
      ws.send(JSON.stringify({
         cmd: 'set_probe_target_temp',
         probe: probe,
         preset: preset,
         min_temp: isNaN(min) ? null : tempCurUnittoC(min),
         max_temp: tempCurUnittoC(max),
      }))

      bootstrap.Modal.getInstance(
         document.getElementById('probeSettingsModal')
      ).hide()
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

function appendChartData(probeReading) {
   var ts = new Date(probeReading.ts);

   // When the temp remains the same, we just need the first/last timestamps
   // of those values to draw a straight line.
   //
   // Because the tooltip is shared across all data sets, we need to add a
   // datapoint to all data sets any time one temp changes so the toolip
   // shows all temps
   lastReadings = chart.options.data.map(d => d.dataPoints.slice(-2))
   duplicateReading =
      lastReadings.length == probeReading.probes.length &&
      lastReadings.every(dp => dp.length == 2) &&
      lastReadings.every((dp, i) =>
         probeReading['probes'][i] == dp[1].tempC && dp[1].tempC == dp[0].tempC
      );

   for (var i = 0; i < probeReading.probes.length; i++) {
      var tempC = probeReading.probes[i]

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

      chart.options.data[i].legendText =
         tempC != null ? tempCtoCurUnit(tempC) + "°" : "N/A"

      if (duplicateReading) {
         lastReadings[i][1].x = ts;
      } else {
         chart.options.data[i].dataPoints.push({
            x: ts,
            y: tempCtoCurUnit(tempC),
            tempC: tempC,
         })
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
   if (window.location.protocol == "https:") {
      protocol = "wss://"
   } else {
      protocol = "ws://"
   }
   ws = new WebSocket(protocol + window.location.host + "/ws")

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

      if (data.cmd == "state_update") {
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
         if (data.battery_level == null) {
            ibbqBattery.textContent = "--"
            ibbqBattery.classList.add('bi-battery')
         } else if (data.battery_level == 0xffff) {
            ibbqBattery.textContent = "--"
            ibbqBattery.classList.add('bi-battery-charging', 'text-warning')
         } else {
            ibbqBattery.textContent = data.battery_level + "%"
            if (data.battery_level <= 10) {
               ibbqBattery.classList.add('bi-battery', 'text-danger')
            } else if (data.battery_level >= 90) {
               ibbqBattery.classList.add('bi-battery-full')
            } else {
               ibbqBattery.classList.add('bi-battery-half')
            }
         }

         /*
          * Update probe data (probe and chart tabs)
          */
         if (data.full_history) {
            // Reset chart
            chart.options.data = [];
            chart.options.axisY.stripLines = [];
            var xMin = new Date();
            for (var i = 0; i < data.probe_readings.length; i++) {
               var reading = data.probe_readings[i];
               if (reading.probes.some(temp => temp != null)) {
                  xMin = new Date(reading.ts);
                  break;
               }
            }
            var xMax = new Date(xMin.getTime() + (10 * 60 * 1000)); // +10 min
            chart.options.axisX.minimum = xMin;
            chart.options.axisX.maximum = xMax;
         }

         if (data.full_history || data.connected) {
            for (var i = 0; i < data.probe_readings.length; i++) {
               appendChartData(data.probe_readings[i]);
            }
            chart.render();

            for (var i = 0; i < data.probe_readings[0].probes.length; i++) {
               var probeContainer = document.getElementById('probe-container-' + i)
               var targetTemp = data.target_temps[i]

               if (targetTemp !== undefined) {
                  if (targetTemp.preset == null) {
                     probeContainer.removeAttribute('data-ibbq-preset')
                  } else {
                     probeContainer.setAttribute('data-ibbq-preset', targetTemp.preset)
                  }

                  if (targetTemp.min_temp == null) {
                     probeContainer.removeAttribute('data-ibbq-temp-min')
                  } else {
                     probeContainer.setAttribute('data-ibbq-temp-min',
                                                 tempCtoCurUnit(targetTemp.min_temp))
                  }

                  if (targetTemp.max_temp == null) {
                     probeContainer.removeAttribute('data-ibbq-temp-max')
                  } else {
                     probeContainer.setAttribute('data-ibbq-temp-max',
                                                 tempCtoCurUnit(targetTemp.max_temp))
                  }
               } else {
                  probeContainer.removeAttribute('data-ibbq-preset')
                  probeContainer.removeAttribute('data-ibbq-temp-min')
                  probeContainer.removeAttribute('data-ibbq-temp-max')
               }

               updateProbeTempTarget(i)
            }

            /*
             * Update target temp alert
             */
            if (data.target_temp_alert) {
               tempAlertModal.show();
            } else {
               inSilenceAlarmHandler = true;
               tempAlertModal.hide();
               inSilenceAlarmHandler = false;
            }
         }
      } else if (data.cmd == "unit_update") {
         ibbqUnitCelcius.checked = (data.unit == "C");
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

      alertAudio.muted = true;
      alertAudio.play().catch(error => {
         var modalEl = document.getElementById('audioNoticeModal');
         var modal = new bootstrap.Modal(modalEl);
         modal.show();
         return new Promise((resolve, reject) => {
            modalEl.addEventListener('hide.bs.modal', event => {
               alertAudio.muted = true;
               alertAudio.play().then(() => {
                  resolve();
               }).catch(error => {
                  reject(error);
               })
            });
         })
      }).then(() => {
         alertAudio.pause();
         alertAudio.currentTime = 0;
         alertAudio.muted = false;
         alertAudio.loop = true;
      }).catch(error => {
         alert("Audio notifications are blocked by your browser, please " +
               "check browser documentation for details:\n\n" + error);
      });

      var tempAlertModalEl = document.getElementById('tempAlertModal');
      tempAlertModal = new bootstrap.Modal(tempAlertModalEl);
      tempAlertModalEl.addEventListener('hide.bs.modal', event => {
         alertAudio.pause();
         alertAudio.currentTime = 0;

         if (ws.readyState != 1) {
            // Not connected
            return;
         }

         if (inSilenceAlarmHandler) {
            return;
         }

         ws.send(JSON.stringify({
            cmd: 'silence_alarm',
         }))
      })
      tempAlertModalEl.addEventListener('show.bs.modal', event => {
         alertAudio.play();
      })

      connectWebsocket();
   }
}
