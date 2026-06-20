import * as Cookie from './cookies.js';
import * as Utils from './utils.js';

const renderToastPWAInstall = () => {
   const html = `
      <div class="toast align-items-center" role="alert" aria-live="assertive" aria-atomic="true" data-bs-autohide="false">
        <div class="toast-header">
          <i class="bi bi-gear-fill me-1"></i>
          <strong class="me-auto">Install</strong>
          <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body">
          Install this website as an application for a better experience!
          <div class="mt-2 pt-2 border-top text-end">
            <button type="button" class="btn btn-outline-secondary btn-sm" data-ibbq-action="decline" data-bs-dismiss="toast">Decline</button>
            <button type="button" class="btn btn-secondary btn-sm" data-ibbq-action="install" data-bs-dismiss="toast">Install</button>
          </div>
        </div>
      </div>
   `;

   return Utils.renderToast(html);
}

const init = () => {
   if (Cookie.read('pwaDeclined') != null) {
      // Cookies can only be valid for so long, so refresh the expiration
      // date on each page load
      Cookie.create('pwaDeclined', '1', 365);
      return;
   }

   window.addEventListener('beforeinstallprompt', (e) => {
      let installPWAPrompt = e;
      e.preventDefault();
      const obj = renderToastPWAInstall();

      obj.element.querySelector('.toast-body').addEventListener('click', (e) => {
         if (e.target.dataset.ibbqAction == "install") {
            installPWAPrompt.prompt();
            installPWAPrompt.userChoice;
         } else if (e.target.dataset.ibbqAction == "decline") {
            Cookie.create('pwaDeclined', '1', 365);
         } else {
            // Click somewhere in the body outside a button
            return;
         }
         installPWAPrompt = null;
      });
   });
}

export {
   init,
};
