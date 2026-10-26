import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* No YAML library and no Docker here, so these are line-based checks on the things that go wrong with these files:
   names that don't match Immich's file, a bind mount that isn't a variable, a variable nothing sets, and syntax newer
   than a NAS maker's bundled Docker Compose understands. A real Docker run in CI covers the rest. */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const strip = t => t.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
const FILES = ['install/immichset.yml', 'install/immichset-only.yml', 'install/immichset.import.yml', 'install/immichset-network.yml', 'docker-compose.quickstart.yml'];

/* the services a file defines, from its two-space-indented keys under `services:` */
const services = t => { const m = (strip(t).split(/^services:\n/m)[1] || '').split(/\n(?=\S)/)[0]; return [...m.matchAll(/^  ([a-z][\w-]*):\s*$/gm)].map(x => x[1]); };
const FIX = read('install/test/fixtures/immich-compose.yml');

test('nothing uses syntax an older Docker Compose would reject', () => {
  for (const f of FILES) {
    const t = strip(read(f));
    assert.ok(!/!override|!reset/.test(t), `${f}: !override/!reset need a newer Compose`);
    assert.ok(!/\t/.test(t), `${f}: tabs`);
    assert.ok(!/required:\s*(true|false)/.test(t), `${f}: env_file/depends_on "required" need a newer Compose`);
  }
});

test('the layered file only overrides services that exist in Immich\'s own file, and adds ours', () => {
  const ours = services(read('install/immichset.yml')), theirs = services(FIX);
  assert.deepEqual(theirs.sort(), ['database', 'immich-machine-learning', 'immich-server', 'redis'].sort());
  assert.ok(ours.includes('immich-machine-learning') && theirs.includes('immich-machine-learning'));
  for (const s of ['immichset', 'cloudflared', 'try-online']) { assert.ok(ours.includes(s), s); assert.ok(!theirs.includes(s), `${s} would collide with Immich`); }
  assert.deepEqual(services(read('install/immichset.import.yml')), ['immich-server']);
  assert.ok(theirs.includes('immich-server'));
  assert.deepEqual(services(read('install/immichset-only.yml')).sort(), ['cloudflared', 'immichset', 'try-online']);
});

test('machine learning, the tunnel and try-online only start when asked for', () => {
  const t = read('install/immichset.yml');
  assert.match(t, /immich-machine-learning:\n\s+profiles: \["ml"\]/);
  assert.match(t, /cloudflared:[\s\S]*?profiles: \["tunnel"\]/);
  assert.match(t, /try-online:[\s\S]*?profiles: \["try"\]/);
  for (const f of ['install/immichset.yml', 'install/immichset-only.yml']) {
    const cf = strip(read(f)).split(/^  cloudflared:/m)[1].split(/^  [a-z]/m)[0];
    assert.ok(!/ports:/.test(cf), `${f}: the tunnel opens no port`);
  }
});

test('every folder mounted comes from a variable, and nothing is an anonymous volume', () => {
  for (const f of FILES) {
    const t = strip(read(f));
    const vols = [...t.matchAll(/^\s+volumes:\n((?:\s+- .*\n)+)/gm)].flatMap(m => m[1].trim().split('\n').map(l => l.replace(/^\s*- /, '').replace(/^["']|["']$/g, '')));
    for (const v of vols) { assert.ok(v.includes(':'), `${f}: "${v}" would be an anonymous volume`); if (/^[./~]/.test(v)) assert.fail(`${f}: "${v}" is a fixed path, not a chosen folder`); }
  }
});

test('every variable a file needs is set by the installer or has a default', () => {
  const installer = read('install/install.sh');
  const immichEnv = read('install/test/fixtures/immich-example.env.txt');
  const provided = n => installer.includes(n) || immichEnv.includes(n);
  for (const f of FILES.filter(x => x.startsWith('install/'))) {
    for (const m of strip(read(f)).matchAll(/\$\{([A-Z_]+)(:-[^}]*)?\}/g)) {
      if (m[2] !== undefined) continue;                        /* has a default */
      assert.ok(provided(m[1]), `${f}: \${${m[1]}} is set by nothing`);
    }
  }
});

test('the quickstart file offers the tunnel without enabling it', () => {
  const t = read('docker-compose.quickstart.yml');
  assert.match(t, /# +cloudflared:/); assert.ok(!/^  cloudflared:/m.test(t), 'it is a comment until someone turns it on');
  assert.ok(services(t).includes('immichset'));
});

test('the compose files in the image-less folder are all covered by the installer', () => {
  const inst = read('install/install.sh');
  for (const f of readdirSync(join(ROOT, 'install')).filter(n => n.endsWith('.yml'))) assert.ok(inst.includes(f), `${f} is never fetched by install.sh`);
});

test('the tunnel block in the quickstart file lands under services when uncommented', () => {
  const text = read('docker-compose.quickstart.yml');
  const on = text.replace(/^( *)# (cloudflared:|  \S.*)$/gm, '$1$2');
  assert.match(on, /^ {2}cloudflared:$/m, 'indented as a service');
  assert.match(on, /^ {4}image: cloudflare\/cloudflared/m);
});
