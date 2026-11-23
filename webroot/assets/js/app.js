import * as Alert from './alert.js';
import * as Bootstrap from 'bootstrap';
import * as ProbeSettings from './probe-settings.js';
import { validateSavedProbeReadings } from './chart-history.js';
import * as Chart from './chart.js';
import * as Chromecast from './chromecast.js';
import * as PWA from './pwa.js';
import * as Utils from './utils.js';
import * as WS from './websocket.js';
const { validateProbeTargetTemps } = ProbeSettings;

const MAX_SAVED_DATA_BYTES = 10 * 1024 * 1024

const wsOnOpen = (e) => {
   Chart.renderChart();
};

const wsOnClose = (e) => {
   renderConnectionState(ConnectionState.UNKNOWN);
   if (e.isDisconnect) {
      Chart.renderChart(); // XXX: Why??
   }
};

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isBatteryLevel = (value) => {
   return value === null ||
          (Number.isInteger(value) && value >= 0 && value <= 0xffff);
};

const isStateUpdate = (data) => {
   if (typeof data.connected !== "boolean" ||
       typeof data.full_history !== "boolean" ||
       typeof data.target_temp_alert !== "boolean" ||
       !isBatteryLevel(data.battery_level) ||
       !Array.isArray(data.probe_readings) ||
       data.probe_readings.some(reading =>
          !reading || typeof reading !== "object" ||
          !isFiniteNumber(reading.ts) || !Array.isArray(reading.probes) ||
          reading.probes.some(temp => temp !== null && !isFiniteNumber(temp))) ||
       !data.target_temps || typeof data.target_temps !== "object" ||
       Array.isArray(data.target_temps)) {
      return false;
   }

   return Object.values(data.target_temps).every(target =>
      target && typeof target === "object" && !Array.isArray(target) &&
      (target.preset === null || typeof target.preset === "string") &&
      (target.min_temp === null || isFiniteNumber(target.min_temp)) &&
      (target.max_temp === null || isFiniteNumber(target.max_temp)));
};

const wsOnMessage = (e) => {
   let data;
   try {
      data = JSON.parse(e.data);
   } catch (err) {
      console.error("Ignoring malformed WebSocket message", err);
      return;
   }

   if (!data || typeof data !== "object" || Array.isArray(data) ||
       typeof data.cmd !== "string") {
      console.error("Ignoring invalid WebSocket message shape");
      return;
   }

   if (data.cmd == "state_update") {
      if (!isStateUpdate(data)) {
         console.error("Ignoring invalid state_update payload");
         return;
      }
      /*
       * Update connection status
       */
      renderConnectionState(data.connected ?
                             ConnectionState.CONNECTED: ConnectionState.DISCONNECTED);

      /*
       * Update battery status
       */
      renderBatteryLevel(data.battery_level);

      /*
       * Update probe data (probe and chart tabs)
       */
      if (data.full_history) {
         Chart.resetChartData(data.probe_readings)
      }

      if (data.full_history || data.connected) {
         for (const reading of data.probe_readings) {
            Chart.appendChartData(reading);
         }

         for (const i of (data.probe_readings[0]?.probes || []).keys()) {
            const probeContainer = document.querySelector(`.probe-container[data-ibbq-probe-idx="${i}"]`)
            const targetTemp = data.target_temps[i]

            if (targetTemp !== undefined) {
               if (targetTemp.preset == null) {
                  delete probeContainer.dataset.ibbqPreset;
               } else {
                  probeContainer.dataset.ibbqPreset = targetTemp.preset;
               }

               if (targetTemp.min_temp == null) {
                  delete probeContainer.dataset.ibbqTempMin;
               } else {
                  probeContainer.dataset.ibbqTempMin = ProbeSettings.tempFromC(targetTemp.min_temp);
               }

               if (targetTemp.max_temp == null) {
                  delete probeContainer.dataset.ibbqTempMax;
               } else {
                  probeContainer.dataset.ibbqTempMax = ProbeSettings.tempFromC(targetTemp.max_temp);
               }
            } else {
               delete probeContainer.dataset.ibbqPreset;
               delete probeContainer.dataset.ibbqTempMin;
               delete probeContainer.dataset.ibbqTempMax;
            }

            Chart.updateProbeTempTarget(i)
         }

         Chart.renderChart()

         /*
          * Update target temp alert
          */
         if (data.target_temp_alert) {
            Alert.start();
         } else {
            Alert.stop();
         }
      }
   } else if (data.cmd == "unit_update") {
      if (data.unit !== "C" && data.unit !== "F") {
         console.error("Ignoring invalid unit_update payload");
         return;
      }
      ProbeSettings.setUnit(data.unit == "C");

      // Update chart
      Chart.updateTemperatureUnit(ProbeSettings.tempFromC)
      Chart.renderChart(0)
   }
}

export { wsOnMessage, validateSavedProbeReadings, isStateUpdate };
export { validateProbeTargetTemps };
export const probeColorForIndex = Chart.probeColorForIndex;

let screenWakeLock = null;
let wakeLockRequest = null;

const requestWakeLock = async () => {
   if (document.visibilityState !== "visible" || !navigator.wakeLock?.request ||
       screenWakeLock || wakeLockRequest) {
      return;
   }

   wakeLockRequest = navigator.wakeLock.request("screen").then((lock) => {
      // The page may have become hidden while the asynchronous request was pending.
      if (document.visibilityState !== "visible") {
         return lock.release();
      }
      screenWakeLock = lock;
      lock.addEventListener?.("release", () => {
         if (screenWakeLock === lock) {
            screenWakeLock = null;
         }
      });
   }).catch((err) => {
      // the wake lock request fails - usually system related,
      // such being low on battery
      console.log(`${err.name}, ${err.message}`);
   }).finally(() => {
      wakeLockRequest = null;
   });
   return wakeLockRequest;
};

const handleVisibilityChange = () => {
   if (document.visibilityState === "visible") {
      return requestWakeLock();
   }

   const lock = screenWakeLock;
   screenWakeLock = null;
   if (lock) {
      lock.release().catch((err) => console.log(`${err.name}, ${err.message}`));
   }
};

export { requestWakeLock, handleVisibilityChange };

const downloadObjectUrls = new WeakMap();
const setDownloadLink = (link, blob) => {
   const previousUrl = downloadObjectUrls.get(link);
   if (previousUrl) {
      window.URL.revokeObjectURL(previousUrl);
   }
   const objectUrl = window.URL.createObjectURL(blob);
   downloadObjectUrls.set(link, objectUrl);
   link.href = objectUrl;
   link.download = 'ibbq_' + new Date().toJSON().slice(0, -5) + '.json';
};
export { setDownloadLink };

const renderToastInvalidData = () => {
   const html = `
      <div class="toast align-items-center" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="toast-header">
          <i class="bi bi-info-circle-fill me-1 text-warning"></i>
          <strong class="me-auto">Error</strong>
        </div>
        <div class="toast-body">
          Invalid data file.
        </div>
      </div>
   `;

   return Utils.renderToast(html);
}

const renderBatteryLevel = (level) => {
   const el = document.getElementById('ibbq-battery');

   el.classList.remove(
      'bi-battery',
      'bi-battery-charging',
      'bi-battery-full',
      'bi-battery-half',
      'text-danger',
      'text-warning',
   )
   if (level == null) {
      el.textContent = "--"
      el.classList.add('bi-battery')
   } else if (level == 0xffff) {
      el.textContent = "--"
      el.classList.add('bi-battery-charging', 'text-warning')
   } else {
      el.textContent = level + "%"
      if (level <= 10) {
         el.classList.add('bi-battery', 'text-danger')
      } else if (level >= 90) {
         el.classList.add('bi-battery-full')
      } else {
         el.classList.add('bi-battery-half')
      }
   }
}

const ConnectionState = Object.freeze({
   CONNECTED: Symbol('connected'),
   DISCONNECTED: Symbol('disconnected'),
   UNKNOWN: Symbol('unknown'),
});

const renderConnectionState = (state) => {
   const el = document.getElementById('ibbq-connection');

   el.classList.remove(
      'bi-wifi',
      'bi-wifi-off',
      'bi-exclamation-triangle-fill',
      'text-danger',
      'text-warning',
   );

   if (state == ConnectionState.CONNECTED) {
      el.classList.add('bi-wifi');
   } else if (state == ConnectionState.DISCONNECTED) {
      el.classList.add('bi-wifi-off', 'text-danger');
   } else {
      el.classList.add('bi-exclamation-triangle-fill', 'text-warning');
   }
};

const initFormFields = () => {
   /*
    * Temperature Unit
    */
   const unitEl = document.getElementById("ibbq-unit-celcius");
   unitEl.addEventListener('click', (e) => {
      WS.setUnit(ProbeSettings.isUnitC());
   });
   unitEl.addEventListener('change', (e) => {
      const label = e.target.labels[0];
      label.textContent = e.target.checked ? label.dataset.on : label.dataset.off;
   });

   /*
    * Y-Axis Minimum
    */
   document.getElementById("chart-min-y").addEventListener('change', (e) => {
      Chart.setMinimumY(parseInt(e.target.value));
      Chart.renderChart(0);
   });

   /*
    * Save Chart Data
    */
   document.getElementById('ibbq-download').addEventListener('click', (e) => {
      const data = {
         'probe_readings': Chart.getProbeReadings(),
      }

      const blob = new Blob([JSON.stringify(data)], {type: 'application/json'}) // text/plain
      setDownloadLink(e.target, blob)
   });

   /*
    * View Saved Data
    */
   document.getElementById('ibbq-upload').addEventListener('change', (e) => {
      const file = e.target.files[0]
      if (!file) {
         return
      }
      if (file.size > MAX_SAVED_DATA_BYTES) {
         renderToastInvalidData()
         e.target.value = ''
         return
      }

      file.text().then((text) => {
         const data = JSON.parse(text)

         if (data === null || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('Invalid data structure')
         }

         // Validate the complete file before disconnecting or changing chart data.
         const readings = validateSavedProbeReadings(data.probe_readings)

         // Disconnect from server
         WS.disconnect();

         Chart.resetChartData(readings)
         for (const reading of readings) {
            Chart.appendChartData(reading);
         }
         Chart.renderChart(0)
      }).catch((ex) => {
         console.log('Error parsing saved data file "' + file.name + '": ' + ex.message)
         renderToastInvalidData();
         e.target.value = ''
      })
   });

   /*
    * Clear Data
    */
   document.getElementById("ibbq-clear-history").addEventListener('click', (e) => {
      WS.clearHistory();
   });

   /*
    * Server Power
    */
   document.getElementById("ibbq-poweroff").addEventListener('click', (e) => {
      if (!WS.isConnected()) {
         return;
      }

      const html = `
         <div class="modal fade" tabindex="-1" aria-hidden="true">
           <div class="modal-dialog modal-dialog-centered">
             <div class="modal-content">
               <div class="modal-header">
                 <h5 class="modal-title">Power off the server?</h5>
               </div>
               <div class="modal-body text-end">
                 <button type="button" class="btn btn-secondary btn-sm" data-ibbq-action="cancel" data-bs-dismiss="modal">Cancel</button>
                 <button type="button" class="btn btn-outline-danger btn-sm" data-ibbq-action="confirm" data-bs-dismiss="modal">Confirm</button>
               </div>
             </div>
           </div>
         </div>
      `;
      const obj = Utils.renderModal(html);

      obj.element.addEventListener('hide.bs.modal', (e) => {
         // Avoid warning about aria-hidden when the element retains focus
         document.activeElement.blur();
      });

      obj.element.addEventListener('hidden.bs.modal', (e) => {
         e.target.remove();
      });

      const confirmBtn = obj.element.querySelector('.modal-body button[data-ibbq-action="confirm"]');
      confirmBtn.addEventListener('click', (e) => {
         WS.powerOff();
      });

      obj.modal.show();
   });
}

const registerServiceWorker = async () => {
   if ("serviceWorker" in navigator) {
      await navigator.serviceWorker.register("service_worker.js", {
         scope: "/",
      }).then((registration) => {
         console.log("Service worker registered");
      }).catch((error) => {
         console.error(`Registration failed with ${error}`);
      });
   }
};
registerServiceWorker();

const _urlTabChange = () => {
   const hash = window.location.hash;
   if (hash) {
      const triggerEl = document.querySelector(`[data-bs-target="${hash}"]`);
      if (triggerEl) {
         const tab = new Bootstrap.Tab(triggerEl);
         tab.show();
      }
   }
};

const initUrlTab = () => {
   _urlTabChange();

   window.addEventListener('hashchange', (event) => {
      _urlTabChange();
   });
};

document.addEventListener('readystatechange', (e) => {
   if (document.readyState === "complete") {
      renderConnectionState(ConnectionState.UNKNOWN);
      PWA.init();
      initFormFields();
      ProbeSettings.initProbeSettingsModal();
      Alert.init();
      Chart.initChart();
      initUrlTab();

      // Request the screen wake lock to prevent screen from sleeping when
      // monitoring temps
      requestWakeLock();
      document.addEventListener("visibilitychange", handleVisibilityChange);

      WS.init({
         onopen: wsOnOpen,
         onclose: wsOnClose,
         onmessage: wsOnMessage,
      });
   }
});

window['__onGCastApiAvailable'] = function(isAvailable) {
   if (isAvailable) {
      Chromecast.initCastApi();
   }
};
