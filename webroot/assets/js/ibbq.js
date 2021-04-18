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

function CreateElement(tag, props) {
   var e = $('<' + tag + '>');
   for (var k in props) {
      switch(k) {
         case 'class':
            e.addClass(props[k]);
            break;
         case 'change':
         case 'click':
         case 'keyup':
            e.on(k, props[k]);
            break;
         case 'textContent':
            e.text(props[k]);
            break;
         case 'htmlContent':
            e.html(props[k]);
            break;
         default:
            e.attr(k, props[k]);
            break;
      }
   }
   return e;
}

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
         for (var i = 0; i < data.probeTemperaturesC.length; i++) {
            var tempC = data.probeTemperaturesC[i]
            
            var probecontainer = document.getElementById('probe-container-' + i)
            if (probecontainer == null) {
               var template = document.getElementById('probe-container-template')
               probecontainer = template.content.firstElementChild.cloneNode(true)

               probecontainer.id = 'probe-container-' + i
               probecontainer.querySelector('.probe-idx .dot').textContent = i
               document.getElementById('probe-list').append(probecontainer);
            }

            probecontainer.querySelector('.probe-temp-current').innerHTML =
               (tempC != null ? tempCtoCurUnit(tempC) + "&deg;" : "--")

            if (chart.options.data.length < i + 1) {
               chart.options.data.push({
                  type: "line",
                  markerType: "none",
                  name: "Probe " + (i+1),
                  showInLegend: true,
                  legendText: "N/A",
                  color: i <= probeColors.length ? probeColors[i] : "#000",
                  dataPoints: [],
               })
            }

            if (tempC != null || data.connected) {
               chart.options.data[i].dataPoints.push({
                  x: now,
                  y: tempCtoCurUnit(tempC),
                  tempC: tempC,
               })
               chart.options.data[i].legendText = 
                  tempC != null ? tempCtoCurUnit(tempC) + "°" : "N/A"
            }
         }

         if (now >= chart.options.axisX.maximum) {
            // Increase by 25%
            var min = chart.options.axisX.minimum.getTime()
            var max = chart.options.axisX.maximum.getTime()
            var newmax = new Date(min + ((max-min) * 1.25))
            chart.options.axisX.maximum = new Date(newmax)
         }

         chart.render();
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
