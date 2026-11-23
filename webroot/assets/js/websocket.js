import * as Utils from './utils.js';

let ws = null;
let reconnectTimeoutId = null;
let reconnectDelay = 1000;
const maxReconnectDelay = 30000;

let opts = {};
let offlineMode = true;

let serverDisconnectedToast = null;
let offlineModeToast = null;

const isConnected = () => ws?.readyState === WebSocket.OPEN;
const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";

const renderToastServerDisconnected = () => {
   const html = `
      <div class="toast align-items-center" role="alert" aria-live="assertive" aria-atomic="true" data-bs-autohide="false">
        <div class="toast-header">
          <i class="bi bi-exclamation-circle-fill me-1 text-danger"></i>
          <strong class="me-auto">Disconnected</strong>
          <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body">
          Reconnecting to server...
        </div>
      </div>
   `;

   return Utils.renderToast(html);
}

const renderToastOfflineMode = () => {
   const html = `
      <div class="toast align-items-center" role="alert" aria-live="assertive" aria-atomic="true" data-bs-autohide="false">
        <div class="toast-header">
          <i class="bi bi-info-circle-fill me-1 text-warning"></i>
          <strong class="me-auto">Disconnected</strong>
          <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="toast" aria-label="Reconnect">Reconnect</button>
          <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body">
          Currently viewing saved data.
        </div>
      </div>
   `;

   const obj = Utils.renderToast(html);
   obj.element.querySelector('[aria-label="Reconnect"]').addEventListener('click', (e) => {
      connect();
   });

   return obj;
}

const _connect = () => {
   if (offlineMode || (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN))) {
      return;
   }

   let socket;
   try {
      socket = new WebSocket(protocol + window.location.host + "/ws");
   } catch (error) {
      console.warn("websocket construction failed", error);
      scheduleReconnect();
      return;
   }
   ws = socket;

   socket.onopen = (e) => {
      if (socket !== ws) return;
      if (reconnectTimeoutId !== null) {
         clearTimeout(reconnectTimeoutId);
         reconnectTimeoutId = null;
      }
      reconnectDelay = 1000;
      if (serverDisconnectedToast || offlineModeToast) {
         serverDisconnectedToast && serverDisconnectedToast.hide();
         serverDisconnectedToast = null;
         offlineModeToast && offlineModeToast.hide();
         offlineModeToast = null;
      }

      if (typeof opts.onopen === 'function') {
          opts.onopen(e);
      }
   };

   socket.onclose = (e) => {
      if (socket !== ws) return;
      e.isDisconnect = false;

      if (offlineMode) {
         serverDisconnectedToast && serverDisconnectedToast.hide();
         serverDisconnectedToast = null;
         offlineModeToast = renderToastOfflineMode().toast;
      } else {
         if (!serverDisconnectedToast) {
            console.warn("websocket closed: [" + e.code + "]")
            offlineModeToast && offlineModeToast.hide();
            offlineModeToast = null;
            serverDisconnectedToast = renderToastServerDisconnected().toast;
            e.isDisconnect = true;
         }
         scheduleReconnect();
      }

      if (typeof opts.onclose === 'function') {
          opts.onclose(e);
      }
   };

   socket.onmessage = (e) => {
      if (socket !== ws) return;
      if (typeof opts.onmessage === 'function') {
         opts.onmessage(e);
      }
   };
};

const scheduleReconnect = () => {
   if (offlineMode || reconnectTimeoutId !== null) {
      return;
   }

   const delay = reconnectDelay;
   reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
   reconnectTimeoutId = setTimeout(() => {
      reconnectTimeoutId = null;
      _connect();
   }, delay);
};

const init = (options={}) => {
   opts = options;
   connect();
}

const connect = () => {
   offlineMode = false;
   if (reconnectTimeoutId !== null) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
   }
   reconnectDelay = 1000;
   _connect();
};

const disconnect = () => {
   offlineMode = true;
   if (reconnectTimeoutId !== null) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
   }
   reconnectDelay = 1000;
   if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      ws.close();
   }
};

const send = (payload) => {
   if (!isConnected()) {
      return false;
   }

   try {
      ws.send(JSON.stringify(payload));
      return true;
   } catch (error) {
      console.warn("websocket send failed", error);
      try {
         ws.close();
      } catch (closeError) {
         // A failed close must not escape from a command send.
      }
      return false;
   }
}

const setProbeTargetTemp = (probe, preset, minC, maxC) => {
   return send({
      cmd: 'set_probe_target_temp',
      probe: probe,
      preset: preset,
      min_temp: isNaN(minC) ? null : minC,  // always C over the wire
      max_temp: isNaN(maxC) ? null : maxC,  // always C over the wire
   });
};

const clearProbeTargetTemp = (probe) => {
   return setProbeTargetTemp(probe, null, null, null);
};

const silenceAlarm = () => {
   return send({
      cmd: 'silence_alarm',
   });
};

const setUnit = (isC) => {
   return send({
      cmd: 'set_unit',
      unit: isC ? 'C' : 'F',
   });
};

const clearHistory = () => {
   return send({
      cmd: 'clear_history',
   });
};

const powerOff = () => {
   return send({
      cmd: 'poweroff',
   });
};

export {
   isConnected,
   init,
   connect,
   disconnect,
   silenceAlarm,
   setProbeTargetTemp,
   clearProbeTargetTemp,
   setUnit,
   clearHistory,
   powerOff,
};
