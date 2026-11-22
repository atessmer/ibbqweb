import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
globalThis.window = { addEventListener(type, callback) { listeners[type] = callback; } };
globalThis.document = {};
const Cookie = await import('../../webroot/assets/js/cookies.js');
const Utils = await import('./fake-utils.mjs');
const PWA = await import('../../webroot/assets/js/pwa.js');

test('declined prompt refreshes cookie and suppresses install listener', () => {
  Cookie.create('pwaDeclined', '1');
  PWA.init();
  assert.equal(typeof listeners.beforeinstallprompt, 'undefined');
  assert.match(document.cookie, /pwaDeclined=1/);
});

test('install prompt is prevented and install action invokes prompt', () => {
  document.cookie = '';
  PWA.init();
  let prevented = false;
  let prompted = false;
  const promptEvent = { preventDefault() { prevented = true; }, prompt() { prompted = true; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  listeners.beforeinstallprompt(promptEvent);
  const element = Utils.toasts.at(-1).element;
  element.body.listeners.click({ target: element.install });
  assert.equal(prevented, true);
  assert.equal(prompted, true);
});

test('decline action writes the remembered choice; body click is ignored', () => {
  document.cookie = '';
  PWA.init();
  const event = { preventDefault() {}, prompt() { assert.fail('not prompted'); }, userChoice: Promise.resolve() };
  listeners.beforeinstallprompt(event);
  const element = Utils.toasts.at(-1).element;
  element.body.listeners.click({ target: { dataset: {} } });
  assert.equal(Cookie.read('pwaDeclined'), null);
  element.body.listeners.click({ target: element.decline });
  assert.equal(Cookie.read('pwaDeclined'), '1');
});
