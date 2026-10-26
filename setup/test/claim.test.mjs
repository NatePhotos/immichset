import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCode, normaliseCode, codeMatches, createLimiter, makeToken, checkToken, sameOrigin } from '../claim.mjs';

test('a code is 12 characters of an unambiguous alphabet, shown in threes', () => {
  for (let i = 0; i < 200; i++) assert.match(makeCode(), /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.notEqual(makeCode(), makeCode());
});

test('a code is accepted however it is typed, and nothing else is', () => {
  const c = 'ABCD-EF12-3456';
  for (const t of ['ABCD-EF12-3456', 'abcd ef12 3456', 'abcdef123456', ' ABCD-EF12-3456 ']) assert.ok(codeMatches(t, c), t);
  assert.ok(codeMatches('ABCD-EFl2-3456', c), 'a lowercase L reads as 1');
  for (const t of ['', 'ABCD-EF12-3457', 'ABCD-EF12', 'ABCD-EF12-3456-0', null, undefined]) assert.equal(codeMatches(t, c), false, String(t));
  assert.equal(codeMatches('', ''), false, 'an empty code never matches an empty code');
  assert.equal(normaliseCode('o0-iI'), '0011');
});

test('ten wrong tries from one address block it; the window frees it', () => {
  let t = 0; const l = createLimiter({ now: () => t });
  for (let i = 0; i < 10; i++) { assert.equal(l.blocked('1.1.1.1'), null); l.fail('1.1.1.1'); }
  assert.equal(l.blocked('1.1.1.1'), 'ip');
  assert.equal(l.blocked('2.2.2.2'), null);
  t += 16 * 60_000; assert.equal(l.blocked('1.1.1.1'), null);
});

test('sixty wrong tries from anywhere lock it until restart, however many addresses are used', () => {
  let t = 0; const l = createLimiter({ now: () => t });
  for (let i = 0; i < 60; i++) l.fail('10.0.0.' + (i % 30));
  assert.equal(l.blocked('9.9.9.9'), 'locked');
  t += 30 * 60_000; assert.equal(l.blocked('9.9.9.9'), 'locked');
  t += 31 * 60_000; assert.equal(l.blocked('9.9.9.9'), null, 'the hour passes');
});

test('the setup cookie is signed, expires, and is tied to the secret', () => {
  const tok = makeToken('s1', 1000, 5000);
  assert.ok(checkToken('s1', tok, 5500));
  assert.equal(checkToken('s1', tok, 6001), false);
  assert.equal(checkToken('s2', tok, 5500), false);
  assert.equal(checkToken('s1', tok.replace(/.$/, c => (c === 'a' ? 'b' : 'a')), 5500), false);
  assert.equal(checkToken('s1', '', 5500), false); assert.equal(checkToken('s1', 'x.y', 5500), false);
});

test('the setup API only answers the page it served', () => {
  assert.equal(sameOrigin({ origin: 'https://g.test', host: 'g.test' }), true);
  assert.equal(sameOrigin({ origin: 'https://g.test', host: 'other.test' }), false);
  assert.equal(sameOrigin({ host: 'g.test' }), false);
  assert.equal(sameOrigin({ origin: 'https://g.test', 'x-forwarded-host': 'g.test', host: 'internal:3000' }), true);
  assert.equal(sameOrigin({ origin: 'not a url', host: 'g.test' }), false);
});
