import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
globalThis.document = {
  addEventListener(type, callback) { listeners[type] = callback; },
};
globalThis.window = {};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
await import('../../webroot/assets/js/app.js');
const { wsOnMessage, validateSavedProbeReadings, probeColorForIndex,
  validateProbeTargetTemps, isStateUpdate } = await import('../../webroot/assets/js/app.js');

test('app entrypoint waits for document completion and exposes Cast callback', () => {
  assert.equal(typeof listeners.readystatechange, 'function');
  assert.equal(typeof window.__onGCastApiAvailable, 'function');
  listeners.readystatechange({});
  assert.equal(typeof listeners.readystatechange, 'function');
});

test('probe colors cycle through the palette when the index exceeds it', () => {
  assert.equal(probeColorForIndex(0), '#357bcc');
  assert.equal(probeColorForIndex(3), '#bdb320');
  assert.equal(probeColorForIndex(4), '#357bcc');
  assert.equal(probeColorForIndex(8), '#357bcc');
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

test('validates user temperature limits and min/max relationships', () => {
  assert.deepEqual(validateProbeTargetTemps('custom.temp', null, 32),
    { valid: true, preset: true, min: true, max: true });
  assert.deepEqual(validateProbeTargetTemps('custom.range', 32, 572),
    { valid: true, preset: true, min: true, max: true });
  for (const [preset, min, max] of [
    ['custom.temp', null, 31], ['custom.temp', null, 573],
    ['custom.range', 100, 100], ['custom.range', 101, 100],
    ['custom.range', 31, 100], ['custom.range', 100, 573],
    ['custom.range', null, 100], ['custom.range', 100, null],
  ]) {
    assert.equal(validateProbeTargetTemps(preset, min, max).valid, false, `${preset}: ${min}..${max}`);
  }
  assert.deepEqual(validateProbeTargetTemps('custom.range', null, 100),
    { valid: false, preset: true, min: false, max: true });
  assert.deepEqual(validateProbeTargetTemps('', 100, 200),
    { valid: false, preset: false, min: true, max: true });
});

test('requires complete server updates and accepts only valid battery levels', () => {
  const update = {
    connected: false, battery_level: null, full_history: false,
    target_temps: {}, target_temp_alert: false, probe_readings: [],
  };
  assert.equal(isStateUpdate(update), true);
  assert.equal(isStateUpdate({ ...update, battery_level: 0 }), true);
  assert.equal(isStateUpdate({ ...update, battery_level: 0xffff }), true);
  for (const battery_level of [-1, 0.5, 65536, Infinity, '50', undefined]) {
    assert.equal(isStateUpdate({ ...update, battery_level }), false, `${battery_level}`);
  }
  for (const required of ['connected', 'full_history', 'target_temp_alert', 'target_temps', 'probe_readings']) {
    const incomplete = { ...update };
    delete incomplete[required];
    assert.equal(isStateUpdate(incomplete), false, required);
  }
});
