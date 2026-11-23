import * as Utils from './utils.js';
import * as WS from './websocket.js';

let alertModal = null;
const AlertState = Object.freeze({
   INACTIVE: 'inactive',
   ACTIVE: 'active',
   STOPPING: 'stopping'
});
let alertState = AlertState.INACTIVE;

const alertAudio = new Audio('/assets/audio/AlertTone.mp3');

const reportAudioError = (error) => {
   alert("Audio notifications are blocked by your browser, please " +
         "check browser documentation for details:\n\n" + error);
};

const playAudio = () => {
   try {
      return Promise.resolve(alertAudio.play());
   } catch (error) {
      return Promise.reject(error);
   }
};

const initPlayback = () => {
   alertAudio.muted = true;
   playAudio().catch(error => {
      const html = `
         <div class="modal fade" id="audioNoticeModal" tabindex="-1" aria-hidden="true">
           <div class="modal-dialog modal-dialog-centered">
             <div class="modal-content">
               <div class="modal-header">
                 <h5 class="modal-title" id="audioNoticeModalLabel">Audio Notice</h5>
                 <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
               </div>
               <div class="modal-body">
                 This page plaus audio notifications when a temperature probe target is set and exceeded.
               </div>
             </div>
           </div>
         </div>
      `;

      const obj = Utils.renderModal(html);

      obj.element.addEventListener('hidden.bs.modal', (e) => {
         e.target.remove();
      });
      obj.modal.show();

      return new Promise((resolve, reject) => {
         obj.element.addEventListener('hide.bs.modal', () => {
            // Avoid warning about aria-hidden when the element retains focus
            document.activeElement.blur();

            alertAudio.muted = true;
            playAudio().then(() => {
               resolve();
            }).catch(error => {
               reject(error);
            });
         });
      })
   }).then(() => {
      alertAudio.pause();
      alertAudio.currentTime = 0;
      alertAudio.muted = false;
      alertAudio.loop = true;
   }).catch(error => {
      reportAudioError(error);
   });
};

const init = () => {
   initPlayback();
   initAlertModal();
};

const initAlertModal = () => {
   const html = `
      <div class="modal fade" id="tempAlertModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="tempAlertModalLabel">Temperature Probe Alert</h5>
            </div>
            <div class="modal-body">
              Target temperature alert!
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-danger flex-grow-1" data-bs-dismiss="modal">Silence</button>
            </div>
          </div>
        </div>
      </div>
   `;

   const obj = Utils.renderModal(html);
   alertModal = obj.modal;

   obj.element.addEventListener('hide.bs.modal', (e) => {
      alertAudio.pause();
      alertAudio.currentTime = 0;

      const wasActive = alertState === AlertState.ACTIVE;
      alertState = AlertState.INACTIVE;
      if (!wasActive) {
         return;
      }
      WS.silenceAlarm();
   });

   obj.element.addEventListener('show.bs.modal', (e) => {
      playAudio().catch(reportAudioError);
   });
};

const start = () => {
   if (alertModal != null && alertState === AlertState.INACTIVE) {
      alertState = AlertState.ACTIVE;
      alertModal.show();
   }
};

const stop = () => {
   if (alertModal != null && alertState === AlertState.ACTIVE) {
      alertState = AlertState.STOPPING;
      try {
         alertModal.hide();
      } finally {
         if (alertState === AlertState.STOPPING) {
            // A failed or deferred hide did not end the active alert.
            alertState = AlertState.ACTIVE;
         }
      }
   }
};

export {
   init,
   start,
   stop,
};
