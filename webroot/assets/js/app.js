import * as PWA from './pwa.js';
import * as Utils from './utils.js';
import * as WS from './websocket.js';

let chart;
let tempAlertModal;

let inSilenceAlarmHandler = false;

let chartRenderTimeoutId = -1;
let chartRenderMs = Date.now()

const alertAudio = new Audio('/assets/audio/AlertTone.mp3');

// Match .probe-container:nth-child(...) .probe-idx .dot
const probeColors = [
  "#357bcc",
  "#32a852",
  "#d4872a",
  "#bdb320",
]
const STRIPLINE_TEMP_OPACITY = 0.5
const STRIPLINE_RANGE_OPACITY = 0.15

const CtoF = (temp) => (temp * 9 / 5) + 32;
const FtoC = (temp) => (temp - 32) * 5 / 9;

const isUnitC = () => document.getElementById('ibbq-unit-celcius').checked
const isUnitF = () => !isUnitC()
const setUnit = (celsius) => {
   if (isUnitC() != celsius) {
      const el = document.getElementById('ibbq-unit-celcius')
      el.checked = celsius;
      el.dispatchEvent(new Event('change'));
   }
}

const tempFromC = (temp) => temp != null && isUnitF() ? CtoF(temp) : temp
const tempToC = (temp) => temp != null && isUnitF() ? FtoC(temp) : temp

// TODO: support Celcius presets too
const updatePreset = () => {
   const probeTempMin = document.getElementById('probe-temp-min')
   const probeTempMax = document.getElementById('probe-temp-max')

   const preset = document.querySelector('#probe-preset option:checked')
   if (preset == null) {
      probeTempMin.disabled = true
      probeTempMin.value = null
      probeTempMax.disabled = true
      probeTempMax.value = null
   } else if (preset.value == 'custom.temp') {
      probeTempMin.disabled = true
      probeTempMin.value = null
      probeTempMax.disabled = false
   } else if (preset.value == 'custom.range') {
      probeTempMin.disabled = false
      probeTempMax.disabled = false
   } else {
      probeTempMin.disabled = true
      probeTempMin.value = preset.dataset.ibbqTargetMin || null
      probeTempMax.disabled = true
      probeTempMax.value = preset.dataset.ibbqTargetMax
   }
}

const initProbeSettingsModal = () => {
   const modalEl = document.getElementById('probeSettingsModal');
   const presetEl = document.getElementById('probe-preset');
   const settingsIdxEl = document.getElementById('probe-settings-index');
   const tempMinEl = document.getElementById('probe-temp-min');
   const tempMaxEl = document.getElementById('probe-temp-max');

   presetEl.addEventListener('change', (e) => {
      updatePreset()
   });

   modalEl.addEventListener('show.bs.modal', (e) => {
      const probeContainer = e.relatedTarget.closest('.probe-container');

      settingsIdxEl.value = probeContainer.dataset.ibbqProbeIdx

      const preset = probeContainer.dataset.ibbqPreset || '0'
      presetEl.value = preset

      tempMinEl.value = probeContainer.dataset.ibbqTempMin || ""
      tempMaxEl.value = probeContainer.dataset.ibbqTempMax || ""

      updatePreset()
   })

   for (const button of modalEl.getElementsByTagName('button')) {
      button.addEventListener('click', (e) => {
         if (!WS.isConnected()) {
            return
         }

         const probe = parseInt(settingsIdxEl.value);
         if (isNaN(probe)) {
            return
         }

         if (e.target.dataset.ibbqAction == "clear") {
            modalEl.querySelectorAll('.is-invalid').forEach((el) => {
               el.classList.remove('is-invalid');
            });

            WS.clearProbeTargetTemp(probe);
         } else if (e.target.dataset.ibbqAction == "save") {
            const validateInt = (el) => {
               if (!el.disabled && isNaN(parseInt(el.value))) {
                  el.classList.add('is-invalid');
                  return false;
               }
               el.classList.remove('is-invalid');
               return true;
            };

            let valid = true;

            const preset = presetEl.value;
            if (preset == '') {
               presetEl.classList.add('is-invalid');
               valid = false;
            } else {
               presetEl.classList.remove('is-invalid');
            }

            const min = parseInt(tempMinEl.value);
            valid = validateInt(tempMinEl) && valid; // 'valid' checked second to avoid short circuiting

            const max = parseInt(tempMaxEl.value); // 'valid' checked second to avoid short circuiting
            valid = validateInt(tempMaxEl) && valid;

            if (!valid) {
               return;
            }

            WS.setProbeTargetTemp(probe, preset, min, max);
         } else {
            return;
         }
         bootstrap.Modal.getInstance(modalEl).hide();
      });
   }
}

const initTempAlertModal = () => {
   const modalEl = document.getElementById('tempAlertModal');
   const modal = new bootstrap.Modal(modalEl);

   modalEl.addEventListener('hide.bs.modal', event => {
      alertAudio.pause();
      alertAudio.currentTime = 0;

      if (inSilenceAlarmHandler) {
         return;
      }
      WS.silenceAlarm();
   });

   modalEl.addEventListener('show.bs.modal', event => {
      alertAudio.play();
   });

   return modal;
}

const updateProbeTempTarget = (probeIdx) => {
   const probeContainer = document.querySelector(`.probe-container[data-ibbq-probe-idx="${probeIdx}"]`)
   const min = parseInt(probeContainer.dataset.ibbqTempMin)
   const max = parseInt(probeContainer.dataset.ibbqTempMax)

   /*
    * Update temp-target text on Probes tab
    */
   probeContainer.getElementsByClassName('probe-temp-target')[0].innerHTML =
      isNaN(max) ? '&nbsp;' :
      isNaN(min) ? max + '&deg;F' :
                   min + '&deg;F ~ ' + max + '&deg;F'

   /*
    * Update stripline on chart
    */
   const sl = chart.options.axisY.stripLines[probeIdx]
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
}

const renderProbe = (idx) => {
   const template = document.createElement('template');
   template.innerHTML = `
      <div class="col probe-container px-0 px-lg-3" data-ibbq-probe-idx="${idx}">
        <div class="row m-1 my-lg-3 p-1 rounded-3 text-dark">
          <div class="col-2 pt-2 probe-idx">
            <span class="dot">${idx+1}</span>
          </div>
          <div class="col-8 probe-temp">
            <div class="row row-cols-1 fs-3">
              <div class="col probe-temp-current">&nbsp;</div>
            </div>
            <div class="row row-cols-1">
              <div class="col probe-temp-target">&nbsp;</div>
            </div>
          </div>
          <div class="col-2 probe-settings">
            <a href="#" class="text-dark" data-bs-toggle="modal" data-bs-target="#probeSettingsModal">
              <i class="bi bi-gear-fill"></i>
            </a>
          </div>
        </div>
      </div>
   `;

   const el = template.content.firstElementChild;
   document.getElementById('probe-list').append(el);

   return el;
}

const appendChartData = (probeReading) => {
   // When the temp remains the same, we just need the first/last timestamps
   // of those values to draw a straight line.
   //
   // Because the tooltip is shared across all data sets, we need to add a
   // datapoint to all data sets any time one temp changes so the toolip
   // shows all temps
   const lastReadings = chart.options.data.map(d => d.dataPoints.slice(-2))
   const duplicateReading =
      lastReadings.length == probeReading.probes.length &&
      lastReadings.every(dp => dp.length == 2) &&
      lastReadings.every((dp, i) =>
         probeReading['probes'][i] == dp[1].tempC && dp[1].tempC == dp[0].tempC
      );

   for (const [i, tempC] of probeReading.probes.entries()) {
      const probeEl = document.querySelector(`.probe-container[data-ibbq-probe-idx="${i}"]`) ||
                      renderProbe(i);

      probeEl.getElementsByClassName('probe-temp-current')[0].innerHTML =
         tempC === null ? '--' : tempFromC(tempC) + "&deg;"

      if (chart.options.data.length < i + 1) {
         const probeColor = i <= probeColors.length ? probeColors[i] : "#000"
         chart.options.data.push({
            type: "line",
            markerSize: 0,
            name: "Probe " + (i+1),
            showInLegend: true,
            legendText: "N/A",
            color: probeColor,
            xValueType: "dateTime",
            dataPoints: [],
         })

         chart.options.axisY.stripLines.push({
            value: null,
            opacity: 0,
            color: probeColor,
            labelFontColor: probeColor,
            label: "Probe " + (i+1) + " Target",
            labelBackgroundColor: 'transparent',
            labelFormatter: (e) => {
               const sl = e.stripLine
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
         tempC != null ? tempFromC(tempC) + "°" : "N/A"

      if (duplicateReading) {
         lastReadings[i][1].x = probeReading.ts;
      } else {
         chart.options.data[i].dataPoints.push({
            x: probeReading.ts,
            y: tempFromC(tempC),
            tempC: tempC,
         })
      }
   }

   if (probeReading.ts >= chart.options.axisX.maximum) {
      // Increase by 25%
      const min = chart.options.axisX.minimum
      const max = chart.options.axisX.maximum
      chart.options.axisX.maximum = min + ((max-min) * 1.25)
   }
}

const renderChart = (minRenderIntervalMs=50) => {
   if (document.visibilityState != "visible") {
      // No reason to re-render the graph if the browser/tab is hidden
      return
   }

   if (!document.querySelector('button[aria-controls="graph"]').classList.contains("active")) {
      // No reason to re-render the graph if a different navigation tab is
      // selected
      return
   }

   // Don't re-render too often. Ex: if browser has been sleeping, when it
   // awakens it might process 10s+ update messages from the websocket all
   // at once... wait for them all to be processed before rendering the final
   // result.
   const msSinceLastRender = Date.now() - chartRenderMs;
   chartRenderMs = Date.now();
   if (msSinceLastRender < minRenderIntervalMs) {
      clearTimeout(chartRenderTimeoutId)
      chartRenderTimeoutId = setTimeout(renderChart, 50)
      return
   }

   chart.render()
}

const resetChartData = (probe_readings) => {
   chart.options.data = []
   chart.options.axisY.stripLines = []
   let xMin = new Date().getTime()
   for (const reading of probe_readings) {
      if (reading.probes.some(temp => temp != null)) {
         xMin = reading.ts
         break
      }
   }
   chart.options.axisX.minimum = xMin
   chart.options.axisX.maximum = xMin + (10 * 60 * 1000) // +10 min
}

const wsOnOpen = (e) => {
   renderChart();
};

const wsOnClose = (e) => {
   renderConnectionState(ConnectionState.UNKNOWN);
   if (e.isDisconnect) {
      renderChart(); // XXX: Why??
   }
};

const wsOnMessage = (e) => {
   const data = JSON.parse(e.data)

   if (data.cmd == "state_update") {
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
         resetChartData(data.probe_readings)
      }

      if (data.full_history || data.connected) {
         for (const reading of data.probe_readings) {
            appendChartData(reading);
         }

         for (const i of data.probe_readings[0].probes.keys()) {
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
                  probeContainer.dataset.ibbqTempMin = tempFromC(targetTemp.min_temp);
               }

               if (targetTemp.max_temp == null) {
                  delete probeContainer.dataset.ibbqTempMax;
               } else {
                  probeContainer.dataset.ibbqTempMax = tempFromC(targetTemp.max_temp);
               }
            } else {
               delete probeContainer.dataset.ibbqPreset;
               delete probeContainer.dataset.ibbqTempMin;
               delete probeContainer.dataset.ibbqTempMax;
            }

            updateProbeTempTarget(i)
         }

         renderChart()

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
      setUnit(data.unit == "C");

      // Update chart
      for (const dataSeries of chart.options.data) {
         for (const dataPoint of dataSeries.dataPoints) {
            dataPoint.y = tempFromC(dataPoint.tempC)
         }
      }
      renderChart(0)
   }
}

const requestWakeLock = async () => {
   if (document.visibilityState != "visible") {
      return;
   }

   try {
      await navigator.wakeLock.request("screen");
   } catch (err) {
      // the wake lock request fails - usually system related,
      // such being low on battery
      console.log(`${err.name}, ${err.message}`);
   }
};

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
   );

   if (state == ConnectionState.CONNECTED) {
      el.classList.add('bi-wifi');
   } else if (state == ConnectionState.DISCONNECTED) {
      el.classList.add('bi-wifi-off');
   } else {
      el.classList.add('bi-exclamation-triangle-fill');
   }
};

const initAudioAlert = () => {
   alertAudio.muted = true;
   alertAudio.play().catch(error => {
      const template = document.createElement('template');
      template.innerHTML = `
         <div class="modal fade" id="audioNoticeModal" tabindex="-1" aria-hidden="true">
           <div class="modal-dialog modal-dialog-centered">
             <div class="modal-content">
               <div class="modal-header">
                 <h5 class="modal-title" id="audioNoticeModalLabel">Audio Notice</h5>
                 <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
               </div>
               <div class="modal-body">
                 This page uses play audio notifications when a temperature probe target is set and exceeded.
               </div>
             </div>
           </div>
         </div>
      `;

      const modalEl = template.content.firstElementChild;
      modalEl.addEventListener('hidden.bs.modal', (e) => {
         e.target.remove();
      });
      document.body.append(modalEl);

      const modal = new bootstrap.Modal(modalEl);
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
}

const initChart = () => {
   const options = {
      animationEnabled: true,
      legend: {
         cursor: "pointer",
         verticalAlign: "top",
         fontSize: 20,
         itemclick: (e) => {
            e.dataSeries.visible = e.dataSeries.visible !== undefined &&
                                   !e.dataSeries.visible
            renderChart(0)
         }
      },
      toolTip: {
         shared: true,
         contentFormatter: (e) => {
            let content = `
               <div style="font-weight: bold; text-decoration: underline; margin-bottom: 5px;">
                  ${CanvasJS.formatDate(e.entries[0].dataPoint.x, "hh:mm:ss TT")}
               </div>
            `;
            for (const entry of e.entries) {
               if (entry.dataPoint.y === undefined) {
                  continue;
               }
               content += `
                  <span style="font-weight: bold; color: ${entry.dataSeries.color};">
                     ${entry.dataSeries.name}:
                  </span>
                  ${entry.dataPoint.y.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                  </br>
               `;
            }
            return content;
         },
      },
      zoomEnabled: true,
      axisX: {
         labelAngle: -25,
         labelFontSize: 20,
         labelFormatter: (e) => CanvasJS.formatDate(e.value, "hh:mm TT"),
         minimum: new Date(),
         maximum: new Date(new Date().getTime() + (10 * 60 * 1000)), // +10 min
      },
      axisY: {
         includeZero: true,
         labelFontSize: 20,
         logarithmic: false,
         logarithmBase: 10,
         minimum: parseInt(document.getElementById('chart-min-y').value),
         stripLines: [],
      },
      data: [],
   };
   chart = new CanvasJS.Chart("graph", options);

   // Rendering is skipped when the page is not visible; make sure to render
   // any incremental changes received when the page becomes visible again
   document.addEventListener("visibilitychange", renderChart);

   // Workaround graph not rendering correct size initially
   document.querySelector('button[aria-controls="graph"]').addEventListener(
      'shown.bs.tab', (e) => renderChart(0)
   );
}

const initFormFields = () => {
   /*
    * Temperature Unit
    */
   const unitEl = document.getElementById("ibbq-unit-celcius");
   unitEl.addEventListener('click', (e) => {
      WS.setUnit(isUnitC());
   });
   unitEl.addEventListener('change', (e) => {
      const label = e.target.labels[0];
      label.textContent = e.target.checked ? label.dataset.on : label.dataset.off;
   });

   /*
    * Y-Axis Minimum
    */
   document.getElementById("chart-min-y").addEventListener('change', (e) => {
      chart.options.axisY.minimum = parseInt(e.target.value);
      renderChart(0);
   });

   /*
    * Save Chart Data
    */
   document.getElementById('ibbq-download').addEventListener('click', (e) => {
      const probe_readings = new Map()
      for (const [i, dataSeries] of chart.options.data.entries()) {
         for (const dataPoint of dataSeries.dataPoints) {
            if (probe_readings.get(dataPoint.x) == undefined) {
               probe_readings.set(dataPoint.x, [])
            }
            probe_readings.get(dataPoint.x)[i] = dataPoint.tempC
         }
      }

      const data = {
         'probe_readings': Array.from(probe_readings.keys()).reduce((result, ts) => {
            result.push({
               'ts': ts,
               'probes': probe_readings.get(ts)
            })
            return result
          }, []),
      }

      const blob = new Blob([JSON.stringify(data)], {type: 'application/json'}) // text/plain
      e.target.href = window.URL.createObjectURL(blob)
      e.target.download = 'ibbq_' + new Date().toJSON().slice(0, -5) + '.json'
   });

   /*
    * View Saved Data
    */
   document.getElementById('ibbq-upload').addEventListener('change', (e) => {
      new Blob(e.target.files).text().then((text) => {
         const data = JSON.parse(text)

         const isValidProbeReading = (r) => {
            return Number.isInteger(r.ts) && Array.isArray(r.probes) && r.probes.every((p) => p == null || Number.isInteger(p))
         }

         if (!data.probe_readings || !data.probe_readings.every(isValidProbeReading)) {
            throw new Error('Invalid data structure')
         }

         // Disconnect from server
         WS.disconnect();

         resetChartData(data.probe_readings)
         for (const reading of data.probe_readings) {
            appendChartData(reading);
         }
      }).catch((ex) => {
         console.log('Error parsing saved data file "' + e.target.files[0].name + '": ' + ex.message)
         renderToastInvalidData();
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

      const template = document.createElement('template');
      template.innerHTML = `
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

      const modalEl = template.content.firstElementChild;
      modalEl.addEventListener('hidden.bs.modal', (e) => {
         e.target.remove();
      });
      document.body.append(modalEl);

      modalEl.querySelector('.modal-body').addEventListener('click', (e) => {
         if (e.target.dataset.ibbqAction == "confirm") {
            WS.powerOff();
         }
      });

      const modal = new bootstrap.Modal(modalEl);
      modal.show();
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

document.addEventListener('readystatechange', (e) => {
   if (document.readyState === "complete") {
      renderConnectionState(ConnectionState.UNKNOWN);
      PWA.init();
      initFormFields();
      initProbeSettingsModal();
      initAudioAlert();
      tempAlertModal = initTempAlertModal();
      initChart();

      // Request the screen wake lock to prevent screen from sleeping when
      // monitoring temps
      requestWakeLock();
      document.addEventListener("visibilitychange", requestWakeLock);

      WS.init({
         onopen: wsOnOpen,
         onclose: wsOnClose,
         onmessage: wsOnMessage,
      });
   }
});
