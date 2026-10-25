// gallery.js · Content agent
// Three marquee rows of real photos (manifest, D1/D9) in section#galeria.
// Motion: one WAAPI transform animation per row (compositor-driven, linear, infinite).
// Scroll velocity and hover only change its playbackRate, eased in a short rAF loop
// that sleeps once the rate has settled. Every card is a <button data-lightbox="galeria"
// data-index="n"> that modal.js opens in the lightbox (D6).
import { loadManifest, photoFor, PROJECTS } from './projects.js';

const ROWS = 3;
const BASE_SPEED = 38;     // px/s at playbackRate 1
const MIN_PER_SET = 8;     // a set must be wider than the widest viewport
const MIN_GALLERY = 9;     // D9: pad with project photos below this

/** Ordered manifest ids shown in #galeria; index = data-index. Filled by initGallery. */
export let GALLERY_IDS = [];
let ITEMS = [];
/** Photo records for the lightbox, in GALLERY_IDS order. */
export const getGalleryItems = () => ITEMS;

const CSS = `
#galeria .gallery-rows{--g-gap:clamp(12px,1.6vw,22px);--g-card:min(clamp(200px,26vw,360px),max(170px,calc(((100svh - 220px) / 3 - 44px) * 4 / 3)));
  display:flex;flex-direction:column;gap:var(--g-gap);width:100%}
#galeria .gallery-row{position:relative;overflow:hidden;border-radius:20px;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);
          mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)}
#galeria .gallery-track{display:flex;width:max-content;will-change:transform}
#galeria .gallery-set{display:flex;gap:var(--g-gap);padding:10px var(--g-gap) 10px 0;margin:0;list-style:none}
#galeria .g-card{flex:0 0 var(--g-card);margin:0;transition:transform .45s cubic-bezier(0.23,1,0.32,1)}
#galeria .g-btn{display:block;width:100%;padding:0;border:0;background:none;text-align:left;cursor:zoom-in;border-radius:16px;color:inherit}
#galeria .g-btn:focus-visible{outline:2px solid var(--cool,#7fb4ff);outline-offset:3px}
#galeria .g-media{position:relative;display:block;aspect-ratio:4/3;border-radius:16px;overflow:hidden;
  background:radial-gradient(120% 90% at 50% 40%,#23262e 0%,#0f1014 100%);
  box-shadow:0 1px 0 rgba(243,239,232,.06) inset,0 18px 40px -24px rgba(0,0,0,.8)}
#galeria .g-media img{display:block;width:100%;height:100%;object-fit:cover;color:transparent;
  transition:opacity .7s cubic-bezier(0.23,1,0.32,1),transform .6s cubic-bezier(0.23,1,0.32,1)}
#galeria .g-media img.is-pending,#galeria .g-media img.is-missing,#galeria .g-media img:not([src]){opacity:0}
#galeria .g-cap{display:block;margin-top:10px;font-size:.875rem;letter-spacing:.01em;
  color:rgba(243,239,232,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#galeria .g-cap b{font-weight:600;color:#f3efe8}
@media (hover:hover) and (pointer:fine){
  #galeria .g-card:hover{transform:translateY(-6px) rotate(var(--tilt,-1.4deg)) scale(1.025);
    transition:transform .55s cubic-bezier(0.34,1.56,0.64,1)}
  #galeria .g-card:nth-child(even){--tilt:1.4deg}
  #galeria .g-card:hover img{transform:scale(1.06)}
}
#galeria .g-btn:active .g-media{transform:scale(.98);transition:transform .16s cubic-bezier(0.23,1,0.32,1)}
#galeria.is-static .gallery-row{overflow-x:auto;scroll-snap-type:x mandatory;
  -webkit-mask-image:none;mask-image:none;scrollbar-width:thin;overscroll-behavior-x:contain}
#galeria.is-static .gallery-set{padding-left:var(--g-gap)}
#galeria.is-static .gallery-set[aria-hidden],#galeria.is-static .g-card[data-repeat]{display:none}
#galeria.is-static .g-card{scroll-snap-align:start;scroll-margin-left:var(--g-gap)}
@media (prefers-reduced-motion:reduce){
  #galeria .g-card,#galeria .g-card:hover,#galeria .g-card:hover img{transform:none}
}`;

// Small seeded PRNG, so the phase offsets are the same on every load.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function card(item, index, hidden) {
  const li = document.createElement('li');
  li.className = 'g-card';
  const [kind, ...rest] = String(item.caption || '').split(' · ');
  const cap = rest.length ? `<b>${esc(kind)}</b> · ${esc(rest.join(' · '))}` : `<b>${esc(kind)}</b>`;
  const ratio = item.w && item.h ? `${item.w} / ${item.h}` : '4 / 3';
  li.innerHTML = `<button class="g-btn" type="button" data-lightbox="galeria" data-index="${index}"
    aria-haspopup="dialog" aria-label="${esc(item.caption || 'Kép')}: megnyitás nagyban"${hidden ? ' tabindex="-1"' : ''}>
    <span class="g-media"><img data-src="${esc(item.thumb)}" width="640" height="${Math.round(640 / (item.w / item.h || 4 / 3))}"
      alt="" decoding="async" style="aspect-ratio:${ratio}"></span>
    <span class="g-cap">${cap}</span></button>`;
  return li;
}

async function galleryItems() {
  const map = await loadManifest();
  let ids = [...map.values()].filter((p) => p.kind === 'gallery').map((p) => p.id).sort();
  if (ids.length < MIN_GALLERY) {
    // D9: pad with project photos (all of them when the manifest is missing).
    const extra = PROJECTS.flatMap((p) => p.photos).filter((id) => !ids.includes(id) && (!map.size || map.has(id)));
    ids = ids.concat(extra.slice(0, Math.max(MIN_GALLERY - ids.length, map.size ? 0 : extra.length)));
  }
  return ids.map((id) => {
    const p = photoFor(map, id);
    if (!p.caption) {
      const proj = PROJECTS.find((x) => id.startsWith(x.id + '-'));
      p.caption = proj ? `${proj.title} · ${proj.location}` : '';
    }
    return p;
  });
}

let started = false;

export async function initGallery(section) {
  if (!section || started) return;
  started = true;
  if (!document.getElementById('gallery-style')) {
    const s = document.createElement('style');
    s.id = 'gallery-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  let host = section.querySelector('.gallery-rows');
  if (!host) { host = document.createElement('div'); host.className = 'gallery-rows'; section.appendChild(host); }
  host.textContent = '';

  ITEMS = await galleryItems();
  GALLERY_IDS = ITEMS.map((p) => p.id);
  const rand = rng(1907);

  // Deal items round-robin into rows, so neighbours in a row are 3 apart in the list.
  const rowsData = Array.from({ length: ROWS }, (_, r) => ITEMS.map((it, i) => ({ it, i })).filter((x) => x.i % ROWS === r));
  const rows = rowsData.filter((d) => d.length).map((items, r) => {
    const row = document.createElement('div');
    row.className = 'gallery-row';
    row.dataset.dir = r % 2 ? '1' : '-1';      // -1 moves left, 1 moves right
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `Galéria, ${r + 1}. sor`);
    const track = document.createElement('div');
    track.className = 'gallery-track';
    const a = document.createElement('ul'); a.className = 'gallery-set';
    const b = document.createElement('ul'); b.className = 'gallery-set';
    b.setAttribute('aria-hidden', 'true'); // clones: aria-hidden + tabindex=-1 buttons (D6), still clickable
    // Repeat short rows inside the set so one set always spans the viewport.
    const reps = Math.max(1, Math.ceil(MIN_PER_SET / items.length));
    for (let k = 0; k < reps; k++) {
      items.forEach(({ it, i }) => {
        const c = card(it, i, k > 0);
        if (k > 0) { c.dataset.repeat = ''; c.setAttribute('aria-hidden', 'true'); }
        a.appendChild(c);
        b.appendChild(card(it, i, true));
      });
    }
    track.append(a, b); row.appendChild(track); host.appendChild(row);
    return { row, track, set: a, dir: +row.dataset.dir, anim: null, hold: false, pause: 1, rate: 1 };
  });

  // Images load once the section is near the viewport (lazy="loading" misjudges
  // cards that are off to the side inside an overflow:hidden marquee).
  const imgs = Array.from(host.querySelectorAll('img[data-src]'));
  const loadImgs = () => imgs.forEach((img) => {
    if (img.src) return;
    img.classList.add('is-pending');
    img.addEventListener('load', () => img.classList.remove('is-pending'), { once: true });
    img.addEventListener('error', () => { img.classList.remove('is-pending'); img.classList.add('is-missing'); }, { once: true });
    img.src = img.dataset.src;
  });
  const near = new IntersectionObserver(([e]) => { if (e.isIntersecting) { loadImgs(); near.disconnect(); } }, { rootMargin: '150% 0px' });
  near.observe(section);

  // D8: ready once rows exist and the first row's images settled (or 1.5 s).
  let readyFired = false;
  const fireReady = () => {
    if (readyFired) return; readyFired = true;
    section.dataset.ready = '1';
    section.dispatchEvent(new CustomEvent('gallery:ready', { bubbles: true }));
  };
  const firstRow = rows[0] ? Array.from(rows[0].set.querySelectorAll('img')) : [];
  setTimeout(fireReady, 1500);
  if (!firstRow.length) fireReady();
  else {
    let left = firstRow.length;
    firstRow.forEach((img) => {
      const settle = () => { if (--left <= 0) fireReady(); };
      img.addEventListener('load', settle, { once: true });
      img.addEventListener('error', settle, { once: true });
    });
  }

  // ---- motion -------------------------------------------------------------
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false, modalHold = false, raf = 0, lastY = scrollY, lastT = performance.now(), lastScrollT = 0, vel = 0, boost = 0;
  const running = () => visible && !modalHold;

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
        if (!running()) R.anim.pause();
      } else {
        const t = R.anim.effect.getComputedTiming();
        R.anim.effect.updateTiming({ duration: dur });
        R.anim.currentTime = (t.progress ?? 0) * dur;
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
    vel *= Math.pow(0.88, dt);
    const target = Math.max(-4, Math.min(6, vel / 180));
    boost += (target - boost) * (1 - Math.pow(0.9, dt));
    let busy = Math.abs(vel) > 2 || Math.abs(target - boost) > 0.002;
    rows.forEach((R) => {
      R.pause += ((R.hold ? 0 : 1) - R.pause) * (1 - Math.pow(0.82, dt));
      if (Math.abs(R.pause - (R.hold ? 0 : 1)) < 0.003) R.pause = R.hold ? 0 : 1; else busy = true;
      const rate = R.pause * (1 + boost);
      if (R.anim && rate !== R.rate && (Math.abs(rate - R.rate) > 0.001 || !busy)) {
        R.anim.playbackRate = rate; R.rate = rate;
      }
    });
    if (busy && running()) raf = requestAnimationFrame(tick);
  }
  function kick() { if (!raf && running() && !mq.matches) { lastT = performance.now(); raf = requestAnimationFrame(tick); } }

  addEventListener('scroll', () => {
    if (!running() || mq.matches) { lastY = scrollY; return; }
    const now = performance.now();
    const dy = scrollY - lastY; lastY = scrollY;
    const inst = (dy / Math.max(8, now - (lastScrollT || now - 16))) * 1000;
    lastScrollT = now;
    vel += (inst - vel) * 0.35;
    kick();
  }, { passive: true });

  // Keep the focused card inside the row: shift the loop instead of letting the
  // browser scroll the overflow:hidden row (which would desync the marquee).
  function revealCard(R, el) {
    R.row.scrollLeft = 0;
    if (!R.anim) return;
    const rr = R.row.getBoundingClientRect();
    const cr = el.getBoundingClientRect();
    const pad = rr.width * 0.08;
    let delta = 0;
    if (cr.left < rr.left + pad) delta = cr.left - (rr.left + pad);
    else if (cr.right > rr.right - pad) delta = cr.right - (rr.right - pad);
    if (!delta) return;
    const timing = R.anim.effect.getComputedTiming();
    const dur = timing.duration;
    const w = R.set.getBoundingClientRect().width || 1;
    // A left-moving row advances to move content left; a right-moving one rewinds.
    R.anim.currentTime = ((R.anim.currentTime + (R.dir < 0 ? 1 : -1) * delta * dur / w) % dur + dur) % dur;
  }

  rows.forEach((R) => {
    const update = () => {
      R.hold = R.row.matches(':hover') || R.row.contains(document.activeElement);
      kick();
    };
    R.row.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { R.hold = true; kick(); } });
    R.row.addEventListener('pointerleave', update);
    R.row.addEventListener('focusin', (e) => {
      R.hold = true; kick();
      if (!mq.matches) requestAnimationFrame(() => revealCard(R, e.target.closest('.g-card') || e.target));
    });
    R.row.addEventListener('focusout', () => setTimeout(update));
    R.row.addEventListener('scroll', () => { if (!mq.matches && R.row.scrollLeft) R.row.scrollLeft = 0; });
    // Keyboard: arrows move focus to the neighbouring card in the row.
    R.row.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const btns = Array.from(R.set.querySelectorAll('.g-card:not([data-repeat]) .g-btn'));
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      const next = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
      next.focus({ preventScroll: true });
      if (mq.matches) next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      e.preventDefault();
    });
  });

  const syncPlay = () => {
    rows.forEach((R) => R.anim && (running() ? R.anim.play() : R.anim.pause()));
    if (running()) { lastY = scrollY; kick(); }
  };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; syncPlay(); }, { rootMargin: '10% 0px' }).observe(section);
  // Motion note (D6): pause the marquee while any modal is open.
  document.addEventListener('modal:open', () => { modalHold = true; syncPlay(); });
  document.addEventListener('modal:close', () => { modalHold = false; syncPlay(); });

  let rz = 0;
  new ResizeObserver(() => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => !mq.matches && setup()); }).observe(host);
  mq.addEventListener?.('change', applyMode);
  applyMode();
}
