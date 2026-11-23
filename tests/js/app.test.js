import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
globalThis.document = {
  addEventListener(type, callback) { listeners[type] = callback; },
};
globalThis.window = {};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
await import('../../webroot/assets/js/app.js');
const { wsOnMessage, validateSavedProbeReadings } = await import('../../webroot/assets/js/app.js');

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

test('validates saved readings and sorts unique timestamps', () => {
  const readings = validateSavedProbeReadings([
    { ts: 2000, probes: [21, null] },
    { ts: 1000, probes: [20, null] },
  ]);
  assert.deepEqual(readings.map(({ ts }) => ts), [1000, 2000]);
  assert.deepEqual(validateSavedProbeReadings([]), []);
});

test('rejects malformed saved readings, inconsistent probes, invalid timestamps, and duplicates', () => {
  const invalidHistories = [
    [null],
    [[{ ts: 1, probes: [20] }]],
    [{ ts: 1.5, probes: [20] }],
    [{ ts: Number.MAX_SAFE_INTEGER + 1, probes: [20] }],
    [{ ts: 1, probes: [] }],
    [{ ts: 1, probes: [20] }, { ts: 2, probes: [20, null] }],
    [{ ts: 1, probes: [20] }, { ts: 1, probes: [21] }],
  ];
  for (const readings of invalidHistories) {
    assert.throws(() => validateSavedProbeReadings(readings), /Invalid data structure/);
  }
});
