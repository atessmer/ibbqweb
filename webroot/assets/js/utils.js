import * as Bootstrap from 'bootstrap';

const renderToast = (html) => {
   const template = document.createElement('template');
   template.innerHTML = html;

   const toastEl = template.content.firstElementChild;
   toastEl.addEventListener('hidden.bs.toast', (e) => {
      e.target.remove();
   });
   document.getElementById('toast-container').append(template.content);

   const toast = new Bootstrap.Toast(toastEl);
   toast.show();

   return {
      'toast': toast,
      'element': toastEl,
   };
}

const renderModal = (html) => {
   const template = document.createElement('template');
   template.innerHTML = html;

   const modalEl = template.content.firstElementChild;
   document.body.append(modalEl);

   const modal = new Bootstrap.Modal(modalEl);

   return {
      'modal': modal,
      'element': modalEl,
   };
}

export {
   renderToast,
   renderModal,
};
