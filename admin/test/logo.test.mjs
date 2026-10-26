import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { inspectPng } from '../logo.mjs';

const crc = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return b => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
const png = ({ w = 8, h = 8, colorType = 6, extra = [] } = {}) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = colorType;
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = Buffer.alloc(h * (1 + w * bpp));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

test('a PNG with an alpha channel is accepted and measured', () => {
  assert.deepEqual(inspectPng(png({ w: 300, h: 120 })), { ok: true, width: 300, height: 120 });
  assert.equal(inspectPng(png({ colorType: 4 })).ok, true, 'grey with alpha');
});

test('a palette PNG is accepted only when it marks transparency', () => {
  assert.equal(inspectPng(png({ colorType: 3, extra: [chunk('PLTE', Buffer.alloc(3)), chunk('tRNS', Buffer.from([0]))] })).ok, true);
  assert.equal(inspectPng(png({ colorType: 3, extra: [chunk('PLTE', Buffer.alloc(3))] })).ok, false);
});

test('an image with a solid background is refused with advice, not stored', () => {
  const r = inspectPng(png({ colorType: 2 }));
  assert.equal(r.ok, false); assert.match(r.error, /transparent/);
});

test('things that are not PNGs, or are absurd, are refused', () => {
  assert.equal(inspectPng(Buffer.from('GIF89a......................................')).ok, false);
  assert.equal(inspectPng(Buffer.alloc(10)).ok, false);
  assert.equal(inspectPng(png({ w: 5000, h: 5000 })).ok, false);
  assert.equal(inspectPng('text').ok, false);
});
