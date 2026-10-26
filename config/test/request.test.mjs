import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, isHttps, requestHost } from '../request.mjs';

const req = (headers = {}, ip = '10.0.0.9') => ({ headers, socket: { remoteAddress: ip } });

test('by default the first X-Forwarded-For entry is used, as it always was', () => {
  assert.equal(clientIp(req({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' })), '203.0.113.5');
  assert.equal(clientIp(req({})), '10.0.0.9');
});

test('a named header is used, and a forged X-Forwarded-For is ignored', () => {
  const r = req({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.2.3.4, 198.51.100.7' });
  assert.equal(clientIp(r, 'cf-connecting-ip'), '198.51.100.7');
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }), 'cf-connecting-ip'), '10.0.0.9', 'missing header: the socket, not a forgeable one');
  assert.equal(clientIp(req({ 'x-real-ip': '192.0.2.9' }), 'x-real-ip'), '192.0.2.9');
});

test('none never trusts a header', () => {
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '5.6.7.8' }), 'none'), '10.0.0.9');
});

test('https is whatever the proxy says, and the host is the one asked for', () => {
  assert.equal(isHttps(req({ 'x-forwarded-proto': 'https' })), true);
  assert.equal(isHttps(req({ 'x-forwarded-proto': 'https, http' })), true);
  assert.equal(isHttps(req({ 'x-forwarded-proto': 'http' })), false);
  assert.equal(isHttps(req({})), false);
  assert.equal(requestHost(req({ host: 'nas:3000' })), 'nas:3000');
  assert.equal(requestHost(req({ host: 'internal:3000', 'x-forwarded-host': 'g.example.com, x' })), 'g.example.com');
});
