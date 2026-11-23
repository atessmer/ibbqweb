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

   let pendingInstall = null;
   window.addEventListener('beforeinstallprompt', (e) => {
      // Browsers can emit a newer event while an older install toast is still
      // visible. Retire the old event and its toast before showing the new one.
      pendingInstall?.toast.hide();
      e.preventDefault();
      const obj = renderToastPWAInstall();
      const install = {
         event: e,
         toast: obj.toast,
         status: 'available',
      };
      pendingInstall = install;

      obj.element.querySelector('.toast-body').addEventListener('click', async (e) => {
         if (pendingInstall !== install || install.status !== 'available') {
            return;
         }

         if (e.target.dataset.ibbqAction == "install") {
            // Claim before awaiting anything so rapid/double clicks cannot
            // invoke prompt() more than once for the same event.
            install.status = 'prompting';
            try {
               await install.event.prompt();
               const choice = await install.event.userChoice;
               if (choice?.outcome === 'dismissed') {
                  Cookie.create('pwaDeclined', '1', 365);
               }
            } catch (error) {
               // A rejected prompt/userChoice must not leave a reusable event.
               // Browser support varies, so release the UI state quietly.
            } finally {
               install.status = 'consumed';
               if (pendingInstall === install) {
                  pendingInstall = null;
               }
            }
         } else if (e.target.dataset.ibbqAction == "decline") {
            Cookie.create('pwaDeclined', '1', 365);
            install.status = 'consumed';
            pendingInstall = null;
         } else {
            // Click somewhere in the body outside a button
            return;
         }
      });
   });
}

export {
   init,
};
