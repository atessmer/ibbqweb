import test from 'node:test';
import assert from 'node:assert/strict';

const children = [];
const toastContainer = { append(fragment) { children.push(fragment.firstElementChild); } };
globalThis.document = {
  body: { append(element) { children.push(element); } },
  getElementById() { return toastContainer; },
  createElement() {
    const template = { content: {} };
    Object.defineProperty(template, 'innerHTML', {
      set(html) {
        template.content.firstElementChild = {
          html, listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; },
          remove() { this.removed = true; },
        };
      },
    });
    return template;
  },
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Browser' } });
const Bootstrap = await import('./bootstrap-stub.mjs');
const Utils = await import('../../webroot/assets/js/utils.js');

test('renderToast inserts, shows, and removes toast after hidden event', () => {
  const { toast, element } = Utils.renderToast('<div class="toast">hello</div>');
  assert.equal(children.at(-1), element);
  assert.equal(toast.shown, true);
  element.listeners['hidden.bs.toast']({ target: element });
  assert.equal(element.removed, true);
  assert.equal(Bootstrap.Toast.instances.at(-1).element, element);
});

test('renderModal appends modal and returns Bootstrap instance', () => {
  const { modal, element } = Utils.renderModal('<div class="modal">dialog</div>');
  assert.equal(children.at(-1), element);
  assert.equal(modal.element, element);
});

test('isCastReceiver checks for the CrKey user agent marker', () => {
  assert.equal(Utils.isCastReceiver(), false);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'CrKey/1' } });
  assert.equal(Utils.isCastReceiver(), true);
});
