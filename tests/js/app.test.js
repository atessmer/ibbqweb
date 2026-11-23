import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
globalThis.document = {
  addEventListener(type, callback) { listeners[type] = callback; },
};
globalThis.window = {};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
await import('../../webroot/assets/js/app.js');
const { wsOnMessage } = await import('../../webroot/assets/js/app.js');

test('app entrypoint waits for document completion and exposes Cast callback', () => {
  assert.equal(typeof listeners.readystatechange, 'function');
  assert.equal(typeof window.__onGCastApiAvailable, 'function');
  listeners.readystatechange({});
  assert.equal(typeof listeners.readystatechange, 'function');
});

test('ignores malformed JSON and invalid WebSocket update payloads', () => {
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    assert.doesNotThrow(() => wsOnMessage({ data: '{not json' }));
    assert.doesNotThrow(() => wsOnMessage({ data: JSON.stringify({ cmd: 'state_update' }) }));
    assert.doesNotThrow(() => wsOnMessage({ data: JSON.stringify({ cmd: 'unit_update', unit: 'K' }) }));
    assert.doesNotThrow(() => wsOnMessage({ data: JSON.stringify(null) }));
    assert.equal(errors.length, 4);
  } finally {
    console.error = originalError;
  }
});
