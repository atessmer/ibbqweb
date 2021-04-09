var serverReconnecting;
var ibbqConnectedDot;
var ibbqBatteryValue;
var ibbqProbeTemps;

function clearChildren(parent) {
   while (parent.firstChild) {
      parent.removeChild(parent.firstChild);
   }
}

function addListItem(list, text) {
   var li = document.createElement('li')
   var text = document.createTextNode(text)
   li.appendChild(text)
   list.append(li)
}

function connectWebsocket() {
   var ws = new WebSocket("ws://" + window.location.host + "/ws")

   ws.onopen = function(event) {
      if (!serverReconnecting.classList.contains("hidden")) {
         console.log("websocket opened")
         serverReconnecting.classList.add("hidden")
      }
   }

   ws.onclose = function(event) {
      if (serverReconnecting.classList.contains("hidden")) {
         console.warn("websocket closed: [" + event.code + "]")
         serverReconnecting.classList.remove("hidden")
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

      ibbqBatteryValue.textContent =
         data.batteryLevel ? data.batteryLevel + "%" : "Unknown"

      clearChildren(ibbqProbeTemps)
      for (var i in data.probeTemperatures) {
         var temp = data.probeTemperatures[i]
         var tempStr = temp ? temp + "\u00b0" + data.unit : "Disconnected"
         addListItem(ibbqProbeTemps, "[" + i + "] " + tempStr)
      }
   };
}

document.onreadystatechange = function() {
   if (document.readyState === "complete") {
      serverReconnecting = document.getElementById("server_reconnecting");
      ibbqConnectedDot = document.querySelector("#ibbq_connected .dot");
      ibbqBatteryValue = document.querySelector("#ibbq_battery .value");
      ibbqProbeTemps = document.getElementById("ibbq_probe_temps");

      connectWebsocket();
   }
}
