import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALL = join(HERE, '..');
const SCRIPT = join(INSTALL, 'install.sh');
const SH = spawnSync('which', ['dash']).status === 0 ? 'dash' : 'sh';     /* the strictest shell we have: no bash-isms get through */

/* a fake `docker`: logs every call, answers the few questions the installer asks, and starts nothing */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'inst-'));
  const bin = join(root, 'bin'), src = join(root, 'immich-src'), home = join(root, 'home'), log = join(root, 'docker.log');
  mkdirSync(bin); mkdirSync(src); mkdirSync(home); writeFileSync(log, '');
  copyFileSync(join(HERE, 'fixtures', 'immich-compose.yml'), join(src, 'docker-compose.yml'));
  copyFileSync(join(HERE, 'fixtures', 'immich-example.env.txt'), join(src, 'example.env'));
  writeFileSync(join(bin, 'docker'), `#!/bin/sh
echo "$@" >> "$FAKE_DOCKER_LOG"
case "$1" in
  version) exit 0 ;;
  compose) if [ "$2" = version ]; then echo "Docker Compose version v2.29.0"; fi; exit 0 ;;
  info) echo "\${FAKE_INFO:-8589934592 4 x86_64}"; exit 0 ;;
  ps) case "$*" in *"{{.Names}}"*) printf '%s' "\${FAKE_PS:-}" ;; *"{{.Ports}}"*) printf '%s' "\${FAKE_PORTS:-}" ;; esac; exit 0 ;;
  inspect) echo "\${FAKE_NETWORK:-immich_default} "; exit 0 ;;
esac
exit 0
`); chmodSync(join(bin, 'docker'), 0o755);
  const run = (args, env = {}) => spawnSync(SH, [SCRIPT, ...args], { encoding: 'utf8', env: {
    PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_DOCKER_LOG: log, IMMICHSET_NO_WAIT: '1', IMMICHSET_PLATFORM: 'linux',
    IMMICHSET_SOURCE: `file://${INSTALL}`, IMMICHSET_SOURCE_IMMICH: `file://${src}`, ...env } });
  const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { root, home, run, calls, dir: join(root, 'inst'), photos: join(root, 'photos'), db: join(root, 'db') };
}
const bundled = s => ['--yes', '--dir', s.dir, '--photos', s.photos, '--db', s.db, '--immich', '--no-ml'];
const envOf = dir => Object.fromEntries(readFileSync(join(dir, '.env'), 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

test('the script is valid in the strictest shell, and cannot delete anything', () => {
  for (const sh of ['sh', 'dash']) { const r = spawnSync(sh, ['-n', SCRIPT]); if (r.error) continue; assert.equal(r.status, 0, `${sh} -n: ${r.stderr}`); }
  const text = readFileSync(SCRIPT, 'utf8');
  assert.ok(!/\brm\s+-[a-z]*r/i.test(text), 'no recursive delete');
  assert.ok(!/compose\s+down\s+(-v|--volumes)/.test(text) && !/--volumes/.test(text), 'never removes volumes');
  const sc = spawnSync('shellcheck', ['-s', 'sh', SCRIPT], { encoding: 'utf8' });
  if (!sc.error) assert.equal(sc.status, 0, sc.stdout);
});

test('a dry run says what it would do and changes nothing', () => {
  const s = sandbox();
  const r = s.run(['--dry-run', ...bundled(s)]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Dry run: nothing was downloaded or written/);
  assert.ok(r.stdout.includes(s.photos) && r.stdout.includes(s.db));
  assert.ok(!existsSync(s.dir) && !existsSync(s.photos), 'no folders were made');
  assert.ok(!s.calls().some(c => /^compose (pull|up)/.test(c)), 'nothing was pulled or started');
});

test('a fresh install writes the files, private where it matters, and starts in the right order', () => {
  const s = sandbox();
  const r = s.run(bundled(s));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const f of ['docker-compose.yml', 'immichset.yml', '.env', 'tunnel.env', '.install-state', 'INSTALL-NOTES.txt']) assert.ok(existsSync(join(s.dir, f)), f);
  assert.equal(statSync(join(s.dir, '.env')).mode & 0o777, 0o600); assert.equal(statSync(join(s.dir, 'tunnel.env')).mode & 0o777, 0o600);
  for (const d of [s.photos, s.db, join(s.dir, 'immichset-data'), join(s.dir, 'immichset-backups')]) assert.ok(existsSync(d), d);
  assert.equal(readFileSync(join(s.dir, 'docker-compose.yml'), 'utf8'), readFileSync(join(HERE, 'fixtures', 'immich-compose.yml'), 'utf8'), "Immich's own file is stored untouched");
  const e = envOf(s.dir);
  assert.equal(e.UPLOAD_LOCATION, s.photos); assert.equal(e.DB_DATA_LOCATION, s.db);
  assert.match(e.DB_PASSWORD, /^[A-Za-z0-9]{32}$/); assert.notEqual(e.DB_PASSWORD, 'postgres');
  assert.equal(e.COMPOSE_FILE, 'docker-compose.yml:immichset.yml'); assert.equal(e.COMPOSE_PROFILES, ''); assert.equal(e.IMMICHSET_ML, 'off');
  assert.equal(e.COMPOSE_PROJECT_NAME, 'immichset'); assert.equal(e.IMMICHSET_PORT, '3000'); assert.match(e.IMMICHSET_UID, /^\d+$/);
  const c = s.calls().filter(x => x.startsWith('compose')).slice(-3);
  assert.deepEqual(c, ['compose config -q', 'compose pull', 'compose up -d']);
  assert.match(r.stdout, /http:\/\/[^\s]+:3000\/setup/); assert.match(r.stdout, /Do the setup page FIRST/);
});

test('running it again keeps the database password and your edits, and never doubles its block', () => {
  const s = sandbox();
  s.run(bundled(s));
  const first = envOf(s.dir).DB_PASSWORD;
  writeFileSync(join(s.dir, '.env'), readFileSync(join(s.dir, '.env'), 'utf8') + 'MY_OWN_SETTING=keep-me\n');
  const r = s.run(bundled(s));
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(join(s.dir, '.env'), 'utf8');
  assert.equal(envOf(s.dir).DB_PASSWORD, first, 'a new password would cut Immich off from its own database');
  assert.equal((text.match(/>>> immichset/g) || []).length, 1);
  assert.ok(text.includes('MY_OWN_SETTING=keep-me'));
});

test('machine learning follows the choice', () => {
  const s = sandbox();
  s.run(['--yes', '--dir', s.dir, '--photos', s.photos, '--db', s.db, '--immich', '--ml']);
  assert.equal(envOf(s.dir).COMPOSE_PROFILES, 'ml'); assert.equal(envOf(s.dir).IMMICHSET_ML, 'on');
});

test('an Immich that is already here is joined, not reinstalled', () => {
  const s = sandbox();
  const r = s.run(['--yes', '--dir', s.dir], { FAKE_PS: 'immich_server ghcr.io/immich-app/immich-server:release\n', FAKE_NETWORK: 'photos_default' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /already running/);
  const compose = readFileSync(join(s.dir, 'docker-compose.yml'), 'utf8');
  assert.ok(compose.includes('immichset:') && !compose.includes('immich-server:') && !compose.includes('postgres'), 'only immichset');
  const e = envOf(s.dir);
  assert.equal(e.IMMICH_NETWORK, 'photos_default'); assert.equal(e.COMPOSE_FILE, 'docker-compose.yml:immichset-network.yml');
  assert.equal(e.IMMICHSET_IMMICH_HINT, 'http://immich-server:2283'); assert.equal(e.UPLOAD_LOCATION, undefined);
  assert.ok(existsSync(join(s.dir, 'immichset-network.yml')));
});

test('with Immich somewhere else entirely, immichset stands alone with no network trick', () => {
  const s = sandbox();
  s.run(['--yes', '--dir', s.dir, '--no-immich']);
  assert.equal(envOf(s.dir).COMPOSE_FILE, undefined);
  assert.ok(!existsSync(join(s.dir, 'immichset-network.yml')));
});

test('a busy port moves to the next free one', () => {
  const s = sandbox();
  s.run([...bundled(s)], { FAKE_PORTS: '0.0.0.0:3000->3000/tcp, :::3000->3000/tcp\n0.0.0.0:3001->80/tcp\n' });
  assert.equal(envOf(s.dir).IMMICHSET_PORT, '3002');
});

test('a database on a network share is refused before anything is written', () => {
  const s = sandbox();
  const mounts = join(s.root, 'mounts'); writeFileSync(mounts, `rootfs / ext4 rw 0 0\nnas:/export ${s.root}/nas nfs rw 0 0\n`);
  const r = s.run(['--yes', '--dir', s.dir, '--photos', s.photos, '--db', join(s.root, 'nas', 'db'), '--immich'], { IMMICHSET_MOUNTS: mounts });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /network share/);
  assert.ok(!existsSync(join(s.dir, '.env')) && !existsSync(s.photos));
  const fine = s.run(['--yes', '--dir', s.dir, '--photos', s.photos, '--db', s.db, '--immich', '--no-ml'], { IMMICHSET_MOUNTS: mounts });
  assert.equal(fine.status, 0, fine.stderr);
});

test('under WSL a Windows drive is refused for the database', () => {
  const s = sandbox();
  const r = s.run(['--yes', '--dir', s.dir, '--photos', s.photos, '--db', '/mnt/c/immich/db', '--immich'], { IMMICHSET_PLATFORM: 'wsl' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /Windows drive/);
});

test('a computer that is too small is told so, and can still run immichset alone', () => {
  const s = sandbox();
  const r = s.run(['--yes', '--dir', s.dir, '--photos', s.photos, '--db', s.db, '--immich'], { FAKE_INFO: '2147483648 2 x86_64' });
  assert.notEqual(r.status, 0); assert.match(r.stderr + r.stdout, /too small|small for Immich/i);
  const alone = s.run(['--yes', '--dir', s.dir, '--no-immich'], { FAKE_INFO: '2147483648 2 x86_64' });
  assert.equal(alone.status, 0, alone.stderr);
});

test('without Docker it explains what to do', () => {
  const s = sandbox();
  const r = s.run(['--yes', '--dir', s.dir], { PATH: '/usr/bin:/bin' });   /* no fake docker on this PATH */
  if (spawnSync('which', ['docker'], { env: { PATH: '/usr/bin:/bin' } }).status === 0) return;   /* a real one is installed here */
  assert.notEqual(r.status, 0); assert.match(r.stderr, /Docker isn't installed/);
});

test('uninstall stops the containers and leaves every folder, and says so', () => {
  const s = sandbox();
  s.run(bundled(s));
  const r = s.run(['uninstall', '--dir', s.dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(s.calls().includes('compose down'));
  assert.ok(!s.calls().some(c => /-v|--volumes/.test(c)));
  for (const d of [s.photos, s.db]) { assert.ok(existsSync(d), d); assert.ok(r.stdout.includes(d)); }
  assert.match(r.stdout, /untouched/);
});

test('update pulls and restarts', () => {
  const s = sandbox(); s.run(bundled(s));
  assert.equal(s.run(['update', '--dir', s.dir]).status, 0);
  const c = s.calls(); assert.ok(c.lastIndexOf('compose pull') > c.lastIndexOf('compose config -q'));
});

test('the tunnel token is stored privately and the profile is switched on once', () => {
  const s = sandbox(); s.run(bundled(s));
  assert.equal(s.run(['tunnel', '--yes', '--dir', s.dir], { TUNNEL_TOKEN: 'eyJTEST-TOKEN' }).status, 0);
  assert.equal(readFileSync(join(s.dir, 'tunnel.env'), 'utf8').trim(), 'TUNNEL_TOKEN=eyJTEST-TOKEN');
  assert.equal(statSync(join(s.dir, 'tunnel.env')).mode & 0o777, 0o600);
  s.run(['tunnel', '--yes', '--dir', s.dir], { TUNNEL_TOKEN: 'eyJTEST-TOKEN' });
  assert.equal(envOf(s.dir).COMPOSE_PROFILES, 'tunnel');
  assert.ok(!readFileSync(join(s.dir, '.env'), 'utf8').includes('eyJTEST'), 'the token never lands in .env');
});

test('commands outside an install folder say so', () => {
  const s = sandbox();
  const r = s.run(['status', '--dir', s.dir]);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /isn't an immichset install folder/);
});
