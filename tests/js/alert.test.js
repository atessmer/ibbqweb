import test from 'node:test';
import assert from 'node:assert/strict';

class FakeAudio {
  constructor() { this.calls = []; this.currentTime = 0; this.muted = false; }
  play() { this.calls.push('play'); return Promise.resolve(); }
  pause() { this.calls.push('pause'); }
}
globalThis.Audio = FakeAudio;
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
  element.listeners['show.bs.modal']();
  element.listeners['hide.bs.modal']({});
  assert.equal(WS.calls.length, 1);
  Alert.stop();
  assert.equal(modal.hideCount, 1);
  assert.equal(WS.calls.length, 1);
});
