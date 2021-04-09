var serverReconnecting;
var ibbqConnectedDot;
var ibbqBatteryValue;
var ibbqProbeTemps;
var chart;

function connectWebsocket() {
   var ws = new WebSocket("ws://" + window.location.host + "/ws")

   ws.onopen = function(event) {
      if (!serverReconnecting.classList.contains("hidden")) {
         console.log("websocket opened")
         serverReconnecting.classList.add("hidden")
         ibbqConnectedDot.classList.remove("gray-dot")
      }
   }

   ws.onclose = function(event) {
      if (serverReconnecting.classList.contains("hidden")) {
         console.warn("websocket closed: [" + event.code + "]")
         serverReconnecting.classList.remove("hidden")
         ibbqConnectedDot.classList.add("gray-dot")
      }
      setTimeout(connectWebsocket, 1000)
   }

   ws.onmessage = function (event) {
      data = JSON.parse(event.data)

      if (data.connected) {
         ibbqConnectedDot.classList.add("green-dot")
      } else {
         ibbqConnectedDot.classList.remove("green-dot")
      }

      if (data.batteryLevel == null) {
         ibbqBatteryValue.textContent = "Unknown"
      } else if (data.batteryLevel == 0xffff) {
         ibbqBatteryValue.textContent = "Charging"
      } else {
         ibbqBatteryValue.textContent = data.batteryLevel + "%"
      }

      var now = new Date()
      for (var i = 0; i < data.probeTemperatures.length; i++) {
         var temp = data.probeTemperatures[i]
         var tempStr = temp ? temp + "\u00b0" + data.unit : "Disconnected"

         if (chart.options.data.length < i + 1) {
            chart.options.data.push({
               type: "line",
               markerType: "none",
               name: "Probe " + (i+1),
               legendText: "Probe " + (i+1),
               dataPoints: [],
            })
         }

         if (temp != null || data.connected) {
            chart.options.data[i].dataPoints.push({
               x: now,
               y: temp,
            })
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
   }
}

document.onreadystatechange = function() {
   if (document.readyState === "complete") {
      serverReconnecting = document.getElementById("server_reconnecting");
      ibbqConnectedDot = document.querySelector("#ibbq_connected .dot");
      ibbqBatteryValue = document.querySelector("#ibbq_battery .value");
      ibbqProbeTemps = document.getElementById("ibbq_probe_temps");

      var options = {
         animationEnabled: true,
         legend: {
            cursor:"pointer",
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
         },
         data: [],
      };
      chart = new CanvasJS.Chart("chart_container", options);

      connectWebsocket();
   }
}
