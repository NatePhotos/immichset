/* Runs a list of checks on a timer and emails the owner only when something stays wrong:
   a check has to fail twice in a row before it speaks (a restart or a blip is not an
   alert), it repeats at most once a day while it stays broken, and it says so once when
   it recovers. Pure bookkeeping with an injectable clock; the checks and the mail are
   passed in. */

const DAY = 86_400_000;

export function createWatchdog({ checks, notify, now = Date.now, failAfter = 2, repeatMs = DAY }) {
  const state = new Map(checks.map(c => [c.id, { title: c.title, ok: null, detail: 'Not checked yet', fails: 0, alertedAt: 0, since: null }]));

  async function run() {
    for (const c of checks) {
      const s = state.get(c.id);
      let r;
      try { r = await c.run(); } catch (e) { r = { ok: false, detail: e?.message || 'check failed' }; }
      const ok = !!r.ok;
      if (s.ok !== ok) s.since = now();
      s.ok = ok; s.detail = r.detail || (ok ? 'OK' : 'Not OK');
      if (ok) {
        if (s.alertedAt) await tell(`${s.title} is back to normal`, [s.detail]);
        s.fails = 0; s.alertedAt = 0;
        continue;
      }
      s.fails++;
      if (s.fails >= failAfter && (!s.alertedAt || now() - s.alertedAt >= repeatMs)) {
        s.alertedAt = now();
        await tell(`${s.title}: needs attention`, [s.detail, ...(c.hint ? [c.hint] : [])]);
      }
    }
  }
  async function tell(subject, lines) { try { await notify(subject, lines); } catch {} }

  const summary = () => Object.fromEntries([...state].map(([id, s]) => [id, { ok: s.ok, detail: s.detail, title: s.title, since: s.since }]));
  return { run, summary };
}
