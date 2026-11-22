export const toasts = [];
export const modals = [];
export function renderToast(html) {
  const toast = { hideCount: 0, hide() { this.hideCount++; }, show() { this.showCount = (this.showCount || 0) + 1; } };
  const body = { listeners: {}, addEventListener(type, cb) { this.listeners[type] = cb; } };
  const install = { dataset: { ibbqAction: 'install' } };
  const decline = { dataset: { ibbqAction: 'decline' } };
  const element = { html, body, install, decline, listeners: {}, addEventListener(type, cb) { this.listeners[type] = cb; }, querySelector() { return body; } };
  toasts.push({ toast, element });
  return { toast, element };
}
export function renderModal(html) {
  const element = { html, listeners: {}, addEventListener(type, cb) { this.listeners[type] = cb; } };
  const modal = {
    showCount: 0, hideCount: 0,
    show() { this.showCount++; },
    hide() { this.hideCount++; element.listeners['hide.bs.modal']?.({ target: element }); },
  };
  modals.push({ modal, element });
  return { modal, element };
}
export function isCastReceiver() { return false; }
