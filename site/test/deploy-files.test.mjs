import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'test' ? [] : walk(p)) : [p]; });

test('deploy.sh copies every file the website and the admin panel run on', () => {
  const sh = readFileSync(join(ROOT, 'deploy.sh'), 'utf8');
  const m = sh.match(/^FILES=\(([\s\S]*?)\)$/m);
  assert.ok(m, 'FILES=( … ) not found');
  const listed = new Set(m[1].split(/\s+/).filter(Boolean));
  const need = [...walk(join(ROOT, 'site')), ...readdirSync(join(ROOT, 'web')).map(f => join(ROOT, 'web', f))]
    .map(p => relative(ROOT, p)).filter(p => /\.(mjs|js|css|html)$/.test(p));
  assert.deepEqual(need.filter(p => !listed.has(p)), []);
  assert.deepEqual([...listed].filter(p => !existsSync(join(ROOT, p))), [], 'listed files that do not exist');
});
