// Masonry layout: each photo goes into the shortest column, in order.
(function () {
  const grid = document.querySelector('.masonry');
  if (!grid) return;
  const items = [...grid.querySelectorAll('.m-item')];
  const desk = Number(grid.dataset.cols) || 4;
  const phone = Number(grid.dataset.colsPhone) || 2;
  let cols = 0;

  function layout() {
    const want = innerWidth < 760 ? phone : innerWidth < 1000 ? Math.min(3, desk) : desk;
    if (want === cols) return;
    cols = want;
    const columns = Array.from({ length: cols }, () => {
      const c = document.createElement('div');
      c.className = 'm-col';
      return c;
    });
    const heights = new Array(cols).fill(0);
    for (const it of items) {
      const img = it.querySelector('img');
      const i = heights.indexOf(Math.min(...heights));
      columns[i].appendChild(it);
      heights[i] += img.height / img.width + 0.02;
    }
    grid.replaceChildren(...columns);
    grid.classList.add('ready');
  }
  layout();
  addEventListener('resize', layout);

  // Full-screen viewer
  const lb = document.createElement('div');
  lb.className = 'lb';
  lb.innerHTML = '<span class="lb-count"></span><img alt=""><button class="lb-close" aria-label="Close">×</button>' +
    '<button class="lb-prev" aria-label="Previous">‹</button><button class="lb-next" aria-label="Next">›</button>';
  document.body.appendChild(lb);
  const big = lb.querySelector('img');
  const count = lb.querySelector('.lb-count');
  let at = -1;

  function show(i) {
    at = (i + items.length) % items.length;
    big.src = items[at].href;
    big.alt = items[at].querySelector('img').alt;
    count.textContent = `${at + 1} / ${items.length}`;
    for (const n of [at + 1, at - 1]) new Image().src = items[(n + items.length) % items.length].href;
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    at = -1;
  }
  items.forEach((it, i) => it.addEventListener('click', ev => { ev.preventDefault(); show(i); }));
  lb.querySelector('.lb-close').onclick = close;
  lb.querySelector('.lb-prev').onclick = () => show(at - 1);
  lb.querySelector('.lb-next').onclick = () => show(at + 1);
  lb.addEventListener('click', ev => { if (ev.target === lb) close(); });
  addEventListener('keydown', ev => {
    if (at < 0) return;
    if (ev.key === 'Escape') close();
    if (ev.key === 'ArrowRight') show(at + 1);
    if (ev.key === 'ArrowLeft') show(at - 1);
  });
  let x0 = null;
  lb.addEventListener('touchstart', ev => { x0 = ev.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', ev => {
    if (x0 === null) return;
    const dx = ev.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1));
    x0 = null;
  });
})();

document.querySelector('.totop')?.addEventListener('click', ev => {
  ev.preventDefault();
  scrollTo({ top: 0, behavior: 'smooth' });
});
