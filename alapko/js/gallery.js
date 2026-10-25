// gallery.js: three marquee rows of rendered stills in section#galeria.
// Motion: one WAAPI transform animation per row (compositor-driven, linear, infinite).
// Scroll velocity and hover only change its playbackRate, eased in a short rAF loop
// that sleeps once the rate has settled.
import { fillRenders } from './renders.js';

const CATEGORY = {
  tiles: 'Burkolás', wall: 'Falazás', rebar: 'Alapozás',
  house: 'Kulcsrakész ház', crane: 'Generálkivitelezés', blocks: 'Szerkezetépítés',
};
const PLACES = [
  'Budaörs', 'Szentendre', 'Érd', 'Gödöllő', 'Vác', 'Dunakeszi', 'Törökbálint', 'Fót',
  'Veresegyház', 'Biatorbágy', 'Pomáz', 'Szigetszentmiklós', 'Budakeszi', 'Solymár',
  'Kecskemét', 'Győr', 'Székesfehérvár', 'Tata', 'Esztergom', 'Visegrád', 'Pilisvörösvár',
  'Gyál', 'Dabas', 'Monor',
];
const ROWS = 3;
const BASE_SPEED = 38;          // px/s at playbackRate 1
const VARIANTS = [0, 1, 2, 3, 4, 5];

const CSS = `
#galeria .gallery-rows{--g-gap:clamp(12px,1.6vw,22px);--g-card:min(clamp(200px,26vw,360px),max(170px,calc(((100svh - 220px) / 3 - 44px) * 4 / 3)));
  
  display:flex;flex-direction:column;gap:var(--g-gap);width:100%}
#galeria .gallery-row{position:relative;overflow:hidden;outline:none;border-radius:20px;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);
          mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)}
#galeria .gallery-row:focus-visible{box-shadow:0 0 0 2px #f2a900}
#galeria .gallery-track{display:flex;width:max-content;will-change:transform}
#galeria .gallery-set{display:flex;gap:var(--g-gap);padding:10px var(--g-gap) 10px 0;margin:0;list-style:none}
#galeria .g-card{flex:0 0 var(--g-card);margin:0;
  transition:transform .45s cubic-bezier(0.23,1,0.32,1)}
#galeria .g-media{position:relative;aspect-ratio:4/3;border-radius:16px;overflow:hidden;
  background:radial-gradient(120% 90% at 50% 40%,#23262e 0%,#0f1014 100%);
  box-shadow:0 1px 0 rgba(243,239,232,.06) inset,0 18px 40px -24px rgba(0,0,0,.8)}
#galeria .g-media img{display:block;width:100%;height:100%;object-fit:cover;
  transition:opacity .7s cubic-bezier(0.23,1,0.32,1),transform .6s cubic-bezier(0.23,1,0.32,1)}
#galeria .g-card figcaption{margin-top:10px;font-size:.875rem;letter-spacing:.01em;
  color:rgba(243,239,232,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#galeria .g-card figcaption b{font-weight:600;color:#f3efe8}
@media (hover:hover) and (pointer:fine){
  #galeria .g-card:hover{transform:translateY(-6px) rotate(var(--tilt,-1.4deg)) scale(1.025);
    transition:transform .55s cubic-bezier(0.34,1.56,0.64,1)}
  #galeria .g-card:nth-child(even){--tilt:1.4deg}
  #galeria .g-card:hover img{transform:scale(1.06)}
}
#galeria.is-static .gallery-row{overflow-x:auto;scroll-snap-type:x mandatory;
  -webkit-mask-image:none;mask-image:none;scrollbar-width:thin;overscroll-behavior-x:contain}
#galeria.is-static .gallery-set{padding-left:var(--g-gap)}
#galeria.is-static .gallery-set[aria-hidden]{display:none}
#galeria.is-static .g-card{scroll-snap-align:start;scroll-margin-left:var(--g-gap)}
@media (prefers-reduced-motion:reduce){
  #galeria .g-card,#galeria .g-card:hover,#galeria .g-card:hover img{transform:none}
}`;

// Small seeded PRNG, so the layout is the same on every load.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deal all scene × variant pairs into rows with no two neighbours from the same scene
// (including the wrap-around seam of the loop).
function dealRows(ids, rand) {
  const items = [];
  ids.forEach((id) => VARIANTS.forEach((v) => items.push({ id, v })));
  for (let attempt = 0; attempt < 200; attempt++) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1)); [items[i], items[j]] = [items[j], items[i]];
    }
    const rows = Array.from({ length: ROWS }, () => []);
    const pool = items.slice();
    let ok = true;
    rows.forEach((row, r) => {
      const n = Math.ceil(pool.length / (ROWS - r));
      for (let k = 0; k < n && ok; k++) {
        const prev = row[row.length - 1];
        const isLast = k === n - 1;
        const idx = pool.findIndex((it) => it.id !== prev?.id && (!isLast || it.id !== row[0]?.id));
        if (idx < 0) ok = false; else row.push(pool.splice(idx, 1)[0]);
      }
    });
    if (ok) return rows;
  }
  return Array.from({ length: ROWS }, (_, r) => items.filter((_, i) => i % ROWS === r));
}

function card({ id, v }, place, clone, eager) {
  const li = document.createElement('li');
  li.className = 'g-card';
  const cat = CATEGORY[id] || id;
  li.innerHTML = `<figure style="margin:0"><div class="g-media"><img data-render="${id}:${v}"
    ${eager ? 'data-render-eager' : ''} width="800" height="600" decoding="async"
    alt="${clone ? '' : `${cat}, ${place} (látványterv)`}"></div>
    <figcaption><b>${cat}</b> · ${place}</figcaption></figure>`;
  return li;
}

export function initGallery(section, SCENES) {
  if (!section) return;
  if (!document.getElementById('gallery-style')) {
    const s = document.createElement('style');
    s.id = 'gallery-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  let host = section.querySelector('.gallery-rows');
  if (!host) { host = document.createElement('div'); host.className = 'gallery-rows'; section.appendChild(host); }
  host.textContent = '';

  const ids = Object.keys(CATEGORY).filter((id) => !SCENES || SCENES[id]);
  const rand = rng(1907);
  const rowsData = dealRows(ids.length ? ids : Object.keys(CATEGORY), rand);
  let p = 0;
  const rows = rowsData.map((items, r) => {
    const row = document.createElement('div');
    row.className = 'gallery-row';
    row.dataset.dir = r % 2 ? '1' : '-1';      // -1 moves left, 1 moves right
    row.setAttribute('data-render-group', '');
    row.tabIndex = 0;
    row.setAttribute('role', 'region');
    row.setAttribute('aria-label', `Galéria, ${r + 1}. sor`);
    const track = document.createElement('div');
    track.className = 'gallery-track';
    const a = document.createElement('ul'); a.className = 'gallery-set';
    const b = document.createElement('ul'); b.className = 'gallery-set';
    b.setAttribute('aria-hidden', 'true'); b.inert = true;
    items.forEach((it) => {
      const place = PLACES[p++ % PLACES.length];
      a.appendChild(card(it, place, false, r === 0));
      b.appendChild(card(it, place, true, r === 0));
    });
    track.append(a, b); row.appendChild(track); host.appendChild(row);
    return { row, track, set: a, dir: +row.dataset.dir, anim: null, hold: false, pause: 1, rate: 1 };
  });

  // ---- motion -------------------------------------------------------------
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false, raf = 0, lastY = scrollY, lastT = performance.now(), lastScrollT = 0, vel = 0, boost = 0;

  function setup() {
    rows.forEach((R) => {
      const w = R.set.getBoundingClientRect().width || 1;
      const dur = (w / BASE_SPEED) * 1000;
      if (!R.anim) {
        const from = R.dir < 0 ? 'translate3d(0,0,0)' : 'translate3d(-50%,0,0)';
        const to = R.dir < 0 ? 'translate3d(-50%,0,0)' : 'translate3d(0,0,0)';
        R.anim = R.track.animate([{ transform: from }, { transform: to }],
          { duration: dur, iterations: Infinity, easing: 'linear' });
        R.anim.currentTime = rand() * dur; // rows start out of phase
        if (!visible) R.anim.pause();
      } else {
        const t = R.anim.effect.getComputedTiming();
        const prog = (t.progress ?? 0);
        R.anim.effect.updateTiming({ duration: dur });
        R.anim.currentTime = prog * dur;
      }
    });
  }

  function teardown() {
    rows.forEach((R) => { R.anim?.cancel(); R.anim = null; R.track.style.transform = ''; });
  }

  function applyMode() {
    if (mq.matches) { section.classList.add('is-static'); teardown(); cancelAnimationFrame(raf); raf = 0; }
    else { section.classList.remove('is-static'); rows.forEach((R) => (R.row.scrollLeft = 0)); setup(); kick(); }
  }

  function tick() {
    raf = 0;
    const now = performance.now();
    const dt = Math.min(64, now - lastT) / 16.67; lastT = now;
    vel *= Math.pow(0.88, dt);                         // scroll velocity decays to 0
    const target = Math.max(-4, Math.min(6, vel / 180)); // px/s -> extra playback rate
    boost += (target - boost) * (1 - Math.pow(0.9, dt)); // eases toward target and back
    let busy = Math.abs(vel) > 2 || Math.abs(target - boost) > 0.002;
    rows.forEach((R) => {
      R.pause += ((R.hold ? 0 : 1) - R.pause) * (1 - Math.pow(0.82, dt)); // ~250 ms settle
      if (Math.abs(R.pause - (R.hold ? 0 : 1)) < 0.003) R.pause = R.hold ? 0 : 1; else busy = true;
      const rate = R.pause * (1 + boost);
      if (R.anim && rate !== R.rate && (Math.abs(rate - R.rate) > 0.001 || !busy)) {
        R.anim.playbackRate = rate; R.rate = rate;
      }
    });
    if (busy && visible) raf = requestAnimationFrame(tick);
  }
  function kick() { if (!raf && visible && !mq.matches) { lastT = performance.now(); raf = requestAnimationFrame(tick); } }

  addEventListener('scroll', () => {
    if (!visible || mq.matches) { lastY = scrollY; return; }
    const now = performance.now();
    const dy = scrollY - lastY; lastY = scrollY;
    const inst = (dy / Math.max(8, now - (lastScrollT || now - 16))) * 1000;
    lastScrollT = now;
    vel += (inst - vel) * 0.35;
    kick();
  }, { passive: true });

  rows.forEach((R) => {
    const update = () => {
      R.hold = R.row.matches(':hover') || R.row.contains(document.activeElement);
      kick();
    };
    R.row.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { R.hold = true; kick(); } });
    R.row.addEventListener('pointerleave', update);
    R.row.addEventListener('focusin', () => { R.hold = true; kick(); });
    R.row.addEventListener('focusout', () => setTimeout(update));
    // Keyboard: arrows nudge a focused row by one card.
    R.row.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const step = (e.key === 'ArrowRight' ? 1 : -1);
      if (mq.matches) { R.row.scrollBy({ left: step * R.set.firstChild.offsetWidth, behavior: 'smooth' }); e.preventDefault(); return; }
      if (!R.anim) return;
      const dur = R.anim.effect.getComputedTiming().duration;
      const n = R.set.children.length;
      // Moving content left means advancing a left-moving row, rewinding a right-moving one.
      R.anim.currentTime = (R.anim.currentTime + step * -R.dir * dur / n + dur) % dur;
      e.preventDefault();
    });
  });

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    rows.forEach((R) => R.anim && (visible ? R.anim.play() : R.anim.pause()));
    if (visible) { lastY = scrollY; kick(); }
  }, { rootMargin: '10% 0px' }).observe(section);

  let rz = 0;
  const ro = new ResizeObserver(() => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => !mq.matches && setup()); });
  ro.observe(host);
  mq.addEventListener?.('change', applyMode);
  applyMode();

  fillRenders(section, SCENES);
}
