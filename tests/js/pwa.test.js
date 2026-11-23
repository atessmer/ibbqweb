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

test('install prompt is prevented, consumed once, and accepted choice is handled', async () => {
  document.cookie = '';
  PWA.init();
  let prevented = false;
  let prompted = false;
  const promptEvent = { preventDefault() { prevented = true; }, prompt() { prompted = true; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  listeners.beforeinstallprompt(promptEvent);
  const element = Utils.toasts.at(-1).element;
  const click = element.body.listeners.click({ target: element.install });
  element.body.listeners.click({ target: element.install });
  await click;
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

test('dismissed choice is remembered and stale toast cannot invoke a replaced prompt', async () => {
  document.cookie = '';
  PWA.init();
  let stalePrompted = false;
  const staleEvent = { preventDefault() {}, prompt() { stalePrompted = true; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  listeners.beforeinstallprompt(staleEvent);
  const stale = Utils.toasts.at(-1);

  const currentEvent = { preventDefault() {}, prompt() {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
  listeners.beforeinstallprompt(currentEvent);
  const current = Utils.toasts.at(-1);

  stale.element.body.listeners.click({ target: stale.element.install });
  const action = current.element.body.listeners.click({ target: current.element.install });
  await action;
  assert.equal(stalePrompted, false);
  assert.equal(stale.toast.hideCount, 1);
  assert.equal(Cookie.read('pwaDeclined'), '1');
});

test('rejected prompt is safely consumed', async () => {
  document.cookie = '';
  PWA.init();
  let calls = 0;
  const event = { preventDefault() {}, prompt() { calls++; return Promise.reject(new Error('unavailable')); }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  listeners.beforeinstallprompt(event);
  const element = Utils.toasts.at(-1).element;
  const action = element.body.listeners.click({ target: element.install });
  await action;
  element.body.listeners.click({ target: element.install });
  assert.equal(calls, 1);
});
