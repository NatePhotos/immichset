// Block animations: entrance effects as blocks come into view, and parallax backgrounds.
// Nothing is hidden until this has run (blocks.css only hides under .anim), and nothing moves for visitors whose
// device asks for less motion. Only transform and opacity change.
(function () {
  if (!window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const entering = document.querySelectorAll('.blk.m');
  if (entering.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const c = e.target.classList;
        if (e.isIntersecting) { c.add('in'); if (c.contains('m-once')) io.unobserve(e.target); }
        else if (!c.contains('m-once')) c.remove('in');
      }
    }, { threshold: [0, 0.15], rootMargin: '0px 0px -5% 0px' });
    document.documentElement.classList.add('anim');
    entering.forEach(el => io.observe(el));
  }
  const layers = [...document.querySelectorAll('.blk.px > .blk-bg')];
  if (!layers.length) return;
  let ticking = false;
  function move() {
    ticking = false;
    const vh = innerHeight;
    for (const bg of layers) {
      const r = bg.parentNode.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      const k = (r.top + r.height / 2 - vh / 2) / vh;
      bg.style.transform = `translate3d(0, ${(k * -10).toFixed(2)}%, 0)`;
    }
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(move); } }, { passive: true });
  addEventListener('resize', move);
  move();
})();
