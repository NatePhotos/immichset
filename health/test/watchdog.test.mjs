import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatchdog } from '../watchdog.mjs';

function rig(results) {
  const clock = { t: 1_000_000 }, sent = [];
  let i = 0;
  const w = createWatchdog({
    now: () => clock.t,
    notify: async (subject, lines) => { sent.push({ subject, lines }); },
    checks: [{ id: 'immich', title: 'Immich', hint: 'Check the NAS.', run: async () => { const r = results[Math.min(i++, results.length - 1)]; if (r instanceof Error) throw r; return r; } }],
  });
  return { w, sent, clock };
}
const bad = detail => ({ ok: false, detail }), good = { ok: true, detail: 'fine' };

test('one failure is not an alert, two in a row are', async () => {
  const { w, sent } = rig([bad('down'), bad('down')]);
  await w.run(); assert.equal(sent.length, 0);
  assert.equal(w.summary().immich.ok, false);          /* still shown as failing at once */
  await w.run(); assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /needs attention/);
  assert.deepEqual(sent[0].lines, ['down', 'Check the NAS.']);
});

test('a blip that recovers never sends anything', async () => {
  const { w, sent } = rig([bad('x'), good, bad('x'), good]);
  for (let n = 0; n < 4; n++) await w.run();
  assert.equal(sent.length, 0);
});

test('stays quiet while broken, repeats after a day, says so on recovery', async () => {
  const { w, sent, clock } = rig([bad('a'), bad('a'), bad('a'), bad('a'), good]);
  await w.run(); await w.run(); assert.equal(sent.length, 1);
  clock.t += 3600_000; await w.run(); assert.equal(sent.length, 1);
  clock.t += 24 * 3600_000; await w.run(); assert.equal(sent.length, 2);
  await w.run();
  assert.equal(sent.length, 3);
  assert.match(sent[2].subject, /back to normal/);
  assert.equal(w.summary().immich.ok, true);
});

test('a check that throws counts as a failure', async () => {
  const { w, sent } = rig([new Error('connect refused')]);
  await w.run(); await w.run();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].lines[0], 'connect refused');
});

test('a mail failure does not break the run', async () => {
  const w = createWatchdog({ notify: async () => { throw new Error('mail down'); }, checks: [{ id: 'a', title: 'A', run: async () => ({ ok: false }) }] });
  await w.run(); await w.run();
  assert.equal(w.summary().a.ok, false);
});
