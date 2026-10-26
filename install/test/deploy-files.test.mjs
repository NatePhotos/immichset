import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* deploy.sh copies a fixed list of files to the owner's NAS. A module the server imports but that is missing from that
   list would break the app on the next deploy, and the smoke test could not catch it because it runs after the copy.
   So: follow every import from server.mjs and make sure each file is in the list. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const deploy = readFileSync(join(ROOT, 'deploy.sh'), 'utf8');
const list = deploy.match(/FILES=\(([\s\S]*?)\)\nPREV=/)[1].split(/\s+/).filter(Boolean);

function imports(file) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const out = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s+['"](\.[^'"]+)['"]/g)) out.push(m[1]);
  for (const m of text.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out.map(r => resolve(dirname(join(ROOT, file)), r).slice(ROOT.length + 1));
}

test('every module the server pulls in is on the deploy list', () => {
  const seen = new Set(), queue = ['server.mjs'];
  while (queue.length) {
    const f = queue.pop(); if (seen.has(f)) continue; seen.add(f);
    for (const dep of imports(f)) { assert.ok(existsSync(join(ROOT, dep)), `${f} imports ${dep}, which does not exist`); queue.push(dep); }
  }
  const missing = [...seen].filter(f => !list.includes(f));
  assert.deepEqual(missing, [], `these are imported but deploy.sh would not copy them: ${missing.join(', ')}`);
});

test('every file on the list exists', () => {
  for (const f of list) assert.ok(existsSync(join(ROOT, f)), `${f} is on the list but missing`);
});

test('the setup page is on the list too, because the server reads it from the web folder', () => {
  assert.ok(list.includes('web/setup.html'));
});
