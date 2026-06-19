import * as Bootstrap from 'bootstrap';

const isCasting = () => {
   const urlParams = new URLSearchParams(window.location.search);
   const cast = urlParams.get('cast');

   return cast != null && (cast.toLowerCase() == 'true' || cast == '1');
};

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
   isCasting,
   renderToast,
   renderModal,
};
