// Only in the page editor's preview (inlined by build.mjs in editor mode, never published): clicking a block, a header
// or footer element, or the header or footer itself selects it in the editor instead of following links or opening the
// photo viewer, and the editor can highlight one and keep the scroll position across redraws. The preview is an iframe
// srcdoc, whose origin is the editor's own (self.origin).
(function () {
  if (window.parent === window) return;
  const ORIGIN = self.origin;
  const post = m => parent.postMessage(m, ORIGIN);
  const KINDS = { b: 'data-b', e: 'data-e', band: 'data-band' };
  let current = null;
  function mark(id, kind, scroll) {
    if (current) current.classList.remove('wb-sel');
    const attr = KINDS[kind] || KINDS.b;
    current = id ? document.querySelector(`[${attr}="${CSS.escape(id)}"]`) : null;
    if (current) { current.classList.add('wb-sel'); if (scroll) current.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  addEventListener('click', ev => {
    ev.preventDefault(); ev.stopPropagation();
    const t = ev.target.closest('[data-b],[data-e],[data-band]');
    const band = t ? t.closest('[data-band]') : null;
    post({ type: 'wb-select', id: t ? t.dataset.b || t.dataset.e || null : null, band: band ? band.dataset.band : null });
  }, true);
  addEventListener('message', ev => {
    if (ev.origin !== ORIGIN || ev.source !== window.parent) return;
    const m = ev.data || {};
    if (m.type === 'wb-select') mark(m.id, m.kind, !!m.scroll);
    if (m.type === 'wb-scroll') scrollTo(0, Number(m.y) || 0);
  });
  let t = 0;
  addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => post({ type: 'wb-scrolled', y: scrollY }), 120); }, { passive: true });
})();
