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

export {
   renderToast,
};
