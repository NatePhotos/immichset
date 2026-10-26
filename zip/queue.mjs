/* Who gets to download right now. Downloads are limited by the home uplink, so a few
   at full speed beat many crawling: extra requests wait in line, first come first
   served, and each client holds at most one slot and one place in line.

   Pure bookkeeping with an injectable clock: no sockets, no files. The server asks
   `isReady(spec)` whether a waiting download could start (its zip may still be
   building) and the queue skips tickets that cannot, so one slow build never blocks
   the people behind it. */

import { randomBytes } from 'node:crypto';

export class DownloadQueue {
  constructor({ maxActive = 3, isReady = () => true, now = Date.now,
                waitTtlMs = 180_000, reserveTtlMs = 120_000, stallMs = 120_000 } = {}) {
    this.maxActive = Math.max(1, maxActive);
    this.isReady = isReady;
    this.now = now;
    this.waitTtlMs = waitTtlMs; this.reserveTtlMs = reserveTtlMs; this.stallMs = stallMs;
    this.tickets = [];            /* FIFO: waiting or reserved */
    this.slots = new Set();       /* downloads in progress */
  }

  /* join the line, or update your place if you are already in it */
  request(key, spec) {
    const mine = this.tickets.find(t => t.key === key);
    if (mine) { mine.spec = spec; mine.seen = this.now(); this.tick(); return mine; }
    const t = { id: randomBytes(12).toString('hex'), key, spec, state: 'waiting', seen: this.now(), reservedAt: 0 };
    this.tickets.push(t);
    this.tick();
    return t;
  }

  /* what the person's page shows; asking counts as proof they are still there */
  status(id, key) {
    const t = this.tickets.find(x => x.id === id);
    if (!t || t.key !== key) return null;
    t.seen = this.now();
    this.tick();
    if (!this.tickets.includes(t)) return null;
    const waiting = this.tickets.filter(x => x.state === 'waiting');
    const idx = waiting.indexOf(t);
    return { state: t.state, position: idx < 0 ? 0 : idx + 1, ahead: Math.max(0, idx),
             active: this.slots.size, maxActive: this.maxActive, spec: t.spec };
  }

  cancel(id, key) {
    const i = this.tickets.findIndex(x => x.id === id && x.key === key);
    if (i < 0) return false;
    this.tickets.splice(i, 1);
    this.tick();
    return true;
  }

  /* turn a reservation into a running download */
  claim(id, key) {
    const i = this.tickets.findIndex(x => x.id === id && x.key === key && x.state === 'reserved');
    if (i < 0) return null;
    const [t] = this.tickets.splice(i, 1);
    return this._open(t.key, t.spec);
  }

  /* a free slot and nobody waiting: no reason to make anyone queue */
  claimDirect(key, spec) {
    this.tick();
    if (this._holds(key)) return null;
    if (this.slots.size + this._reserved() >= this.maxActive) return null;
    if (this.tickets.some(t => t.state === 'waiting' && t.key !== key)) return null;
    return this._open(key, spec);
  }

  /* picking a dropped download back up: it already waited its turn once, so it does not
     queue again, but one client still cannot run two */
  resume(key, spec) {
    if (this.slots.size && [...this.slots].some(s => s.key === key)) return null;
    return this._open(key, spec);
  }

  progress(slot) { slot.last = this.now(); }

  release(slot) {
    if (this.slots.delete(slot)) this.tick();
  }

  tick() {
    const t = this.now();
    this.tickets = this.tickets.filter(x =>
      x.state === 'reserved' ? t - x.reservedAt < this.reserveTtlMs : t - x.seen < this.waitTtlMs);
    for (const s of this.slots) if (t - s.last > this.stallMs) { this.slots.delete(s); s.expired = true; }
    for (const x of this.tickets) {
      if (this.slots.size + this._reserved() >= this.maxActive) break;
      if (x.state !== 'waiting' || this._holds(x.key)) continue;
      if (!this.isReady(x.spec)) continue;
      x.state = 'reserved'; x.reservedAt = t;
    }
  }

  snapshot() {
    return { maxActive: this.maxActive, active: this.slots.size, reserved: this._reserved(),
             waiting: this.tickets.filter(x => x.state === 'waiting').length,
             slots: [...this.slots].map(s => ({ key: s.key, spec: s.spec, since: s.since })) };
  }

  _reserved() { return this.tickets.filter(x => x.state === 'reserved').length; }
  _holds(key) { return [...this.slots].some(s => s.key === key) || this.tickets.some(x => x.key === key && x.state === 'reserved'); }
  _open(key, spec) {
    const now = this.now();
    const s = { key, spec, since: now, last: now, expired: false };
    this.slots.add(s);
    return s;
  }
}
