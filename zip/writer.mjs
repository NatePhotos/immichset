/* A store-only ZIP writer that streams to a file handle, with no dependencies.
   Photos are already compressed, so storing them costs nothing and keeps the build
   to disk speed. Sizes and checksums are written back into each entry's header once
   its data is on disk (no data descriptors, which some unzip tools mishandle), and an
   entry that fails halfway is cut back off the file so it can be tried again. */

import { crc32 } from 'node:zlib';

const U32 = 0xFFFFFFFF;
const MAX_ENTRIES = 0xFFFF;

function dosTime(d) {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function createZipWriter(fh) {
  const entries = [];
  let pos = 0;

  async function put(buf, at) {
    let done = 0;
    while (done < buf.length) {
      const { bytesWritten } = await fh.write(buf, done, buf.length - done, at + done);
      done += bytesWritten;
    }
  }

  /* `sizeHint` is the file's length if the source told us. Under 4 GB we write a plain
     header; unknown or larger gets the ZIP64 extra up front so the real size always fits. */
  async function addEntry(name, mtime, sizeHint, source) {
    const nameBuf = Buffer.from(name, 'utf8');
    const start = pos;
    const z64 = !(Number.isFinite(sizeHint) && sizeHint >= 0 && sizeHint < U32);
    const { time, date } = dosTime(mtime instanceof Date && !isNaN(mtime) ? mtime : new Date());

    const head = Buffer.alloc(30 + nameBuf.length + (z64 ? 20 : 0));
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(z64 ? 45 : 20, 4);
    head.writeUInt16LE(0x0800, 6);              /* names are UTF-8 */
    head.writeUInt16LE(0, 8);                   /* stored */
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    if (z64) { head.writeUInt32LE(U32, 18); head.writeUInt32LE(U32, 22); }
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(z64 ? 20 : 0, 28);
    nameBuf.copy(head, 30);
    if (z64) {
      const x = 30 + nameBuf.length;
      head.writeUInt16LE(0x0001, x);
      head.writeUInt16LE(16, x + 2);
    }

    try {
      await put(head, start);
      let at = start + head.length, crc = 0, size = 0;
      for await (const chunk of source) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        crc = crc32(b, crc);
        await put(b, at);
        at += b.length; size += b.length;
      }
      if (!z64 && size >= U32) throw new Error('entry outgrew its declared size');

      const fix = Buffer.alloc(z64 ? 16 : 12);
      if (z64) {
        fix.writeBigUInt64LE(BigInt(size), 0);
        fix.writeBigUInt64LE(BigInt(size), 8);
        await put(fix, start + 30 + nameBuf.length + 4);
        const c = Buffer.alloc(4); c.writeUInt32LE(crc >>> 0);
        await put(c, start + 14);
      } else {
        fix.writeUInt32LE(crc >>> 0, 0);
        fix.writeUInt32LE(size, 4);
        fix.writeUInt32LE(size, 8);
        await put(fix, start + 14);
      }
      entries.push({ nameBuf, time, date, crc: crc >>> 0, size, offset: start, z64 });
      pos = at;
      return { size, offset: start };
    } catch (e) {
      pos = start;
      try { await fh.truncate(start); } catch {}
      throw e;
    }
  }

  async function finish() {
    const cdStart = pos;
    const parts = [];
    for (const e of entries) {
      const big = e.size >= U32 || e.offset >= U32;
      const extra = big ? Buffer.alloc(28) : Buffer.alloc(0);
      if (big) {
        extra.writeUInt16LE(0x0001, 0); extra.writeUInt16LE(24, 2);
        extra.writeBigUInt64LE(BigInt(e.size), 4);
        extra.writeBigUInt64LE(BigInt(e.size), 12);
        extra.writeBigUInt64LE(BigInt(e.offset), 20);
      }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(big || e.z64 ? 45 : 20, 4);   /* made by */
      h.writeUInt16LE(big || e.z64 ? 45 : 20, 6);   /* needed */
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(0, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(big ? U32 : e.size, 20);
      h.writeUInt32LE(big ? U32 : e.size, 24);
      h.writeUInt16LE(e.nameBuf.length, 28);
      h.writeUInt16LE(extra.length, 30);
      h.writeUInt32LE(big ? U32 : e.offset, 42);
      parts.push(h, e.nameBuf, extra);
    }
    const cd = Buffer.concat(parts);
    await put(cd, cdStart);
    let at = cdStart + cd.length;

    const needZ64 = entries.length > MAX_ENTRIES || cdStart >= U32 || cd.length >= U32;
    if (needZ64) {
      const rec = Buffer.alloc(56 + 20);
      rec.writeUInt32LE(0x06064b50, 0);
      rec.writeBigUInt64LE(44n, 4);
      rec.writeUInt16LE(45, 12); rec.writeUInt16LE(45, 14);
      rec.writeBigUInt64LE(BigInt(entries.length), 24);
      rec.writeBigUInt64LE(BigInt(entries.length), 32);
      rec.writeBigUInt64LE(BigInt(cd.length), 40);
      rec.writeBigUInt64LE(BigInt(cdStart), 48);
      rec.writeUInt32LE(0x07064b50, 56);
      rec.writeBigUInt64LE(BigInt(at), 64);
      rec.writeUInt32LE(1, 72);
      await put(rec, at);
      at += rec.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(needZ64 ? 0xFFFF : entries.length, 8);
    end.writeUInt16LE(needZ64 ? 0xFFFF : entries.length, 10);
    end.writeUInt32LE(needZ64 ? U32 : cd.length, 12);
    end.writeUInt32LE(needZ64 ? U32 : cdStart, 16);
    await put(end, at);
    pos = at + end.length;
    return pos;
  }

  return { addEntry, finish, get bytes() { return pos; }, get count() { return entries.length; } };
}
