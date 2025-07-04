import * as Utils from './utils.js';

let ws = null;

let opts = {};
let offlineMode = true;

let serverDisconnectedToast = null;
let offlineModeToast = null;

const isConnected = () => ws?.readyState == 1;
const protocol = window.location.protocol == "https:" ? "wss://" : "ws://";

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
   if (offlineMode) {
      return;
   }

   ws = new WebSocket(protocol + window.location.host + "/ws");

   ws.onopen = (e) => {
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

   ws.onclose = (e) => {
      e.isDisconnect = false;

      if (offlineMode) {
         serverDisconnectedToast && serverDisconnectedToast.hide();
         serverDisconnectedToast = null;
         offlineModeToast = renderToastOfflineMode().toast;
      } else {
         if (!serverDisconnectedToast) {
            console.warn("websocket closed: [" + e.code + "]")
            offlineModeToast && offlineToast.hide();
            offlineModeToast = null;
            serverDisconnectedToast = renderToastServerDisconnected().toast;
            e.isDisconnect = true;
         }
         setTimeout(_connect, 1000)
      }

      if (typeof opts.onclose === 'function') {
          opts.onclose(e);
      }
   };

   ws.onmessage = (e) => {
      if (typeof opts.onmessage === 'function') {
         opts.onmessage(e);
      }
   };
};

const init = (options={}) => {
   opts = options;
   connect();
}

const connect = () => {
   offlineMode = false;
   _connect();
};

const disconnect = () => {
   offlineMode = true;
   ws.close();
};

const send = (payload) => {
   if (!isConnected()) {
      return false;
   }

   ws.send(JSON.stringify(payload));
   return true;
}

const setProbeTargetTemp = (probe, preset, min, max) => {
   return send({
      cmd: 'set_probe_target_temp',
      probe: probe,
      preset: preset,
      min_temp: isNaN(min) ? null : tempToC(min),  // always C over the wire
      max_temp: isNaN(max) ? null : tempToC(max),  // always C over the wire
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
