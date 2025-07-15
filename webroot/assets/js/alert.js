import * as Utils from './utils.js';
import * as WS from './websocket.js';

let alertModal;
let inStopHandler = false;

const alertAudio = new Audio('/assets/audio/AlertTone.mp3');

const initPlayback = () => {
   alertAudio.muted = true;
   alertAudio.play().catch(error => {
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
         obj.element.addEventListener('hide.bs.modal', (e) => {
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

      if (inStopHandler) {
         return;
      }
      WS.silenceAlarm();
   });

   obj.element.addEventListener('show.bs.modal', (e) => {
      alertAudio.play();
   });
};

const start = () => {
   alertModal.show();
};

const stop = () => {
   inStopHandler = true;
   alertModal.hide();
   inStopHandler = false;
};

export {
   init,
   start,
   stop,
};
