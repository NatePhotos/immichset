import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublisher } from '../publish.mjs';

function fakeCloudflare({ missing = null, failOn = null } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    const path = url.replace('https://api.cloudflare.com/client/v4', '');
    const body = init.body instanceof FormData ? init.body : init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || 'GET', auth: init.headers?.authorization, body });
    const ok = result => new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200 });
    if (failOn && path.includes(failOn)) return new Response(JSON.stringify({ success: false, errors: [{ message: 'nope' }] }), { status: 400 });
    if (path.endsWith('/upload-token')) return ok({ jwt: 'JWT' });
    if (path === '/pages/assets/check-missing') return ok(missing ?? body.hashes);
    if (path === '/pages/assets/upload') return ok({ successful_key_count: body.length });
    if (path === '/pages/assets/upsert-hashes') return ok(true);
    if (path.endsWith('/deployments')) return ok({ id: 'dep-1', url: 'https://x.pages.dev' });
    if (path.endsWith('/rollback')) return ok({ id: 'dep-0' });
    return new Response('{}', { status: 404 });
  };
  return { f, calls };
}
const files = () => new Map([
  ['index.html', Buffer.from('<h1>home</h1>')],
  ['img/a-grid.jpg', Buffer.from([0xff, 0xd8, 0xff, 1])],
  ['_headers', Buffer.from('/img/*\n  Cache-Control: x\n')],
]);

test('not ready without account, token and project', () => {
  assert.equal(createPublisher({ accountId: 'a', token: '', project: 'p' }).ready, false);
  assert.equal(createPublisher({ accountId: 'a', token: 't', project: 'p' }).ready, true);
});

test('uploads only what Cloudflare is missing, then deploys with a manifest', async () => {
  const cf = fakeCloudflare({ missing: [] });
  const hashOf = (buf, path) => `h-${path}`;
  const pub = createPublisher({ accountId: 'acc', token: 'TOK', project: 'site', fetch: cf.f });
  const out = await pub.deploy(files(), hashOf);
  assert.deepEqual(out, { id: 'dep-1', url: 'https://x.pages.dev' });
  const paths = cf.calls.map(c => c.path);
  assert.deepEqual(paths, ['/accounts/acc/pages/projects/site/upload-token', '/pages/assets/check-missing',
                           '/pages/assets/upsert-hashes', '/accounts/acc/pages/projects/site/deployments']);
  assert.equal(cf.calls[0].auth, 'Bearer TOK');
  assert.equal(cf.calls[1].auth, 'Bearer JWT');
  assert.deepEqual(cf.calls[1].body.hashes, ['h-index.html', 'h-img/a-grid.jpg']);
  const form = cf.calls[3].body;
  assert.deepEqual(JSON.parse(form.get('manifest')), { '/index.html': 'h-index.html', '/img/a-grid.jpg': 'h-img/a-grid.jpg' });
  assert.equal(form.get('branch'), 'main');
  assert.equal(await form.get('_headers').text(), '/img/*\n  Cache-Control: x\n');
});

test('missing files are uploaded as base64 with their type', async () => {
  const cf = fakeCloudflare();
  const pub = createPublisher({ accountId: 'acc', token: 'TOK', project: 'site', fetch: cf.f });
  await pub.deploy(files(), (b, p) => `h-${p}`);
  const up = cf.calls.find(c => c.path === '/pages/assets/upload');
  assert.deepEqual(up.body.map(x => [x.key, x.metadata.contentType, x.base64]),
    [['h-index.html', 'text/html; charset=utf-8', true], ['h-img/a-grid.jpg', 'image/jpeg', true]]);
  assert.equal(Buffer.from(up.body[0].value, 'base64').toString(), '<h1>home</h1>');
});

test('a Cloudflare error is raised with its message, before any deployment', async () => {
  const cf = fakeCloudflare({ failOn: 'check-missing' });
  const pub = createPublisher({ accountId: 'acc', token: 'TOK', project: 'site', fetch: cf.f });
  await assert.rejects(pub.deploy(files(), (b, p) => p), /Cloudflare: nope/);
  assert.ok(!cf.calls.some(c => c.path.endsWith('/deployments')));
});

test('rollback calls the deployment rollback endpoint', async () => {
  const cf = fakeCloudflare();
  const pub = createPublisher({ accountId: 'acc', token: 'TOK', project: 'site', fetch: cf.f });
  await pub.rollback('dep-0');
  assert.deepEqual(cf.calls.map(c => [c.method, c.path]), [['POST', '/accounts/acc/pages/projects/site/deployments/dep-0/rollback']]);
});
