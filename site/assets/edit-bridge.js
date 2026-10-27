// Only in the page editor's preview (inlined by build.mjs in editor mode, never published): clicking a block selects it
// in the editor instead of following links or opening the photo viewer, and the editor can highlight a block and keep
// the scroll position across redraws. The preview is an iframe srcdoc, whose origin is the editor's own (self.origin).
(function () {
  if (window.parent === window) return;
  const ORIGIN = self.origin;
  const post = m => parent.postMessage(m, ORIGIN);
  let current = null;
  function mark(id, scroll) {
    if (current) current.classList.remove('wb-sel');
    current = id ? document.querySelector(`[data-b="${CSS.escape(id)}"]`) : null;
    if (current) { current.classList.add('wb-sel'); if (scroll) current.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  addEventListener('click', ev => {
    ev.preventDefault(); ev.stopPropagation();
    const b = ev.target.closest('[data-b]');
    post({ type: 'wb-select', id: b ? b.dataset.b : null });
  }, true);
  addEventListener('message', ev => {
    if (ev.origin !== ORIGIN || ev.source !== window.parent) return;
    const m = ev.data || {};
    if (m.type === 'wb-select') mark(m.id, !!m.scroll);
    if (m.type === 'wb-scroll') scrollTo(0, Number(m.y) || 0);
  });
  let t = 0;
  addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => post({ type: 'wb-scrolled', y: scrollY }), 120); }, { passive: true });
})();
