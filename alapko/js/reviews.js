// reviews.js · Content agent
// SAMPLE CONTENT: premade demo reviews, not real customers.
export const REVIEWS = [
  {
    id: 'r1', name: 'Kovács Péter', town: 'Érd', project: 'Családi ház falazása', category: 'falazas', rating: 5,
    text: 'Pontosan azt kaptuk, amit az első bejáráson megbeszéltünk. Minden héten fotókkal jelezték, hol tart a munka, és a statikus ellenőrzésén egyetlen megjegyzés sem volt. Ritka, hogy egy építkezésen nem kell semmin idegeskedni.',
    date: '2025-06',
  },
  {
    id: 'r2', name: 'Nagy Eszter', town: 'Szentendre', project: 'Terasz burkolása', category: 'burkolas', rating: 5,
    text: 'A régi teraszunk alatt évek óta beázott a pince. Megtalálták az okát, újraépítették a lejtést, és az első tél óta egy csepp víz sincs. A lépcső élvédője olyan szép, hogy a vendégek is megdicsérik.',
    date: '2024-04',
  },
  {
    id: 'r3', name: 'Horváth Zsófia', town: 'Dunakeszi', project: 'Sávalap új házhoz', category: 'alapozas', rating: 5,
    text: 'Elsőházasok vagyunk, fogalmunk sem volt az alapozásról. Türelmesen elmagyaráztak mindent a talajvizsgálattól a betonozásig, és a végén kaptunk egy mappát a fotókkal és a jegyzőkönyvekkel.',
    date: '2025-03',
  },
  {
    id: 'r4', name: 'Szabó Dóra', town: 'Budapest XI.', project: 'Üzlethelyiség padlója', category: 'burkolas', rating: 5,
    text: 'Éjszaka és hétvégén dolgoztak, hogy a kávézónk egy napot se zárjon be. Reggelente úgy hagyták ott a helyet, mintha ott sem lettek volna. A 120-as lapok tükörsimák.',
    date: '2024-09',
  },
  {
    id: 'r5', name: 'Tóth Márton', town: 'Budakeszi', project: 'Lemezalap lejtős telken', category: 'alapozas', rating: 5,
    text: 'Két másik cég is visszalépett a telkünk miatt. Az Alapkő elsőre azt mondta: megoldható, és leírta, hogyan. Az ütemtervet napra pontosan tartották, pedig közben két hétig esett.',
    date: '2024-11',
  },
  {
    id: 'r6', name: 'Varga Ildikó', town: 'Budaörs', project: 'Fürdőszoba-felújítás', category: 'burkolas', rating: 5,
    text: 'Kicsi fürdőből lett egy tágas, világos tér, zuhanytálca nélkül. A csapat minden nap pontosan érkezett, és amit megígértek, azt meg is csinálták. Már a konyhát is velük tervezzük.',
    date: '2024-02',
  },
];

const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const AUTOPLAY_MS = 7000;
const STAR = '<svg class="review-star" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z"/></svg>';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (ym) => { const [y, m] = ym.split('-').map(Number); return `${y}. ${MONTHS[m - 1]}`; };

let inited = false;

export function initReviews(section) {
  if (!section || inited) return;
  const slider = section.querySelector('[data-reviews]');
  const viewport = section.querySelector('.review-viewport');
  const track = section.querySelector('.review-track');
  const controls = section.querySelector('.review-controls');
  const dotsEl = section.querySelector('.review-dots');
  const prevBtn = section.querySelector('[data-review-prev]');
  const nextBtn = section.querySelector('[data-review-next]');
  const playBtn = section.querySelector('[data-review-play]');
  const live = section.querySelector('.review-live');
  if (!slider || !viewport || !track) return;
  inited = true;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const n = REVIEWS.length;

  track.innerHTML = REVIEWS.map((r, i) => `
    <article class="review-card" data-index="${i}" role="group" aria-roledescription="vélemény" aria-label="${i + 1} / ${n}">
      <p class="review-stars" role="img" aria-label="5 csillagból ${r.rating}">${STAR.repeat(r.rating)}</p>
      <blockquote class="review-text"><p>${esc(r.text)}</p></blockquote>
      <footer class="review-by">
        <p class="review-name">${esc(r.name)}</p>
        <p class="review-meta"><span>${esc(r.town)}</span><span>${esc(r.project)}</span><span>${fmtDate(r.date)}</span></p>
      </footer>
    </article>`).join('');
  dotsEl.innerHTML = REVIEWS.map((r, i) =>
    `<button class="review-dot" type="button" data-review-dot="${i}" aria-label="${i + 1}. vélemény: ${esc(r.name)}"><span class="review-dot-bar"><span class="review-dot-fill"></span></span></button>`).join('');
  controls.hidden = false;
  viewport.tabIndex = 0;
  viewport.setAttribute('aria-describedby', 'reviews-hint');
  const hint = document.createElement('p');
  hint.id = 'reviews-hint'; hint.className = 'sr-only';
  hint.textContent = 'A balra és jobbra nyíllal lapozhat a vélemények között.';
  slider.appendChild(hint);

  const cards = Array.from(track.children);
  const dots = Array.from(dotsEl.children);
  let index = 0;

  /* ---------- state ---------- */
  function render(announce) {
    track.style.transform = `translate3d(${-index * 100}%,0,0)`;
    cards.forEach((c, i) => {
      const on = i === index;
      c.classList.toggle('is-active', on);
      c.inert = !on;
      if (on) c.removeAttribute('aria-hidden'); else c.setAttribute('aria-hidden', 'true');
    });
    dots.forEach((d, i) => {
      if (i === index) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
    });
    restartProgress();
    if (announce) {
      const r = REVIEWS[index];
      live.textContent = `${index + 1}. vélemény, összesen ${n}: ${r.name}, ${r.town}`;
    }
  }

  function goTo(i, { user = false } = {}) {
    const next = ((i % n) + n) % n;
    if (next === index) { render(false); return; }
    index = next;
    render(user);
    if (!reduce.matches) {
      cards[index].querySelectorAll('.review-star').forEach((s, k) => s.animate(
        [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 420, delay: 140 + k * 45, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'backwards' }));
    }
    section.dispatchEvent(new CustomEvent('reviews:change', { detail: { index } }));
  }

  prevBtn.addEventListener('click', () => goTo(index - 1, { user: true }));
  nextBtn.addEventListener('click', () => goTo(index + 1, { user: true }));
  dotsEl.addEventListener('click', (e) => {
    const d = e.target.closest('[data-review-dot]');
    if (d) goTo(+d.dataset.reviewDot, { user: true });
  });
  slider.addEventListener('keydown', (e) => {
    if (e.target.closest('.review-dots') && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault(); goTo(e.key === 'Home' ? 0 : n - 1, { user: true }); dots[index].focus(); return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    goTo(index + (e.key === 'ArrowRight' ? 1 : -1), { user: true });
    if (e.target.closest('.review-dots')) dots[index].focus();
  });

  /* ---------- autoplay: the active dot's fill animation is the timer ---------- */
  let userPaused = false, hover = false, focusIn = false, visible = false, modal = false;
  const autoplayOn = () => !reduce.matches;
  function playing() { return autoplayOn() && !userPaused && !hover && !focusIn && visible && !modal && !dragging; }
  function syncPlay() {
    slider.classList.toggle('is-autoplay', autoplayOn());
    slider.classList.toggle('is-paused', !playing());
    if (playBtn) {
      playBtn.hidden = !autoplayOn();
      playBtn.classList.toggle('is-stopped', userPaused);
      playBtn.querySelector('.review-play-label').textContent = userPaused ? 'Automatikus lapozás indítása' : 'Automatikus lapozás szüneteltetése';
    }
  }
  function restartProgress() {
    dots.forEach((d) => {
      const f = d.querySelector('.review-dot-fill');
      f.style.animation = 'none';
      void f.offsetWidth;
      f.style.animation = '';
    });
  }
  dotsEl.addEventListener('animationend', (e) => {
    if (e.animationName === 'review-progress' && playing()) goTo(index + 1);
  });
  playBtn?.addEventListener('click', () => { userPaused = !userPaused; syncPlay(); });
  slider.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hover = true; syncPlay(); } });
  slider.addEventListener('pointerleave', () => { hover = false; syncPlay(); });
  slider.addEventListener('focusin', () => { focusIn = true; syncPlay(); });
  slider.addEventListener('focusout', (e) => { if (!slider.contains(e.relatedTarget)) { focusIn = false; syncPlay(); } });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; syncPlay(); }, { threshold: 0.35 }).observe(slider);
  document.addEventListener('modal:open', () => { modal = true; syncPlay(); });
  document.addEventListener('modal:close', () => { modal = false; syncPlay(); });
  reduce.addEventListener?.('change', syncPlay);

  /* ---------- drag / swipe ---------- */
  let dragging = false, pid = null, x0 = 0, y0 = 0, t0 = 0, dx = 0, axis = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (pid !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pid = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); dx = 0; axis = null;
  });
  viewport.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!axis && Math.hypot(mx, my) > 8) {
      axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (axis === 'x') {
        try { viewport.setPointerCapture(pid); } catch {}
        dragging = true; slider.classList.add('is-dragging'); syncPlay();
      }
    }
    if (axis !== 'x') return;
    dx = mx;
    // Rubber-band past the first and last card.
    const atEdge = (index === 0 && dx > 0) || (index === n - 1 && dx < 0);
    const shown = atEdge ? dx / (1 + Math.abs(dx) / 120) : dx;
    track.style.transform = `translate3d(calc(${-index * 100}% + ${shown}px),0,0)`;
  });
  const end = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    if (axis !== 'x') return;
    dragging = false; slider.classList.remove('is-dragging');
    const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
    const w = viewport.clientWidth;
    const dir = dx < 0 ? 1 : -1;
    const canMove = (dir > 0 && index < n - 1) || (dir < 0 && index > 0);
    if (canMove && (Math.abs(dx) > w * 0.18 || v > 0.11)) goTo(index + dir, { user: true });
    else render(false);
    syncPlay();
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);
  // Don't let a drag turn into a native image/text drag.
  viewport.addEventListener('dragstart', (e) => e.preventDefault());

  render(false);
  syncPlay();

  // D8: slider DOM built.
  section.dataset.ready = '1';
  section.dispatchEvent(new CustomEvent('reviews:ready', { bubbles: true }));
}
