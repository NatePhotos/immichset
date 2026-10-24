import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blake3, pagesHash } from '../blake3.mjs';

const V = JSON.parse(readFileSync(new URL('./blake3-vectors.json', import.meta.url), 'utf8'));
const input = n => Uint8Array.from({ length: n }, (_, i) => i % 251);
const hex = b => Buffer.from(b).toString('hex');

test('matches the reference implementation at every tree size', () => {
  for (const c of V.cases) assert.equal(hex(blake3(input(c.len))), c.hex, `length ${c.len}`);
});

test('hashes a string as UTF-8', () => {
  assert.equal(hex(blake3('abc')), V.abc);
});

test('pagesHash is base64 content plus extension, first 32 hex chars', () => {
  assert.equal(pagesHash(Buffer.from(V.pages.content), V.pages.path), V.pages.hash);
});
