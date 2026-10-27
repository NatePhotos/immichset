import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml, safeUrl, decodeEntities } from '../sanitize.mjs';

test('URLs: only http(s), mailto and tel, however they are disguised', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl(' mailto:someone@example.com '), 'mailto:someone@example.com');
  assert.equal(safeUrl('tel:+1(555)010-0100'), 'tel:+1(555)010-0100');
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', '&#106;avascript:alert(1)', 'java\tscript:x', 'data:text/html,x',
                     '//evil.example', '/relative', 'https://exa mple.com', 'https://x"onmouseover=1', 'tel:555 0100', 'vbscript:x', ''])
    assert.equal(safeUrl(bad), '', bad);
});

test('entities decode, including numeric ones, and unknown names are left alone', () => {
  assert.equal(decodeEntities('&lt;b&gt; &amp; &#106;&#x41; &nbsp;&copy;'), '<b> & jA \u00a0&copy;');
  assert.equal(decodeEntities('a&nbsp;b'), 'a\u00a0b');
});

test('scripts, styles and frames go with their content; handlers and style attributes go', () => {
  const out = sanitizeHtml('<p onclick="x()" style="color:red">Hi<script>alert(1)</script></p><style>p{}</style><iframe src="https://x"></iframe><svg><script>1</script></svg>ok', 'custom');
  assert.equal(out, '<p>Hi</p>ok');
});

test('links keep only safe addresses, and new-tab links get rel', () => {
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>', 'rich'), '<a>x</a>');
  assert.equal(sanitizeHtml('<a href="&#106;avascript:alert(1)">x</a>', 'rich'), '<a>x</a>');
  assert.equal(sanitizeHtml('<a href="https://e.com" target="_blank" rel="opener">x</a>', 'rich'),
    '<a href="https://e.com" target="_blank" rel="noopener noreferrer">x</a>');
  assert.equal(sanitizeHtml('<a href=https://e.com/?a=1&amp;b=2>x</a>', 'rich'), '<a href="https://e.com/?a=1&amp;b=2">x</a>');
});

test('unknown tags are dropped but their text is kept; images are not allowed', () => {
  assert.equal(sanitizeHtml('<foo><b>bold</b></foo><img src="https://x/y.jpg" onerror="z">', 'custom'), '<b>bold</b>');
});

test('rich mode allows less than custom mode', () => {
  assert.equal(sanitizeHtml('<div><table><tr><td>x</td></tr></table></div>', 'rich'), 'x');
  assert.equal(sanitizeHtml('<div><table><tr><td colspan="2">x</td></tr></table></div>', 'custom'), '<div><table><tr><td colspan="2">x</td></tr></table></div>');
});

test('tags are balanced, stray closers dropped, comments removed, text escaped', () => {
  assert.equal(sanitizeHtml('<b>open <i>both', 'rich'), '<b>open <i>both</i></b>');
  assert.equal(sanitizeHtml('</p>x</b>', 'rich'), 'x');
  assert.equal(sanitizeHtml('a <!-- <script>alert(1)</script> --> b', 'rich'), 'a  b');
  assert.equal(sanitizeHtml('1 < 2 & 3 > 2', 'rich'), '1 &lt; 2 &amp; 3 &gt; 2');
  assert.equal(sanitizeHtml('<p title="a&quot;b">x</p>', 'rich'), '<p title="a&quot;b">x</p>');
  assert.equal(sanitizeHtml('<b>unfinished <i', 'rich'), '<b>unfinished </b>');
});

test('class values are limited to plain names', () => {
  assert.equal(sanitizeHtml('<p class="lead big">x</p><p class="a&quot;onclick=1">y</p>', 'custom'), '<p class="lead big">x</p><p>y</p>');
});

test('sanitising twice changes nothing', () => {
  const once = sanitizeHtml('<p>A &amp; B&nbsp;<a href="https://e.com" target="_blank">l</a><b>x', 'rich');
  assert.equal(sanitizeHtml(once, 'rich'), once);
});

test('dropped containers are closed correctly even when lower-casing changes string length', () => {
  assert.equal(sanitizeHtml('<style>İİİ</style>keep me', 'custom'), 'keep me');
  assert.equal(sanitizeHtml('<SCRIPT>x</ScRiPt>ok', 'custom'), 'ok');
});
