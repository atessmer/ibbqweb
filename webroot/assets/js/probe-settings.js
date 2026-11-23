import * as Utils from './utils.js';
import * as WS from './websocket.js';

const CtoF = (temp) => (temp * 9 / 5) + 32;
const FtoC = (temp) => (temp - 32) * 5 / 9;

const validateProbeTargetTemps = (preset, min, max) => {
   const result = {
      valid: true,
      preset: true,
      min: true,
      max: true
   };

   if (preset === '') {
      result.preset = false;
   }

   result.min = min === null || (Number.isInteger(min) && min >= 32 && min <= 572);
   result.max = max === null || (Number.isInteger(max) && max >= 32 && max <= 572);
   if (preset === 'custom.temp') {
      result.min = result.min && min === null;
   }
   if (preset === 'custom.range' && (min === null || max === null)) {
      result.min = min !== null;
      result.max = max !== null;
   }
   if (min !== null && max !== null && min >= max) {
      result.min = false;
      result.max = false;
   }
   result.valid = result.preset && result.min && result.max;
   return result;
};

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

// TODO: support Celsius presets too
const updatePreset = () => {
   const probeTempMin = document.getElementById('probe-temp-min')
   const probeTempMax = document.getElementById('probe-temp-max')

   const preset = document.querySelector('#probe-preset option:checked')
   if (preset == null) {
      probeTempMin.disabled = true
      probeTempMin.value = null
      probeTempMax.disabled = true
      probeTempMax.value = null
   } else if (preset.value === 'custom.temp') {
      probeTempMin.disabled = true
      probeTempMin.value = null
      probeTempMax.disabled = false
   } else if (preset.value === 'custom.range') {
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
   const html = `
      <div class="modal fade" id="probeSettingsModal" tabindex="-1" data-bs-backdrop="static" aria-labelledby="probeSettingsModal" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="probeSettingsModalLabel">Probe Settings</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <input id="probe-settings-index" type="hidden"/>
              <div class="form-floating mb-3">
                <select class="form-select" name="probe-preset" id="probe-preset">
                  <option value=""></option>
                  <option value="beef.rare" data-ibbq-target-max="125">Beef (Rare)</option>
                  <option value="beef.medrare" data-ibbq-target-max="135">Beef (Medium Rare)</option>
                  <option value="beef.medium" data-ibbq-target-max="145">Beef (Medium)</option>
                  <option value="beef.medwell" data-ibbq-target-max="155">Beef (Medium Well)</option>
                  <option value="beef.well" data-ibbq-target-max="160">Beef (Well)</option>
                  <option value="chicken" data-ibbq-target-max="165">Chicken</option>
                  <option value="fish" data-ibbq-target-max="145">Fish</option>
                  <option value="pork" data-ibbq-target-max="145">Pork</option>
                  <option value="smoke.cold" data-ibbq-target-min="65" data-ibbq-target-max="86">Cold Smoke</option>
                  <option value="smoke.bbq" data-ibbq-target-min="215" data-ibbq-target-max="240">BBQ Smoke</option>
                  <option value="custom.temp">Custom Temperature</option>
                  <option value="custom.range">Custom Range</option>
                </select>
                <label for="probe-preset">Preset</label>
              </div>
              <div class="row">
                <div class="col-6">
                  <div class="form-floating mb-3">
                    <input type="number" class="form-control" id="probe-temp-min" min="32" max="572" disabled>
                    <label for="probe-temp-min">Min (&deg;F)</label>
                  </div>
                </div>
                <div class="col-6">
                  <div class="form-floating mb-3">
                    <input type="number" class="form-control" id="probe-temp-max" min="32" max="572" disabled>
                    <label for="probe-temp-max">Max (&deg;F)</label>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-danger flex-grow-1" data-ibbq-action="clear">Clear</button>
              <button type="button" class="btn btn-secondary flex-grow-1" data-ibbq-action="save">Save</button>
            </div>
          </div>
        </div>
      </div>
   `;
   const obj = Utils.renderModal(html);
   const presetEl = document.getElementById('probe-preset');
   const settingsIdxEl = document.getElementById('probe-settings-index');
   const tempMinEl = document.getElementById('probe-temp-min');
   const tempMaxEl = document.getElementById('probe-temp-max');

   presetEl.addEventListener('change', (e) => {
      updatePreset()
   });

   obj.element.addEventListener('show.bs.modal', (e) => {
      const probeContainer = e.relatedTarget.closest('.probe-container');

      settingsIdxEl.value = probeContainer.dataset.ibbqProbeIdx

      const preset = probeContainer.dataset.ibbqPreset || '0'
      presetEl.value = preset

      tempMinEl.value = probeContainer.dataset.ibbqTempMin || ""
      tempMaxEl.value = probeContainer.dataset.ibbqTempMax || ""

      updatePreset()
   })

   for (const button of obj.element.getElementsByTagName('button')) {
      button.addEventListener('click', (e) => {
         if (!WS.isConnected()) {
            return
         }

         const probe = parseInt(settingsIdxEl.value);
         if (isNaN(probe)) {
            return
         }

         if (e.target.dataset.ibbqAction === "clear") {
            obj.element.querySelectorAll('.is-invalid').forEach((el) => {
               el.classList.remove('is-invalid');
            });

            WS.clearProbeTargetTemp(probe);
         } else if (e.target.dataset.ibbqAction === "save") {
            const parseIntValue = (el) => {
               const rawValue = el.value.trim();
               if (rawValue === '') {
                  if (el.disabled) {
                     el.classList.remove('is-invalid');
                     return { valid: true, value: null };
                  }
                  el.classList.add('is-invalid');
                  return { valid: false, value: null };
               }

               const value = Number(rawValue);
               if (!Number.isInteger(value)) {
                  el.classList.add('is-invalid');
                  return { valid: false, value: null };
               }
               el.classList.remove('is-invalid');
               return { valid: true, value };
            };

            let valid = true;

            const preset = presetEl.value;
            if (preset === '') {
               presetEl.classList.add('is-invalid');
               valid = false;
            } else {
               presetEl.classList.remove('is-invalid');
            }

            const min = parseIntValue(tempMinEl);
            valid &= min.valid;

            const max = parseIntValue(tempMaxEl);
            valid &= max.valid;

            if (valid) {
               const validations = validateProbeTargetTemps(preset, min, max);
               presetEl.classList.toggle('is-invalid', !validations.preset);
               tempMinEl.classList.toggle('is-invalid', !validations.min);
               tempMaxEl.classList.toggle('is-invalid', !validations.max);
               valid = validations.valid;
            }

            if (!valid) {
               return;
            }

            WS.setProbeTargetTemp(probe, preset, tempToC(min.value), tempToC(max.value));
         } else {
            return;
         }
         obj.modal.hide();
      });
   }
}


export { validateProbeTargetTemps, isUnitC, setUnit, tempFromC, tempToC, initProbeSettingsModal };
