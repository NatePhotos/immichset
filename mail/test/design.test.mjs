import test from 'node:test';
import assert from 'node:assert/strict';
import { render, cleanDesign, planHash } from '../blast.mjs';

const ctx = { brand: 'Studio', site: 'https://studio.test', address: '1 Main St', unsubscribe: 'https://g.test/unsubscribe/abc', logo: 'https://g.test/brand/logo',
              social: { url: 'https://instagram.com/studio', label: '@studio' }, replyTo: true, imageBase: 'https://g.test/mail/img/' };
const gal = { title: 'Spring', subtitle: '', link: 'https://g.test/spring', expiry: 'June 1, 2027', cover: 'https://g.test/api/g/spring/cover' };
const FILE = 'a'.repeat(20) + '.jpg';
const r = (design, body = 'Hello', who = { name: 'Ann', gallery: gal }) => render({ subject: 's', body, design }, who, ctx);

test('the design is cut down to a known shape', () => {
  const d = cleanDesign({ preheader: 'x'.repeat(500), title: 'a\nb', image: { mode: 'custom', file: '../../etc/passwd' }, button: { text: 'Go', mode: 'custom', url: 'javascript:alert(1)' }, showExpiry: 'yes', extra: 1 });
  assert.equal(d.preheader.length, 200); assert.equal(d.title, 'a b');
  assert.deepEqual(d.image, { mode: 'none', file: '' });            /* a custom image needs a real uploaded file name */
  assert.equal(d.button.url, ''); assert.equal(d.showExpiry, false); assert.ok(!('extra' in d));
  assert.deepEqual(cleanDesign(undefined).image, { mode: 'none', file: '' });
  assert.equal(cleanDesign({ image: { mode: 'custom', file: FILE } }).image.file, FILE);
});

test('message formatting works on the template words, including around a placeholder', () => {
  const out = r(null, '**Hi {{name}}**, this is *new* and __nice__. See [my site](https://studio.test/x?a=1&b=2).').html;
  assert.ok(out.includes('<strong>Hi Ann</strong>'), 'bold around a placeholder');
  assert.ok(out.includes('<em>new</em>') && out.includes('<u>nice</u>'));
  assert.ok(out.includes('href="https://studio.test/x?a=1&amp;b=2"'));
});

test('a name cannot add formatting or links of its own', () => {
  const out = r(null, 'Hi {{name}}', { name: '[click](https://evil.test) **x**', gallery: null }).html;
  assert.ok(!/href="[^"]*evil\.test/.test(out), 'no injected link');
  assert.ok(!out.includes('<strong>'));
  const out2 = r(null, 'Hi {{name}}', { name: '</p><script>1</script>', gallery: null }).html;
  assert.ok(!out2.includes('<script>'));
});

test('markup and javascript: links in the template are not honoured', () => {
  const out = r(null, 'a [x](javascript:alert(1)) <b>y</b>').html;
  assert.ok(!/href="javascript:/i.test(out) && !out.includes('<b>y</b>') && out.includes('&lt;b&gt;y&lt;/b&gt;'));
});

test('the preview line is hidden text before the email, and the title shows', () => {
  const out = r({ preheader: 'A peek {{name}}', title: 'New work' }).html;
  assert.ok(out.includes('display:none') && out.includes('A peek Ann'));
  assert.ok(out.indexOf('A peek') < out.indexOf('New work'));
  assert.ok(out.includes('New work'));
});

test('the image is the gallery cover, an uploaded file, or nothing; no gallery means no cover', () => {
  assert.ok(r({ image: { mode: 'cover' } }).html.includes('src="https://g.test/api/g/spring/cover"'));
  assert.ok(!r({ image: { mode: 'cover' } }, 'x', { name: 'A', gallery: null }).html.includes('/cover'));
  assert.ok(r({ image: { mode: 'custom', file: FILE } }).html.includes(`src="https://g.test/mail/img/${FILE}"`));
  assert.ok(!r({ image: { mode: 'none' } }).html.includes('<img src="https://g.test/api'));
});

test('the button links to the gallery, the website or a web address, and is left off when it has no target', () => {
  const href = d => /href="([^"]+)" style="display:inline-block/.exec(r(d).html)?.[1];
  assert.equal(href({ button: { text: 'View', mode: 'gallery' } }), 'https://g.test/spring');
  assert.equal(href({ button: { text: 'See', mode: 'site' } }), 'https://studio.test');
  assert.equal(href({ button: { text: 'Book', mode: 'custom', url: 'https://book.test/me' } }), 'https://book.test/me');
  assert.equal(href({ button: { text: '', mode: 'site' } }), undefined);
  assert.ok(!r({ button: { text: 'View', mode: 'gallery' } }, 'x', { name: 'A', gallery: null }).html.includes('display:inline-block'));
  assert.match(r({ button: { text: 'View', mode: 'gallery' } }).text, /View: https:\/\/g\.test\/spring/);
});

test('the expiry line appears only when asked for and the gallery has one', () => {
  assert.ok(r({ showExpiry: true }).html.includes('Available until June 1, 2027'));
  assert.ok(!r({ showExpiry: false }).html.includes('Available until'));
  assert.ok(!r({ showExpiry: true }, 'x', { name: 'A', gallery: { ...gal, expiry: '' } }).html.includes('Available until'));
});

test('the footer has the brand link, reply line, social link, address and unsubscribe', () => {
  const o = r(null);
  for (const part of ['https://studio.test', 'Questions? Reply to this email.', '@studio', '1 Main St', 'Unsubscribe']) assert.ok(o.html.includes(part), part);
  assert.ok(o.text.includes('Unsubscribe: https://g.test/unsubscribe/abc'));
});

test('text version strips formatting', () => {
  const o = r(null, '**Bold** and *it* and [site](https://studio.test)');
  assert.ok(o.text.startsWith('Bold and it and site (https://studio.test)'));
});

test('the confirmation covers the design as well as the words', () => {
  const base = { subject: 'a', body: 'b' }, list = [{ email: 'a@x.co' }];
  assert.notEqual(planHash({ ...base, design: cleanDesign({ title: 'one' }) }, list), planHash({ ...base, design: cleanDesign({ title: 'two' }) }, list));
});
