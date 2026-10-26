import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { scanVars, render, unsubToken, readUnsubToken, selectRecipients, planHash, classify, verifySvix, isReservedAddress, maskEmail, firstName } from '../blast.mjs';

const ctx = { brand: 'Studio', site: 'https://studio.test', address: '1 Main St, Town', unsubscribe: 'https://g.test/unsubscribe/abc', logo: 'https://g.test/brand/logo' };
const gal = { title: 'Spring', subtitle: 'May 1st', link: 'https://g.test/spring', expiry: 'June 1' };

test('a name typed into a form cannot become markup, in the body or the subject', () => {
  const r = render({ subject: 'Hi {{name}}', body: 'Dear {{name}},\n\nHello' }, { name: '"><img src=x onerror=1> Bob', gallery: null }, ctx);
  assert.ok(!r.html.includes('<img src=x'));
  assert.ok(r.html.includes('&quot;&gt;&lt;img'));
  const r2 = render({ subject: 'Hi {{name}}', body: 'x' }, { name: 'Ann\r\nBcc: evil@x.com', gallery: null }, ctx);
  assert.ok(!/[\r\n]/.test(r2.subject));
  assert.equal(r2.subject, 'Hi Ann');
});

test('the greeting is the first word of the name, or "there"', () => {
  assert.equal(firstName('Sam Lee'), 'Sam'); assert.equal(firstName(''), 'there'); assert.equal(firstName(null), 'there');
  assert.match(render({ subject: 's', body: 'Hi {{name}}' }, { name: null, gallery: null }, ctx).text, /Hi there/);
});

test('unknown placeholders are reported, known ones counted, gallery ones flagged', () => {
  const s = scanVars('Hi {{name}} {{ LINK }}', '{{nope}} {{brand}}');
  assert.deepEqual(s.unknown, ['nope']);
  assert.ok(s.used.includes('link') && s.used.includes('name') && s.used.includes('brand'));
  assert.equal(s.usesGallery, true);
  assert.equal(scanVars('Hi {{name}}').usesGallery, false);
});

test('gallery placeholders with no gallery are reported unresolved', () => {
  const r = render({ subject: '{{title}}', body: 'See {{link}}' }, { name: 'A', gallery: null }, ctx);
  assert.deepEqual(r.unresolved.sort(), ['link', 'title']);
  const ok = render({ subject: '{{title}}', body: 'See {{link}} before {{expiry}}' }, { name: 'A', gallery: gal }, ctx);
  assert.deepEqual(ok.unresolved, []);
  assert.equal(ok.subject, 'Spring');
  assert.ok(ok.html.includes('href="https://g.test/spring"'));
});

test('links are anchors in html and plain urls in text; a javascript: url is dropped', () => {
  const r = render({ subject: 's', body: 'Go {{link}}' }, { name: 'A', gallery: { ...gal, link: 'javascript:alert(1)' } }, ctx);
  assert.ok(!r.html.includes('javascript:'));
  const t = render({ subject: 's', body: 'Go {{link}}' }, { name: 'A', gallery: gal }, ctx);
  assert.match(t.text, /Go https:\/\/g\.test\/spring/);
});

test('every mailing carries the address, the reason and the unsubscribe link', () => {
  const r = render({ subject: 's', body: 'b' }, { name: 'A', gallery: null }, ctx);
  for (const part of ['1 Main St, Town', 'registered for a gallery with Studio', 'https://g.test/unsubscribe/abc']) {
    assert.ok(r.html.includes(part), 'html ' + part); assert.ok(r.text.includes(part), 'text ' + part);
  }
});

test('unsubscribe tokens round-trip, hide the address, and reject tampering or another secret', () => {
  const t = unsubToken('Pat@Example.com', 7, 'secret-1');
  assert.deepEqual(readUnsubToken(t, 'secret-1'), { email: 'pat@example.com', mailing: 7 });
  assert.ok(!Buffer.from(t, 'base64url').toString('latin1').includes('pat@'));
  assert.equal(readUnsubToken(t, 'secret-2'), null);
  const bad = Buffer.from(t, 'base64url'); bad[bad.length - 1] ^= 1;
  assert.equal(readUnsubToken(bad.toString('base64url'), 'secret-1'), null);
  assert.equal(readUnsubToken('garbage', 'secret-1'), null);
  assert.notEqual(unsubToken('a@b.co', 1, 's'), unsubToken('a@b.co', 1, 's'));   /* random IV */
  assert.equal(maskEmail('pat@example.com'), 'p•••@example.com');
});

const NOW = Date.parse('2026-06-01T00:00:00Z');
const rows = [
  { email: 'Ann@x.com', name: 'Ann', gid: 2, title: 'New', subtitle: null, slug: 'new', expires_at: null, published_at: '2026-05-01', dl_at: null },
  { email: 'ann@x.com', name: 'Ann Old', gid: 1, title: 'Old', subtitle: null, slug: 'old', expires_at: '2026-01-01', published_at: '2025-05-01', dl_at: '2026-01-02' },
  { email: 'bob@x.com', name: null, gid: 1, title: 'Old', subtitle: null, slug: 'old', expires_at: '2026-01-01', published_at: '2025-05-01', dl_at: null },
  { email: 'hid@x.com', name: 'H', gid: 2, title: 'New', subtitle: null, slug: 'new', expires_at: null, published_at: '2026-05-01', dl_at: null },
  { email: 'gone@x.com', name: 'G', gid: 2, title: 'New', subtitle: null, slug: 'new', expires_at: null, published_at: '2026-05-01', dl_at: null },
  { email: 'smoke@example.invalid', name: 'S', gid: 2, title: 'New', subtitle: null, slug: 'new', expires_at: null, published_at: '2026-05-01', dl_at: null },
];

test('one address once, newest live gallery, hidden/suppressed/reserved left out', () => {
  const sel = selectRecipients({ rows, hidden: new Set(['hid@x.com']), suppressed: new Map([['gone@x.com', { reason: 'unsubscribed' }]]), now: NOW });
  assert.deepEqual(sel.send.map(s => s.email), ['ann@x.com', 'bob@x.com']);
  assert.equal(sel.send[0].galleryId, 2);                 /* the live one, not the expired one */
  assert.equal(sel.send[0].name, 'Ann');
  assert.deepEqual(Object.fromEntries(sel.skipped.map(s => [s.email, s.reason])), { 'gone@x.com': 'unsubscribed', 'smoke@example.invalid': 'reserved' });
});

test('a template that needs a gallery skips people with no live one', () => {
  const sel = selectRecipients({ rows, usesGallery: true, now: NOW });
  assert.ok(sel.skipped.some(s => s.email === 'bob@x.com' && s.reason === 'no_live_gallery'));
  assert.ok(sel.send.some(s => s.email === 'ann@x.com'));
});

test('the downloaded and single-gallery filters match the contacts list', () => {
  assert.deepEqual(selectRecipients({ rows, who: 'downloaded', now: NOW }).send.map(s => s.email), ['ann@x.com']);
  assert.deepEqual(selectRecipients({ rows, gallery: 1, now: NOW }).send.map(s => s.email), ['ann@x.com', 'bob@x.com']);
});

test('a picked address that is not a contact is refused, and bounces are named', () => {
  const sel = selectRecipients({ rows, picked: ['ann@x.com', 'stranger@x.com', 'gone@x.com'], suppressed: new Map([['gone@x.com', { reason: 'bounced' }]]), now: NOW });
  assert.deepEqual(sel.send.map(s => s.email), ['ann@x.com']);
  assert.ok(sel.skipped.some(s => s.email === 'stranger@x.com' && s.reason === 'not_a_contact'));
  assert.ok(sel.skipped.some(s => s.email === 'gone@x.com' && s.reason === 'bounced'));
});

test('the plan hash ignores order but not content', () => {
  const snap = { subject: 'a', body: 'b' };
  const h = planHash(snap, [{ email: 'a@x' }, { email: 'b@x' }]);
  assert.equal(h, planHash(snap, [{ email: 'b@x' }, { email: 'a@x' }]));
  assert.notEqual(h, planHash(snap, [{ email: 'a@x' }]));
  assert.notEqual(h, planHash({ subject: 'a', body: 'c' }, [{ email: 'a@x' }, { email: 'b@x' }]));
});

test('reserved addresses', () => {
  for (const e of ['a@b.invalid', 'a@x.test', 'a@example.com', 'a@foo.example', 'a@localhost.localhost']) assert.ok(isReservedAddress(e), e);
  assert.ok(!isReservedAddress('a@gmail.com'));
});

test('what to do with the mail service\'s answers', () => {
  assert.equal(classify(200, null, 1).action, 'sent');
  assert.deepEqual(classify(429, '12', 1), { action: 'retry', delayMs: 12000, count: false });
  assert.equal(classify(429, null, 1).delayMs, 30000);
  assert.equal(classify(422, null, 1).action, 'fail');
  assert.equal(classify(401, null, 1).action, 'pause');
  assert.equal(classify(403, null, 1).action, 'pause');
  assert.deepEqual([1, 2, 3].map(n => classify(503, null, n).delayMs), [60000, 300000, 1800000]);
  assert.equal(classify(503, null, 4).action, 'fail');
  assert.equal(classify(0, null, 1).action, 'retry');
});

test('webhook signatures: good, bad, stale', () => {
  const secret = 'whsec_' + Buffer.from('k'.repeat(24)).toString('base64');
  const now = 1_800_000_000_000, ts = String(now / 1000), body = '{"type":"email.bounced"}';
  const sig = 'v1,' + createHmac('sha256', Buffer.from('k'.repeat(24))).update(`m1.${ts}.${body}`).digest('base64');
  const h = { 'svix-id': 'm1', 'svix-timestamp': ts, 'svix-signature': sig };
  assert.equal(verifySvix(h, body, secret, now), true);
  assert.equal(verifySvix(h, body + ' ', secret, now), false);
  assert.equal(verifySvix({ ...h, 'svix-signature': 'v1,AAAA' }, body, secret, now), false);
  assert.equal(verifySvix(h, body, secret, now + 400_000), false);
  assert.equal(verifySvix(h, body, '', now), false);
});

test('a template that needs an expiry date skips people whose galleries have none', () => {
  const r2 = rows.map(r => r.email === 'bob@x.com' ? { ...r, gid: 3, expires_at: null, published_at: '2026-05-01' } : r);
  const sel = selectRecipients({ rows: r2, usesGallery: true, needsExpiry: true, now: NOW });
  assert.ok(sel.skipped.some(s => s.email === 'bob@x.com' && s.reason === 'no_live_gallery'));
  assert.ok(sel.send.every(s => s.email !== 'bob@x.com'));
  assert.ok(selectRecipients({ rows: r2, usesGallery: true, now: NOW }).send.some(s => s.email === 'bob@x.com'));
});
