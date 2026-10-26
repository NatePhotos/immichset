import test from 'node:test';
import assert from 'node:assert/strict';
import { open, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { crc32 } from 'node:zlib';
import { createZipWriter } from '../writer.mjs';

async function* chunks(...bs) { for (const b of bs) yield Buffer.from(b); }

/* a small independent reader: walks the central directory and checks each entry */
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'end record present');
  let n = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if (n === 0xFFFF || cdOff === 0xFFFFFFFF) {
    const loc = eocd - 20;
    assert.equal(buf.readUInt32LE(loc), 0x07064b50);
    const z = Number(buf.readBigUInt64LE(loc + 8));
    n = Number(buf.readBigUInt64LE(z + 32)); cdSize = Number(buf.readBigUInt64LE(z + 40)); cdOff = Number(buf.readBigUInt64LE(z + 48));
  }
  const out = []; let p = cdOff;
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    let size = buf.readUInt32LE(p + 24), off = buf.readUInt32LE(p + 42);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    if (size === 0xFFFFFFFF || off === 0xFFFFFFFF) {
      const x = p + 46 + nl; size = Number(buf.readBigUInt64LE(x + 12)); off = Number(buf.readBigUInt64LE(x + 20));
    }
    assert.equal(buf.readUInt32LE(off), 0x04034b50);
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + size);
    assert.equal(crc32(data) >>> 0, crc, `crc of ${name}`);
    out.push({ name, data });
    p += 46 + nl + el;
  }
  return out;
}

async function build(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'ziptest-'));
  const file = join(dir, 'a.zip');
  const fh = await open(file, 'w+');
  const w = createZipWriter(fh);
  await fn(w);
  const total = await w.finish();
  await fh.sync(); await fh.close();
  const buf = await readFile(file);
  assert.equal(buf.length, total);
  return { dir, file, buf };
}

test('stores entries with known and unknown sizes and reads back', async () => {
  const { dir, file, buf } = await build(async w => {
    await w.addEntry('one.jpg', new Date(2024, 4, 3, 10, 20, 30), 5, chunks('he', 'llo!'.slice(0, 3)));
    await w.addEntry('två ö.jpg', new Date(), undefined, chunks('abc', 'def'));
    await w.addEntry('empty.txt', new Date(), 0, chunks());
  });
  const z = readZip(buf);
  assert.deepEqual(z.map(e => e.name), ['one.jpg', 'två ö.jpg', 'empty.txt']);
  assert.equal(z[0].data.toString(), 'hello');
  assert.equal(z[1].data.toString(), 'abcdef');
  assert.equal(z[2].data.length, 0);
  const t = spawnSync('unzip', ['-t', file]);
  if (!t.error) assert.equal(t.status, 0, String(t.stdout) + String(t.stderr));
  await rm(dir, { recursive: true });
});

test('a failed entry is cut off and the archive stays valid', async () => {
  const { dir, buf } = await build(async w => {
    await w.addEntry('a', new Date(), 3, chunks('aaa'));
    await assert.rejects(w.addEntry('bad', new Date(), 10, (async function* () { yield Buffer.from('xx'); throw new Error('boom'); })()), /boom/);
    await w.addEntry('b', new Date(), 3, chunks('bbb'));
  });
  const z = readZip(buf);
  assert.deepEqual(z.map(e => e.name), ['a', 'b']);
  await rm(dir, { recursive: true });
});

test('more than 65535 entries switches to ZIP64 records', async () => {
  const { dir, file, buf } = await build(async w => {
    for (let i = 0; i < 65600; i++) await w.addEntry('f' + i, new Date(), 0, chunks());
  });
  assert.equal(readZip(buf).length, 65600);
  const t = spawnSync('unzip', ['-tq', file]);
  if (!t.error) assert.equal(t.status, 0, String(t.stdout) + String(t.stderr));
  await rm(dir, { recursive: true });
});
