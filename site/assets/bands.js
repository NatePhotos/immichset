// Header and footer: their elements' entrance effects, as motion.js does for blocks. They play once, as the page
// opens. Nothing is hidden until this has run (bands.css only hides under .anim), and nothing moves for visitors whose
// device asks for less motion.
(function () {
  if (!window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const entering = document.querySelectorAll('.el.m');
  if (!entering.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: [0, 0.15] });
  document.documentElement.classList.add('anim');
  entering.forEach(el => io.observe(el));
})();
