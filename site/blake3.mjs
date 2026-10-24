/* BLAKE3, the hash Cloudflare Pages uses to name uploaded files. Plain JavaScript so the
   app keeps zero dependencies. Only the default 32-byte hash is needed. */
import { extname } from 'node:path';

const IV = Uint32Array.of(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                          0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19);
const PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const CHUNK_START = 1, CHUNK_END = 2, PARENT = 4, ROOT = 8;
const BLOCK = 64, CHUNK = 1024;

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

function g(s, a, b, c, d, x, y) {
  s[a] = s[a] + s[b] + x; s[d] = rotr(s[d] ^ s[a], 16);
  s[c] = s[c] + s[d];     s[b] = rotr(s[b] ^ s[c], 12);
  s[a] = s[a] + s[b] + y; s[d] = rotr(s[d] ^ s[a], 8);
  s[c] = s[c] + s[d];     s[b] = rotr(s[b] ^ s[c], 7);
}

function compress(cv, block, counter, len, flags) {
  const s = new Uint32Array(16);
  s.set(cv, 0);
  s.set(IV.subarray(0, 4), 8);
  s[12] = counter % 0x100000000;
  s[13] = Math.floor(counter / 0x100000000);
  s[14] = len;
  s[15] = flags;
  let m = Uint32Array.from(block);
  for (let r = 0; r < 7; r++) {
    g(s, 0, 4, 8, 12, m[0], m[1]);   g(s, 1, 5, 9, 13, m[2], m[3]);
    g(s, 2, 6, 10, 14, m[4], m[5]);  g(s, 3, 7, 11, 15, m[6], m[7]);
    g(s, 0, 5, 10, 15, m[8], m[9]);  g(s, 1, 6, 11, 12, m[10], m[11]);
    g(s, 2, 7, 8, 13, m[12], m[13]); g(s, 3, 4, 9, 14, m[14], m[15]);
    if (r < 6) { const prev = m; m = Uint32Array.from(PERM, i => prev[i]); }
  }
  for (let i = 0; i < 8; i++) { s[i] ^= s[i + 8]; s[i + 8] ^= cv[i]; }
  return s;
}

function words(bytes) {
  const w = new Uint32Array(16);
  for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << ((i & 3) * 8);
  return w;
}

/* everything but the last block is compressed; the last block waits to learn its flags */
function chunkOutput(chunk, counter) {
  let cv = IV.slice();
  const blocks = Math.max(1, Math.ceil(chunk.length / BLOCK));
  for (let b = 0; b < blocks - 1; b++) {
    const flags = b === 0 ? CHUNK_START : 0;
    cv = compress(cv, words(chunk.subarray(b * BLOCK, b * BLOCK + BLOCK)), counter, BLOCK, flags).slice(0, 8);
  }
  const last = chunk.subarray((blocks - 1) * BLOCK);
  return { cv, block: words(last), counter, len: last.length,
           flags: (blocks === 1 ? CHUNK_START : 0) | CHUNK_END };
}
const chainingValue = o => compress(o.cv, o.block, o.counter, o.len, o.flags).slice(0, 8);
function parentOutput(left, right) {
  const block = new Uint32Array(16);
  block.set(left, 0); block.set(right, 8);
  return { cv: IV, block, counter: 0, len: BLOCK, flags: PARENT };
}

export function blake3(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const chunks = Math.max(1, Math.ceil(data.length / CHUNK));
  const stack = [];
  let out = null;
  for (let c = 0; c < chunks; c++) {
    out = chunkOutput(data.subarray(c * CHUNK, Math.min(data.length, (c + 1) * CHUNK)), c);
    if (c === chunks - 1) break;
    /* merge finished subtrees: one merge per trailing zero bit of the chunk count */
    let cv = chainingValue(out);
    for (let total = c + 1; (total & 1) === 0; total = Math.floor(total / 2)) {
      cv = chainingValue(parentOutput(stack.pop(), cv));
    }
    stack.push(cv);
  }
  while (stack.length) out = parentOutput(stack.pop(), chainingValue(out));
  const root = compress(out.cv, out.block, 0, out.len, out.flags | ROOT);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    bytes[i * 4] = root[i]; bytes[i * 4 + 1] = root[i] >>> 8;
    bytes[i * 4 + 2] = root[i] >>> 16; bytes[i * 4 + 3] = root[i] >>> 24;
  }
  return bytes;
}

/* The key Wrangler gives a file: the hash of its base64 text followed by its extension. */
export function pagesHash(content, path) {
  const ext = extname(path).slice(1);
  return Buffer.from(blake3(Buffer.from(content.toString('base64') + ext))).toString('hex').slice(0, 32);
}
