import CanvasJS from 'canvasjs';
import * as ProbeSettings from './probe-settings.js';

let chart;

let chartRenderTimeoutId = -1;
let chartRenderMs = Date.now()

// Match .probe-container:nth-child(...) .probe-idx .dot
const probeColors = [
  "#357bcc",
  "#32a852",
  "#d4872a",
  "#bdb320",
]
export const probeColorForIndex = (index) => probeColors[index % probeColors.length]
const STRIPLINE_TEMP_OPACITY = 0.5
const STRIPLINE_RANGE_OPACITY = 0.15
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

const setMinimumY = (minimum) => {
   chart.options.axisY.minimum = minimum
}

const updateTemperatureUnit = (tempFromC) => {
   for (const dataSeries of chart.options.data) {
      for (const dataPoint of dataSeries.dataPoints) {
         dataPoint.y = tempFromC(dataPoint.tempC)
      }
   }
}

const getProbeReadings = () => {
   const probeReadings = new Map()
   for (const [i, dataSeries] of chart.options.data.entries()) {
      for (const dataPoint of dataSeries.dataPoints) {
         if (probeReadings.get(dataPoint.x) === undefined) {
            probeReadings.set(dataPoint.x, [])
         }
         probeReadings.get(dataPoint.x)[i] = dataPoint.tempC
      }
   }

   return Array.from(probeReadings.keys()).map(ts => ({
      ts,
      probes: probeReadings.get(ts),
   }))
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
         tempC === null ? '--' : ProbeSettings.tempFromC(tempC) + "&deg;"

      if (chart.options.data.length < i + 1) {
         const probeColor = probeColorForIndex(i)
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
         tempC != null ? ProbeSettings.tempFromC(tempC) + "°" : "N/A"

      if (duplicateReading) {
         lastReadings[i][1].x = probeReading.ts;
      } else {
         chart.options.data[i].dataPoints.push({
            x: probeReading.ts,
            y: ProbeSettings.tempFromC(tempC),
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

const resetChartData = (probeReadings) => {
   chart.options.data = []
   chart.options.axisY.stripLines = []
   let xMin = new Date().getTime()
   for (const reading of probeReadings) {
      if (Array.isArray(reading.probes) && reading.probes.some(temp => temp != null)) {
         xMin = reading.ts
         break
      }
   }
   chart.options.axisX.minimum = xMin
   chart.options.axisX.maximum = xMin + (10 * 60 * 1000) // +10 min
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


export { appendChartData, getProbeReadings, initChart, renderChart, resetChartData, setMinimumY, updateProbeTempTarget, updateTemperatureUnit };
