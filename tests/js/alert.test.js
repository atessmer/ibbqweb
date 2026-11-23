import test from 'node:test';
import assert from 'node:assert/strict';

class FakeAudio {
  static instances = [];
  constructor() { this.calls = []; this.currentTime = 0; this.muted = false; FakeAudio.instances.push(this); }
  play() { this.calls.push('play'); return FakeAudio.playResult?.() ?? Promise.resolve(); }
  pause() { this.calls.push('pause'); }
}
FakeAudio.playResult = null;
globalThis.Audio = FakeAudio;
globalThis.alert = (message) => { globalThis.alertMessages.push(message); };
globalThis.alertMessages = [];
const Utils = await import('./fake-utils.mjs');
const WS = await import('./fake-websocket.mjs');
const Alert = await import('../../webroot/assets/js/alert.js');

test('alert start and stop control modal and suppress programmatic silence command', async () => {
  Alert.start();
  assert.equal(Utils.modals.length, 0);
  Alert.init();
  await Promise.resolve();
  await Promise.resolve();
  const { modal, element } = Utils.modals.at(-1);
  Alert.start();
  assert.equal(modal.showCount, 1);
  FakeAudio.playResult = () => Promise.reject(new Error('play denied'));
  element.listeners['show.bs.modal']();
  await Promise.resolve();
  await Promise.resolve();
  assert.match(globalThis.alertMessages.at(-1), /play denied/);
  FakeAudio.playResult = null;
  element.listeners['hide.bs.modal']({});
  assert.equal(WS.calls.length, 1);
  Alert.start();
  Alert.start();
  assert.equal(modal.showCount, 2, 'repeated starts do not duplicate an active alert');
  Alert.stop();
  Alert.stop();
  assert.equal(modal.hideCount, 1);
  assert.equal(WS.calls.length, 1);

  Alert.start();
  const hide = modal.hide;
  modal.hide = () => { throw new Error('hide failed'); };
  assert.throws(() => Alert.stop(), /hide failed/);
  modal.hide = hide;
  element.listeners['hide.bs.modal']({});
  assert.equal(WS.calls.length, 2, 'stop guard resets even when modal.hide throws');
});
