import test from 'node:test';
import assert from 'node:assert/strict';

const sockets = [];
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static throwNext = false;
  constructor(url) {
    if (FakeWebSocket.throwNext) { FakeWebSocket.throwNext = false; throw new Error('constructor failed'); }
    this.url = url; this.readyState = 0; this.sent = []; sockets.push(this);
  }
  send(data) { if (this.throwOnSend) throw new Error('send failed'); this.sent.push(data); }
  close() { this.readyState = FakeWebSocket.CLOSED; this.onclose?.({ code: 1000 }); }
}
globalThis.WebSocket = FakeWebSocket;
globalThis.window = { location: { protocol: 'https:', host: 'grill.example' } };
const WS = await import('../../webroot/assets/js/websocket.js');

test('connect chooses secure endpoint and sends command payloads only when open', () => {
  WS.init();
  const socket = sockets.at(-1);
  assert.equal(socket.url, 'wss://grill.example/ws');
  assert.equal(WS.isConnected(), false);
  assert.equal(WS.setUnit(false), false);
  socket.readyState = FakeWebSocket.OPEN;
  assert.equal(WS.setProbeTargetTemp(2, 'custom.range', 10, Number.NaN), true);
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    cmd: 'set_probe_target_temp', probe: 2, preset: 'custom.range', min_temp: 10, max_temp: null,
  });
  WS.setUnit(true);
  WS.clearProbeTargetTemp(2);
  WS.silenceAlarm();
  WS.clearHistory();
  WS.powerOff();
  assert.deepEqual(socket.sent.slice(1).map(JSON.parse), [
    { cmd: 'set_unit', unit: 'C' },
    { cmd: 'set_probe_target_temp', probe: 2, preset: null, min_temp: null, max_temp: null },
    { cmd: 'silence_alarm' }, { cmd: 'clear_history' }, { cmd: 'poweroff' },
  ]);
  WS.disconnect();
});

test('connect is idempotent while a socket is connecting or open', () => {
  const before = sockets.length;
  WS.connect();
  assert.equal(sockets.length, before + 1);
  WS.connect();
  assert.equal(sockets.length, before + 1);
});

test('unexpected close notifies callbacks and reconnects; stale socket events are ignored', () => {
  const callbacks = [];
  let retry;
  globalThis.setTimeout = (callback) => { retry = callback; return 17; };
  globalThis.clearTimeout = () => { retry = null; };
  WS.disconnect();
  WS.init({
    onopen: () => callbacks.push('open'),
    onclose: (event) => callbacks.push(event.isDisconnect),
    onmessage: () => callbacks.push('message'),
  });
  const oldSocket = sockets.at(-1);
  oldSocket.readyState = FakeWebSocket.CLOSED;
  oldSocket.onclose({ code: 1006 });
  assert.deepEqual(callbacks, [true]);
  assert.equal(typeof retry, 'function');
  retry();
  const newSocket = sockets.at(-1);
  assert.notEqual(newSocket, oldSocket);
  oldSocket.onmessage({ data: 'stale' });
  assert.deepEqual(callbacks, [true]);
  newSocket.readyState = FakeWebSocket.OPEN;
  newSocket.onopen({});
  newSocket.onmessage({ data: 'fresh' });
  assert.deepEqual(callbacks, [true, 'open', 'message']);
});

test('constructor failures retry with bounded backoff and manual connect retries immediately', () => {
  const delays = [];
  let pending;
  globalThis.setTimeout = (callback, delay) => { delays.push(delay); pending = callback; return delays.length; };
  globalThis.clearTimeout = () => { pending = null; };
  WS.disconnect();
  FakeWebSocket.throwNext = true;
  WS.connect();
  assert.deepEqual(delays, [1000]);
  WS.connect();
  assert.equal(sockets.at(-1).readyState, FakeWebSocket.CONNECTING);
  assert.equal(pending, null);
  WS.disconnect();
});

test('send errors are contained and disconnect cancels pending retries', () => {
  let pending;
  globalThis.setTimeout = (callback, delay) => { pending = callback; return delay; };
  globalThis.clearTimeout = () => { pending = null; };
  WS.disconnect();
  WS.connect();
  const socket = sockets.at(-1);
  socket.readyState = FakeWebSocket.OPEN;
  socket.throwOnSend = true;
  assert.equal(WS.setUnit(true), false);
  assert.equal(typeof pending, 'function');
  WS.disconnect();
  assert.equal(pending, null);
});

test('repeated closes use capped exponential retry delays and reset on connect', () => {
  const delays = [];
  let pending;
  globalThis.setTimeout = (callback, delay) => { delays.push(delay); pending = callback; return delays.length; };
  globalThis.clearTimeout = () => { pending = null; };
  WS.disconnect();
  WS.connect();
  for (let i = 0; i < 7; i++) {
    const socket = sockets.at(-1);
    socket.readyState = FakeWebSocket.CLOSED;
    socket.onclose({ code: 1006 });
    pending();
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  WS.connect();
  const socket = sockets.at(-1);
  socket.readyState = FakeWebSocket.CLOSED;
  socket.onclose({ code: 1006 });
  assert.equal(delays.at(-1), 1000);
  WS.disconnect();
});
