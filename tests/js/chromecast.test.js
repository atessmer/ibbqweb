import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
const sentMessages = [];
const currentSession = {
  addMessageListener(namespace, listener) { this.messageListener = listener; },
  sendMessage(namespace, data) { sentMessages.push({ namespace, data }); },
};
const context = {
  setOptions(options) { this.options = options; },
  addEventListener(type, callback) { listeners[type] = callback; },
  getCurrentSession() { return currentSession; },
};
globalThis.cast = {
  framework: {
    CastContext: { getInstance: () => context },
    CastContextEventType: { SESSION_STATE_CHANGED: 'session-change' },
    SessionState: { SESSION_STARTED: 'started', SESSION_RESUMED: 'resumed', SESSION_ENDED: 'ended' },
  },
};
globalThis.chrome = { cast: { AutoJoinPolicy: { ORIGIN_SCOPED: 'origin' } } };
globalThis.window = { location: { origin: 'https://grill.example' } };
globalThis.document = {
  addEventListener(type, listener) { listeners[type] = listener; },
  querySelector() { return { dataset: { bsTarget: '#graph' } }; },
};
const Chromecast = await import('../../webroot/assets/js/chromecast.js');

test('sender configures Cast and sends active tab location on session start', () => {
  Chromecast.initCastApi();
  assert.deepEqual(context.options, { receiverApplicationId: '5CB45E5A', autoJoinPolicy: 'origin' });
  listeners['session-change']({ sessionState: 'started', session: currentSession });
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0].data, { type: 'loc', url: 'https://grill.example#graph' });
  assert.equal(typeof currentSession.messageListener, 'function');
});

test('tab changes send a URL only when a session exists', () => {
  listeners['shown.bs.tab']();
  assert.equal(sentMessages.length, 2);
  context.getCurrentSession = () => null;
  listeners['shown.bs.tab']();
  assert.equal(sentMessages.length, 2);
});

test('sender ignores missing or unsupported active tabs', () => {
  context.getCurrentSession = () => currentSession;
  document.querySelector = () => null;
  listeners['shown.bs.tab']();
  document.querySelector = () => ({ dataset: { bsTarget: '#other' } });
  listeners['shown.bs.tab']();
  assert.equal(sentMessages.length, 2);
});

test('receiver rejects navigation outside the same origin and app tabs', async () => {
  let messageHandler;
  const receiverMessages = [];
  const receiverContext = {
    start() {},
    addCustomMessageListener(namespace, handler) { messageHandler = handler; },
    sendCustomMessage(namespace, sender, data) { receiverMessages.push(data); },
    getSenders() { return []; },
    addEventListener() {},
    setApplicationState() {},
  };
  cast.framework.CastReceiverOptions = class {};
  cast.framework.CastReceiverContext = { getInstance: () => receiverContext };
  cast.framework.system = { MessageType: { JSON: 'json' }, EventType: {} };
  document.body = { classList: { add() {} } };
  document.querySelector = () => ({ textContent: 'Probes' });
  globalThis.navigator = { userAgent: 'CrKey' };
  const Receiver = await import('../../webroot/assets/js/chromecast.js?receiver');
  Receiver.initCastApi();

  messageHandler({ senderId: 'sender', data: { url: 'https://attacker.example/#graph' } });
  assert.equal(receiverMessages.length, 0);
  assert.equal(window.location.href, undefined);

  messageHandler({ senderId: 'sender', data: { url: 'https://grill.example/#graph' } });
  assert.equal(receiverMessages.length, 1);
  assert.equal(receiverMessages[0].url, 'https://grill.example/#graph');
  assert.equal(window.location.href, 'https://grill.example/#graph');
  delete globalThis.navigator;
});
