import test from 'node:test';
import assert from 'node:assert/strict';

let cookieJar = '';
const cookieWrites = [];
globalThis.document = {};
Object.defineProperty(globalThis.document, 'cookie', {
  get() { return cookieJar; },
  set(value) {
    cookieWrites.push(value);
    const [pair] = value.split(';');
    const [name] = pair.split('=');
    const existing = cookieJar.split(';').map((item) => item.trim()).filter(Boolean)
      .filter((item) => item.slice(0, item.indexOf('=')) !== name);
    existing.push(pair);
    cookieJar = existing.join('; ');
  },
});
const Cookie = await import('../../webroot/assets/js/cookies.js');

test('create writes cookie at root and read preserves equals signs', () => {
  Cookie.create('session', 'abc=123');
  assert.match(document.cookie, /session=abc=123/);
  assert.match(cookieWrites.at(-1), /; path=\/$/);
  assert.equal(Cookie.read('session'), 'abc=123');
});

test('read trims cookie whitespace and returns null when absent', () => {
  cookieJar = 'first=1; second=two';
  assert.equal(Cookie.read('second'), 'two');
  assert.equal(Cookie.read('missing'), null);
});

test('erase writes an already expired cookie', () => {
  cookieJar = 'gone=value';
  Cookie.erase('gone');
  assert.match(document.cookie, /gone=$/);
  assert.match(cookieWrites.at(-1), /expires=/i);
  assert.match(cookieWrites.at(-1), /; path=\/$/);
});
