import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const walk = d => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? (f === 'test' ? [] : walk(p)) : [p];
});
const mds = walk(DOCS).filter(f => f.endsWith('.md'));
const links = md => [...readFileSync(md, 'utf8').matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)].map(m => m[1]);

test('every relative link and image in the docs exists', () => {
  const bad = [];
  for (const md of mds) for (const l of links(md)) {
    if (/^(https?:|mailto:|#)/.test(l)) continue;
    const target = resolve(dirname(md), l.split('#')[0]);
    if (!existsSync(target)) bad.push(`${md.replace(DOCS, 'docs')} -> ${l}`);
  }
  assert.deepEqual(bad, []);
});

test('no markdown image points at an external site', () => {
  const bad = [];
  for (const md of mds) {
    const t = readFileSync(md, 'utf8');
    for (const m of t.matchAll(/!\[[^\]]*\]\((https?:[^)]+)\)/g)) bad.push(`${md}: ${m[1]}`);
  }
  assert.deepEqual(bad, []);
});

test('every screenshot is used by a guide', () => {
  const used = new Set(mds.flatMap(md => links(md).map(l => l.split('/').pop())));
  const unused = readdirSync(join(DOCS, 'images')).filter(f => /\.jpg$/.test(f) && !used.has(f));
  assert.deepEqual(unused, []);
});

test('START-HERE links every guide', () => {
  const start = readFileSync(join(DOCS, 'START-HERE.md'), 'utf8');
  const missing = ['PHOTOS', 'ONLINE', 'EMAIL', 'BACKUPS', 'UPDATING', 'TROUBLESHOOTING', 'GLOSSARY']
    .filter(g => !start.includes(g + '.md'));
  assert.deepEqual(missing, []);
});
