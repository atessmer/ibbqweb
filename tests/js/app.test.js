import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
globalThis.document = {
  addEventListener(type, callback) { listeners[type] = callback; },
};
globalThis.window = {};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
await import('../../webroot/assets/js/app.js');

test('app entrypoint waits for document completion and exposes Cast callback', () => {
  assert.equal(typeof listeners.readystatechange, 'function');
  assert.equal(typeof window.__onGCastApiAvailable, 'function');
  listeners.readystatechange({});
  assert.equal(typeof listeners.readystatechange, 'function');
});
