import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
globalThis.document = {
  visibilityState: 'visible',
  addEventListener(type, callback) { listeners[type] = callback; },
};
globalThis.window = { URL: {}, setTimeout };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
await import('../../webroot/assets/js/app.js');
const { wsOnMessage, validateSavedProbeReadings, probeColorForIndex,
  validateProbeTargetTemps, isStateUpdate, requestWakeLock, handleVisibilityChange,
  setDownloadLink } = await import('../../webroot/assets/js/app.js');
const { presetTempFromF } = await import('../../webroot/assets/js/probe-settings.js');

test('app entrypoint waits for document completion and exposes Cast callback', () => {
  assert.equal(typeof listeners.readystatechange, 'function');
  assert.equal(typeof window.__onGCastApiAvailable, 'function');
  listeners.readystatechange({});
  assert.equal(typeof listeners.readystatechange, 'function');
});

test('retains one screen wake lock and releases it when the page becomes hidden', async () => {
  const locks = [];
  navigator.wakeLock = {
    async request(type) {
      assert.equal(type, 'screen');
      const lock = {
        released: false,
        listeners: [],
        addEventListener(type, listener) { if (type === 'release') this.listeners.push(listener); },
        async release() {
          this.released = true;
          for (const listener of this.listeners) listener();
        },
      };
      locks.push(lock);
      return lock;
    },
  };

  await requestWakeLock();
  await requestWakeLock();
  assert.equal(locks.length, 1);

  document.visibilityState = 'hidden';
  await handleVisibilityChange();
  assert.equal(locks[0].released, true);

  document.visibilityState = 'visible';
  await handleVisibilityChange();
  assert.equal(locks.length, 2);
  document.visibilityState = 'hidden';
  await handleVisibilityChange();
  document.visibilityState = 'visible';
});

test('releases a wake lock if the page hides while its request is pending', async () => {
  let resolveRequest;
  let lock;
  navigator.wakeLock = { request: () => new Promise((resolve) => { resolveRequest = resolve; }) };
  document.visibilityState = 'visible';
  const pending = requestWakeLock();
  document.visibilityState = 'hidden';
  await handleVisibilityChange();
  lock = { released: false, async release() { this.released = true; } };
  resolveRequest(lock);
  await pending;
  assert.equal(lock.released, true);
  document.visibilityState = 'visible';
  navigator.wakeLock = undefined;
});

test('keeps the current download URL valid and revokes it when replaced', () => {
  const originalCreate = window.URL.createObjectURL;
  const originalRevoke = window.URL.revokeObjectURL;
  const created = [];
  const revoked = [];
  window.URL.createObjectURL = (blob) => { created.push(blob); return `blob:download-${created.length}`; };
  window.URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const link = {};
    const blob = new Blob(['{}'], { type: 'application/json' });
    setDownloadLink(link, blob);
    assert.equal(link.href, 'blob:download-1');
    assert.match(link.download, /^ibbq_.*\.json$/);
    assert.deepEqual(created, [blob]);
    assert.deepEqual(revoked, []);
    setDownloadLink(link, new Blob(['next']));
    assert.equal(link.href, 'blob:download-2');
    assert.deepEqual(revoked, ['blob:download-1']);
  } finally {
    window.URL.createObjectURL = originalCreate;
    window.URL.revokeObjectURL = originalRevoke;
  }
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

test('converts Fahrenheit preset temperatures for Celsius display', () => {
  assert.equal(presetTempFromF('125', true), 52);
  assert.equal(presetTempFromF('65', true), 18);
  assert.equal(presetTempFromF('125', false), 125);
  assert.equal(presetTempFromF(null, true), null);
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
