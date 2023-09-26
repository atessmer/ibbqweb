let ws;
let serverDisconnectedToast = null;
let offlineModeToast = null;
let ibbqConnection;
let ibbqBattery;
let ibbqUnitCelcius;
let chartMinY;
let chart;
let tempAlertModal;

let inOfflineMode = false;
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

const isUnitC = () => ibbqUnitCelcius.checked
const isUnitF = () => !isUnitC()

const tempFromC = (temp) => temp != null && isUnitF() ? CtoF(temp) : temp
const tempToC = (temp) => temp != null && isUnitF() ? FtoC(temp) : temp

/*
 * Cookie handlers.
 * source: https://www.quirksmode.org/js/cookies.html
 */
const createCookie = (name, value, days) => {
	if (days) {
		var date = new Date();
		date.setTime(date.getTime()+(days*24*60*60*1000));
		var expires = "; expires="+date.toGMTString();
	}
	else var expires = "";
	document.cookie = name+"="+value+expires+"; path=/";
}

const readCookie = (name) => {
	var nameEQ = name + "=";
	var ca = document.cookie.split(';');
	for(var i=0;i < ca.length;i++) {
		var c = ca[i];
		while (c.charAt(0)==' ') c = c.substring(1,c.length);
		if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length,c.length);
	}
	return null;
}

const eraseCookie = (name) => {
	createCookie(name,"",-1);
}

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
      probeTempMin.value = preset.getAttribute('data-ibbq-target-min')
      probeTempMax.disabled = true
      probeTempMax.value = preset.getAttribute('data-ibbq-target-max')
   }
}

const updateProbeTempTarget = (probeIdx) => {
   const probeContainer = document.getElementById('probe-container-' + probeIdx)
   const min = parseInt(probeContainer.getAttribute('data-ibbq-temp-min'))
   const max = parseInt(probeContainer.getAttribute('data-ibbq-temp-max'))

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

const appendChartData = (probeReading) => {
   // When the temp remains the same, we just need the first/last timestamps
   // of those values to draw a straight line.
   //
   // Because the tooltip is shared across all data sets, we need to add a
   // datapoint to all data sets any time one temp changes so the toolip
   // shows all temps
   const lastReadings = chart.options.data.map(d => d.dataPoints.slice(-2))
   duplicateReading =
      lastReadings.length == probeReading.probes.length &&
      lastReadings.every(dp => dp.length == 2) &&
      lastReadings.every((dp, i) =>
         probeReading['probes'][i] == dp[1].tempC && dp[1].tempC == dp[0].tempC
      );

   for (let i = 0; i < probeReading.probes.length; i++) {
      const tempC = probeReading.probes[i]

      let probecontainer = document.getElementById('probe-container-' + i)
      if (probecontainer == null) {
         const template = document.getElementById('probe-container-template')
         probecontainer = template.content.firstElementChild.cloneNode(true)

         probecontainer.id = 'probe-container-' + i
         probecontainer.setAttribute('data-ibbq-probe-idx', i)
         probecontainer.querySelector('.probe-idx .dot').textContent = (i + 1)
         document.getElementById('probe-list').append(probecontainer);
      }

      probecontainer.getElementsByClassName('probe-temp-current')[0].innerHTML =
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
   msSinceLastRender = Date.now() - chartRenderMs
   chartRenderMs = Date.now()
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
   for (let i = 0; i < probe_readings.length; i++) {
      const reading = probe_readings[i]
      if (reading.probes.some(temp => temp != null)) {
         xMin = reading.ts
         break
      }
   }
   chart.options.axisX.minimum = xMin
   chart.options.axisX.maximum = xMin + (10 * 60 * 1000) // +10 min
}

const connectWebsocket = () => {
   if (inOfflineMode) {
      return
   }

   const protocol = window.location.protocol == "https:" ? "wss://" : "ws://"
   ws = new WebSocket(protocol + window.location.host + "/ws")

   ws.onopen = (e) => {
      if (serverDisconnectedToast || offlineModeToast) {
         console.log("websocket opened")
         serverDisconnectedToast && serverDisconnectedToast.hide();
         serverDisconnectedToast = null;
         offlineModeToast && offlineModeToast.hide();
         offlineModeToast = null;
         renderChart()
      }
   }

   ws.onclose = (e) => {
      ibbqConnection.classList.remove("connected")
      ibbqConnection.classList.remove("disconnected")
      if (inOfflineMode) {
         serverDisconnectedToast && serverDisconnectedToast.hide();
         serverDisconnectedToast = null;
         offlineModeToast = renderToastOfflineMode().toast;
         return
      }

      if (!serverDisconnectedToast) {
         console.warn("websocket closed: [" + e.code + "]")
         offlineModeToast && offlineToast.hide();
         offlineModeToast = null;
         serverDisconnectedToast = renderToastServerDisconnected().toast;
         renderChart()
      }
      setTimeout(connectWebsocket, 1000)
   }

   ws.onmessage = (e) => {
      const data = JSON.parse(e.data)

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
            resetChartData(data.probe_readings)
         }

         if (data.full_history || data.connected) {
            for (let i = 0; i < data.probe_readings.length; i++) {
               appendChartData(data.probe_readings[i]);
            }

            for (let i = 0; i < data.probe_readings[0].probes.length; i++) {
               const probeContainer = document.getElementById('probe-container-' + i)
               const targetTemp = data.target_temps[i]

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
                                                 tempFromC(targetTemp.min_temp))
                  }

                  if (targetTemp.max_temp == null) {
                     probeContainer.removeAttribute('data-ibbq-temp-max')
                  } else {
                     probeContainer.setAttribute('data-ibbq-temp-max',
                                                 tempFromC(targetTemp.max_temp))
                  }
               } else {
                  probeContainer.removeAttribute('data-ibbq-preset')
                  probeContainer.removeAttribute('data-ibbq-temp-min')
                  probeContainer.removeAttribute('data-ibbq-temp-max')
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
         // Update checkbox
         ibbqUnitCelcius.checked = (data.unit == "C");

         // Update checkbox label
         ibbqUnitCelcius.labels.forEach(label =>
            label.textContent = ibbqUnitCelcius.checked ?
               label.dataset.on : label.dataset.off
         )

         // Update chart
         for (let i = 0; i < chart.options.data.length; i++) {
            const dataSeries = chart.options.data[i];
            for (let j = 0; j < dataSeries.dataPoints.length; j++) {
               const dataPoint = dataSeries.dataPoints[j]
               dataPoint.y = tempFromC(dataPoint.tempC)
            }
         }
         renderChart(0)
      }
   }
}

const requestWakeLock = async () => {
   if (document.visibilityState != "visible") {
      return;
   }

   try {
      const wakeLock = await navigator.wakeLock.request("screen");
   } catch (err) {
      // the wake lock request fails - usually system related,
      // such being low on battery
      console.log(`${err.name}, ${err.message}`);
   }
};

const renderToast = (html) => {
   const template = document.createElement('template');
   template.innerHTML = html

   const toastEl = template.content.firstElementChild;
   toastEl.addEventListener('hidden.bs.toast', (e) => {
      e.target.remove();
   });
   document.getElementById('toast-container').append(template.content);

   const toast = new bootstrap.Toast(toastEl);
   toast.show();

   return {
      'toast': toast,
      'element': toastEl,
   };
}

const renderToastServerDisconnected = () => {
   html = `
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

   return renderToast(html);
}

const renderToastOfflineMode = () => {
   html = `
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

   const obj = renderToast(html);
   obj.element.querySelector('[aria-label="Reconnect"]').addEventListener('click', (e) => {
      inOfflineMode = false;
      connectWebsocket();
   });

   return obj;
}

const renderToastInvalidData = () => {
   html = `
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

   return renderToast(html);
}

const setPwaInstallHandlers = () => {
   const INSTALL_BUTTON_ID = 'install-pwa';
   const DECLINE_BUTTON_ID = 'decline-install-pwa';
   const installPWABanner = document.getElementById("install-pwa-banner");
   let installPWAPrompt;

   if (readCookie('pwaDeclined') != null) {
      // Cookies can only be valid for so long, so refresh the expiration
      // date on each page load
      createCookie('pwaDeclined', '1', 365);
      return;
   }

   window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      installPWAPrompt = e;
      installPWABanner.classList.remove("d-none");
   });

   const pwaInstallButtonHandler = (e) => {
      installPWABanner.classList.add("d-none");
      if (e.target.id == INSTALL_BUTTON_ID) {
         installPWAPrompt.prompt();
         installPWAPrompt.userChoice;
      } else if (e.target.id == DECLINE_BUTTON_ID) {
         createCookie('pwaDeclined', '1', 365);
      }
      installPWAPrompt = null;
   };
   document.getElementById(INSTALL_BUTTON_ID).addEventListener('click', pwaInstallButtonHandler);
   document.getElementById(DECLINE_BUTTON_ID).addEventListener('click', pwaInstallButtonHandler);
}

const registerServiceWorker = async () => {
   if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.register("service_worker.js", {
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
      ibbqConnection = document.getElementById("ibbq-connection");
      ibbqBattery = document.getElementById("ibbq-battery");
      ibbqUnitCelcius = document.getElementById("ibbq-unit-celcius");
      chartMinY = document.getElementById("chart-min-y")

      setPwaInstallHandlers();

      ibbqUnitCelcius.addEventListener('click', (e) => {
         if (ws.readyState != 1) {
            // Not connected
            return
         }
         ws.send(JSON.stringify({
            cmd: 'set_unit',
            unit: isUnitC() ? 'C' : 'F',
         }))
      })

      chartMinY.addEventListener('change', (e) => {
         chart.options.axisY.minimum = parseInt(e.target.value)
         renderChart(0)
      })

      document.getElementById("ibbq-clear-history").addEventListener('click', (e) => {
         if (ws.readyState != 1) {
            // Not connected
            return;
         }

         ws.send(JSON.stringify({
            cmd: 'clear_history',
         }))
      })

      document.getElementById("ibbq-poweroff").addEventListener('click', (e) => {
         if (ws.readyState != 1) {
            // Not connected
            return;
         }

         if (confirm("Power off the server?")) {
            ws.send(JSON.stringify({
               cmd: 'poweroff',
            }))
         }
      })

      document.getElementById('ibbq-download').addEventListener('click', (e) => {
         const probe_readings = new Map()
         for (let i = 0; i < chart.options.data.length; i++) {
            const dataSeries = chart.options.data[i];
            for (let j = 0; j < dataSeries.dataPoints.length; j++) {
               const dataPoint = dataSeries.dataPoints[j]

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
      })

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
            inOfflineMode = true
            ws.close()

            resetChartData(data.probe_readings)
            for (let i = 0; i < data.probe_readings.length; i++) {
               appendChartData(data.probe_readings[i]);
            }
         }).catch((ex) => {
            console.log('Error parsing saved data file "' + e.target.files[0].name + '": ' + ex.message)
            renderToastInvalidData();
         })
      })

      document.getElementById('probeSettingsModal').addEventListener('show.bs.modal', (e) => {
         let probeContainer = e.relatedTarget
         while (!probeContainer.classList.contains('probe-container')) {
            probeContainer = probeContainer.parentElement
         }
         const probeIdx = probeContainer.getAttribute('data-ibbq-probe-idx')

         document.getElementById('probe-settings-index').value = probeIdx

         const preset = probeContainer.getAttribute('data-ibbq-preset') || '0'
         document.getElementById('probe-preset').value = preset

         document.getElementById('probe-temp-min').value =
            probeContainer.getAttribute('data-ibbq-temp-min')
         document.getElementById('probe-temp-max').value =
            probeContainer.getAttribute('data-ibbq-temp-max')

         updatePreset()
      })

      document.getElementById('probe-preset').addEventListener('change', (e) => updatePreset())

      document.getElementById('probeSettingsClear').addEventListener('click', (e) => {
         const probeIdx = document.getElementById('probe-settings-index').value
         const probe = parseInt(probeIdx)
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
      })

      document.getElementById('probeSettingsSave').addEventListener('click', (e) => {
         const probeIdx = document.getElementById('probe-settings-index').value
         const probe = parseInt(probeIdx)
         if (isNaN(probe)) {
            return
         }

         const presetInput = document.getElementById('probe-preset')
         const preset = presetInput.value
         if (preset == '_invalid_') {
            presetInput.classList.add('is-invalid')
            return
         } else {
            presetInput.classList.remove('is-invalid')
         }

         let valid = true
         const minInput = document.getElementById('probe-temp-min')
         const min = parseInt(minInput.value)
         if (!minInput.disabled && isNaN(min)) {
            minInput.classList.add('is-invalid')
            valid = false
         } else {
            minInput.classList.remove('is-invalid')
         }

         const maxInput = document.getElementById('probe-temp-max')
         const max = parseInt(maxInput.value)
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
               min_temp: isNaN(min) ? null : tempToC(min),
               max_temp: tempToC(max),
            }))

            bootstrap.Modal.getInstance(
               document.getElementById('probeSettingsModal')
            ).hide()
         }
      })

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
               let content =
                  '<div style="font-weight: bold; text-decoration: underline; margin-bottom: 5px;">' +
                     CanvasJS.formatDate(e.entries[0].dataPoint.x, "hh:mm:ss TT") +
                  '</div>';
               for (let entry of e.entries) {
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
            labelFormatter: (e) => CanvasJS.formatDate(e.value, "hh:mm TT"),
            minimum: new Date(),
            maximum: new Date(new Date().getTime() + (10 * 60 * 1000)), // +10 min
         },
         axisY: {
            includeZero: true,
            labelFontSize: 20,
            logarithmic: false,
            logarithmBase: 10,
            minimum: parseInt(chartMinY.value),
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

      // Request the screen wake lock to prevent screen from sleeping when
      // monitoring temps
      requestWakeLock();
      document.addEventListener("visibilitychange", requestWakeLock);


      alertAudio.muted = true;
      alertAudio.play().catch(error => {
         const modalEl = document.getElementById('audioNoticeModal');
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

      const tempAlertModalEl = document.getElementById('tempAlertModal');
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
});
