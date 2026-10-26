// sections.js · Motion agent (v2; v1 by the Sections agent)
// Non-3D animation, header + dropdown, section pill, contact form.
// v2: pill covers #velemenyek, debounced ScrollTrigger.refresh() on load / gallery:ready / reviews:ready,
// reviews entrance, ticker pauses while a modal is open. SVG slot art lives in svg-anim.js.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const MAIL = 'info@example.hu';
const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

let initialised = false;

export function initSections() {
  if (initialised) return;
  initialised = true;
  gsap.registerPlugin(ScrollTrigger);

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  initHeader();
  initDropdown();
  initMobileNav();
  initPill();
  initForm(reduce);

  if (reduce) initReduced();
  else initMotion();

  initRefresh();
  initModalPause();
}

/* =========================================================
   Keep trigger positions honest when late content changes layout
   (fonts, window load, gallery rows, reviews slider; CONTRACT-V2 D8).
   ========================================================= */
let refreshTimer = 0;
export function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 120);
}

function onReady(id, evt, fn) {
  const sec = document.getElementById(id);
  let done = false;
  const run = () => { if (!done) { done = true; fn(sec); } };
  if (sec && sec.dataset.ready === '1') run();
  else document.addEventListener(evt, run, { once: true });
}

function initRefresh() {
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleRefresh);
  if (document.readyState === 'complete') scheduleRefresh();
  else window.addEventListener('load', scheduleRefresh, { once: true });
  onReady('galeria', 'gallery:ready', scheduleRefresh);
  onReady('velemenyek', 'reviews:ready', scheduleRefresh);
}

/* Decorative loops stop while a modal is open (D6 events). */
function initModalPause() {
  const set = (state) => qsa('.ticker-track').forEach((t) => { t.style.animationPlayState = state; });
  document.addEventListener('modal:open', () => set('paused'));
  document.addEventListener('modal:close', () => set(''));
}

/* =========================================================
   Header
   ========================================================= */
function initHeader() {
  const header = qs('#site-header');
  if (!header) return;
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* Disclosure dropdown: hover (fine pointers), click/tap, keyboard. */
function initDropdown() {
  qsa('[data-dropdown]').forEach((wrap) => {
    const btn = qs('.dd-btn', wrap);
    const menu = qs('.dd-menu', wrap);
    const links = qsa('a', menu);
    let closeTimer = 0;
    let hoverOpened = false;

    const isOpen = () => wrap.classList.contains('is-open');
    const open = (focusFirst = false) => {
      clearTimeout(closeTimer);
      wrap.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      if (focusFirst) links[0]?.focus();
    };
    const close = (returnFocus = false) => {
      clearTimeout(closeTimer);
      hoverOpened = false;
      wrap.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      if (returnFocus) btn.focus();
    };
    const desktop = () => window.matchMedia('(min-width: 981px)').matches;

    btn.addEventListener('click', () => {
      // A mouse click right after a hover-open "pins" the menu instead of closing it.
      if (hoverOpened && isOpen()) { hoverOpened = false; return; }
      isOpen() ? close() : open();
    });

    wrap.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || !desktop()) return;
      if (!isOpen()) { hoverOpened = true; open(); }
      clearTimeout(closeTimer);
    });
    wrap.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || !desktop()) return;
      closeTimer = setTimeout(() => close(), 180);
    });

    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); open(true); }
      if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(true); }
    });
    menu.addEventListener('keydown', (e) => {
      const i = links.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); links[(i + 1) % links.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); links[(i - 1 + links.length) % links.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); links[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); links[links.length - 1].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    });
    wrap.addEventListener('focusout', (e) => {
      if (!wrap.contains(e.relatedTarget) && desktop()) close();
    });
    document.addEventListener('pointerdown', (e) => {
      if (isOpen() && !wrap.contains(e.target)) close();
    });
    links.forEach((a) => a.addEventListener('click', () => close()));
  });
}

function initMobileNav() {
  const header = qs('#site-header');
  const toggle = qs('.nav-toggle');
  const nav = qs('#site-nav');
  if (!header || !toggle || !nav) return;
  const set = (open) => {
    header.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    qs('.nav-toggle-text', toggle).textContent = open ? 'Bezárás' : 'Menü';
  };
  toggle.addEventListener('click', () => set(toggle.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && header.classList.contains('nav-open')) { set(false); toggle.focus(); }
  });
  window.matchMedia('(min-width: 981px)').addEventListener('change', (m) => { if (m.matches) set(false); });
}

/* =========================================================
   Bottom-centre section pill + current-section tracking
   ========================================================= */
function initPill() {
  const pill = qs('#section-pill');
  const sections = qsa('main > section[id]');
  if (!pill || !sections.length) return;
  const btn = qs('.pill-btn', pill);
  const menu = qs('#pill-menu', pill);
  const nameEl = qs('.pill-name', pill);
  const numEl = qs('.pill-num', pill);
  syncPillMenu(menu, sections);
  const items = qsa('a', menu);

  const setCurrent = (sec) => {
    const idx = sections.indexOf(sec);
    const label = sec.dataset.label || sec.id;
    if (nameEl.textContent !== label) {
      nameEl.textContent = label;
      numEl.textContent = String(idx + 1).padStart(2, '0');
      btn.setAttribute('aria-label', `Szakaszok: ${label}`);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.fromTo(nameEl, { yPercent: 60, opacity: 0, filter: 'blur(3px)' },
          { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.45, ease: 'back.out(2.2)' });
      }
    }
    items.forEach((a) => {
      if (a.dataset.pill === sec.id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
    // header links
    const work = ['burkolas', 'falazas', 'alapozas', 'munkak'];
    qsa('.site-nav [data-nav]').forEach((a) => {
      const on = a.dataset.nav === sec.id || (a.classList.contains('dd-btn') && work.includes(sec.id));
      a.classList.toggle('is-current', on);
    });
  };

  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) setCurrent(en.target); });
  }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
  sections.forEach((s) => io.observe(s));

  const open = (focus = false) => {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    if (focus) (items.find((a) => a.hasAttribute('aria-current')) || items[0]).focus();
  };
  const close = (returnFocus = false) => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (returnFocus) btn.focus();
  };
  btn.addEventListener('click', () => (menu.hidden ? open() : close()));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); open(true); }
  });
  menu.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) close(true); });
  pill.addEventListener('focusout', (e) => { if (!pill.contains(e.relatedTarget)) close(); });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !pill.contains(e.target)) close(); });
  items.forEach((a) => a.addEventListener('click', () => close()));
}

// Make the pill menu mirror `main > section[id]`: insert any missing item (built from the
// section's data-label) in document order, and number every item NN.
function syncPillMenu(menu, sections) {
  sections.forEach((sec, i) => {
    let a = qs(`a[data-pill="${sec.id}"]`, menu);
    if (!a) {
      const li = document.createElement('li');
      a = document.createElement('a');
      a.href = '#' + sec.id;
      a.dataset.pill = sec.id;
      a.append(document.createElement('span'), document.createTextNode(sec.dataset.label || sec.id));
      li.append(a);
      const next = sections.slice(i + 1).map((s) => qs(`a[data-pill="${s.id}"]`, menu)).find(Boolean);
      menu.insertBefore(li, next ? next.closest('li') : null);
    }
    const num = qs('span', a);
    if (num) num.textContent = String(i + 1).padStart(2, '0');
  });
}

/* =========================================================
   Contact form
   ========================================================= */
function initForm(reduce) {
  const form = qs('#quote-form');
  const success = qs('#form-success');
  if (!form || !success) return;
  const summary = qs('#form-summary', form);

  const rules = {
    'f-name': (v) => (v.trim().length >= 2 ? '' : 'Kérjük, adja meg a nevét.'),
    'f-email': (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : (v.trim() ? 'Ez nem tűnik érvényes e-mail-címnek. Példa: nev@example.hu' : 'Kérjük, adja meg az e-mail-címét.')),
    'f-phone': (v) => (!v.trim() || /^[+0-9 ()\-/]{6,20}$/.test(v.trim()) ? '' : 'A telefonszám csak számjegyet, szóközt, +, - és / jelet tartalmazhat.'),
    'f-msg': (v) => (v.trim().length >= 10 ? '' : 'Írjon legalább 10 karaktert a munkáról (helyszín, méret, időpont).'),
  };

  const check = (id, show = true) => {
    const input = qs('#' + id, form);
    const msg = rules[id](input.value);
    if (show) {
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      qs('#' + id + '-err', form).textContent = msg;
    }
    return msg;
  };

  // Validate on blur once touched; clear errors live as the user fixes them.
  Object.keys(rules).forEach((id) => {
    const input = qs('#' + id, form);
    input.addEventListener('blur', () => { if (input.value || input.getAttribute('aria-invalid') === 'true') check(id); });
    input.addEventListener('input', () => { if (input.getAttribute('aria-invalid') === 'true') check(id); });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const bad = Object.keys(rules).filter((id) => check(id));
    if (bad.length) {
      summary.textContent = bad.length === 1
        ? 'Egy mezőt még javítani kell.'
        : `${bad.length} mezőt még javítani kell.`;
      qs('#' + bad[0], form).focus();
      if (!reduce) gsap.fromTo(form, { x: -8 }, { x: 0, duration: 0.6, ease: 'elastic.out(1.2, 0.3)' });
      return;
    }
    summary.textContent = '';
    const d = Object.fromEntries(new FormData(form).entries());
    const subject = `Ajánlatkérés – ${d.nev}`;
    const body = `Név: ${d.nev}\nE-mail: ${d.email}\nTelefon: ${d.telefon || '–'}\n\n${d.uzenet}`;
    const href = `mailto:${MAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    qs('#success-mailto', success).href = href;

    form.hidden = true;
    success.hidden = false;
    requestAnimationFrame(() => success.classList.add('is-shown'));
    qs('#success-title', success).focus();
    if (!reduce) {
      gsap.from(success.children, { y: 24, opacity: 0, duration: 0.7, ease: 'back.out(1.8)', stagger: 0.06 });
    }
    window.location.href = href;
  });

  qs('#form-reset', success).addEventListener('click', () => {
    form.reset();
    qsa('[aria-invalid]', form).forEach((el) => el.setAttribute('aria-invalid', 'false'));
    success.classList.remove('is-shown');
    success.hidden = true;
    form.hidden = false;
    qs('#f-name', form).focus();
  });
}

/* =========================================================
   Motion
   ========================================================= */
function initReduced() {
  // Simple fades; SVGs drawn fully; no transforms; floating blocks static.
  qsa('[data-split], [data-reveal], .figures, .chips, .photo-row, .work-cards, .contact-list, .review-viewport').forEach((el) => {
    gsap.from(el, {
      opacity: 0, duration: 0.4, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top 92%', once: true },
    });
  });
}

function initMotion() {
  heroIntro();
  splitReveals();
  simpleReveals();
  countUps();
  photoReveals();
  parallax();
  ticker();
  drawHouse();
  drawTiles();
  drawFoundation();
  floatingBlocks();
  workCards();
  onReady('velemenyek', 'reviews:ready', reviewsIntro);
}

/* ---------- #velemenyek: viewport + dots enter once (never touches .review-track) ---------- */
function reviewsIntro(sec) {
  if (!sec) return;
  const vp = qs('.review-viewport', sec);
  const dots = qsa('.review-dots > *', sec);
  const ctrls = qsa('[data-review-prev], [data-review-next]', sec);
  if (vp) {
    gsap.fromTo(vp, { y: 48, opacity: 0, clipPath: 'inset(8% 4% 8% 4% round 24px)' }, {
      y: 0, opacity: 1, clipPath: 'inset(0% 0% 0% 0% round 0px)', duration: 0.8, ease: 'expo.out',
      clearProps: 'clipPath',
      scrollTrigger: { trigger: vp, start: 'top 90%', once: true },
    });
  }
  if (dots.length || ctrls.length) {
    gsap.from([...ctrls, ...dots], {
      scale: 0.6, opacity: 0, duration: 0.5, ease: 'back.out(2.6)', stagger: 0.04, delay: 0.15,
      scrollTrigger: { trigger: vp || sec, start: 'top 90%', once: true },
    });
  }
  scheduleRefresh();
}

function heroIntro() {
  const hero = qs('#hero');
  if (!hero) return;
  const tl = gsap.timeline({ delay: 0.1 });
  tl.from(qsa('.ln-i', hero), { yPercent: 115, rotate: 5, duration: 1.1, ease: 'expo.out', stagger: 0.09 }, 0)
    .from(qsa('[data-hero-item]', hero), { y: 28, opacity: 0, duration: 0.9, ease: 'back.out(1.6)', stagger: 0.07 }, 0.08);
}

function splitReveals() {
  qsa('[data-split]').forEach((h) => {
    if (h.closest('#hero')) return;
    gsap.from(qsa('.ln-i', h), {
      yPercent: 115, rotate: 4, transformOrigin: '0% 100%',
      duration: 1.05, ease: 'expo.out', stagger: 0.08,
      scrollTrigger: { trigger: h, start: 'top 88%', once: true },
    });
  });
}

function simpleReveals() {
  qsa('[data-reveal]').forEach((el) => {
    if (el.closest('#hero')) return;
    gsap.from(el, {
      y: 30, opacity: 0, duration: 0.9, ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    });
  });
  qsa('[data-stagger]').forEach((list) => {
    gsap.from(list.children, {
      y: 22, scale: 0.92, opacity: 0, duration: 0.7, ease: 'back.out(2.4)', stagger: 0.05,
      scrollTrigger: { trigger: list, start: 'top 92%', once: true },
    });
  });
}

function countUps() {
  const figs = qs('.figures');
  if (!figs) return;
  const nums = qsa('[data-count]', figs);
  gsap.from(qsa('.figure', figs), {
    y: 40, opacity: 0, duration: 0.9, ease: 'back.out(1.8)', stagger: 0.07,
    scrollTrigger: { trigger: figs, start: 'top 92%', once: true },
  });
  ScrollTrigger.create({
    trigger: figs, start: 'top 92%', once: true,
    onEnter: () => nums.forEach((el, i) => {
      const end = Number(el.dataset.count);
      const o = { v: 0 };
      el.textContent = '0';
      gsap.to(o, {
        v: end, duration: 1.4, delay: i * 0.07, ease: 'expo.out',
        onUpdate: () => { el.textContent = String(Math.round(o.v)); },
      });
    }),
  });
}

function photoReveals() {
  qsa('[data-photos]').forEach((row, r) => {
    const phs = qsa('.ph', row);
    const caps = qsa('figcaption', row);
    // Alternate wipe direction per section: bottom-up for Burkolás, left-to-right for Alapozás.
    const from = r % 2 === 0
      ? 'inset(100% 0% 0% 0% round 14px)'
      : 'inset(0% 100% 0% 0% round 14px)';
    gsap.fromTo(phs, { clipPath: from }, {
      clipPath: 'inset(0% 0% 0% 0% round 14px)', duration: 1.1, ease: 'expo.out', stagger: 0.1,
      scrollTrigger: { trigger: row, start: 'top 92%', once: true },
    });
    gsap.from(caps, {
      y: 14, opacity: 0, duration: 1, ease: 'elastic.out(1, 0.45)', stagger: 0.1, delay: 0.25,
      scrollTrigger: { trigger: row, start: 'top 92%', once: true },
    });
  });
  // Falazás floating-block media: scale-settle inside the glass.
  const media = qs('.media-grid');
  if (media) {
    gsap.fromTo(qsa('.ph', media), { clipPath: 'inset(12% 12% 12% 12% round 30px)', opacity: 0.2 }, {
      clipPath: 'inset(0% 0% 0% 0% round 12px)', opacity: 1, duration: 1.1, ease: 'expo.out', stagger: 0.08,
      scrollTrigger: { trigger: media, start: 'top 95%', once: true },
    });
  }
}

function parallax() {
  qsa('[data-photos] .ph img, .media-grid .ph img').forEach((img) => {
    gsap.fromTo(img, { yPercent: -7 }, {
      yPercent: 7, ease: 'none',
      scrollTrigger: { trigger: img.closest('.ph'), start: 'top bottom', end: 'bottom top', scrub: true },
    });
  });
}

function ticker() {
  const t = qs('.ticker');
  if (!t) return;
  // Scroll nudges the band sideways on top of its constant CSS drift.
  gsap.fromTo(t, { x: 0 }, {
    x: -120, ease: 'none',
    scrollTrigger: { trigger: '#rolunk', start: 'top bottom', end: 'bottom top', scrub: 0.5 },
  });
}

/* ---------- SVG scroll-draws (scrubbed, never pinned) ---------- */
function prepDraw(svg) {
  const lines = qsa('.draw', svg);
  gsap.set(lines, { strokeDasharray: 1, strokeDashoffset: 1 });
  return lines;
}
function drawTimeline(svg, start = 'top 85%', end = 'bottom 55%') {
  return gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: { trigger: svg, start, end, scrub: 0.7 },
  });
}
const strokes = (svg, sel) => qsa(sel + ' .draw', svg);

function drawHouse() {
  const svg = qs('#svg-house');
  if (!svg) return;
  prepDraw(svg);
  const labels = qsa('.svg-label', svg);
  const fill = qsa('.fill', svg);
  gsap.set([...labels, ...fill], { opacity: 0 });
  // finish while the drawing is still in the upper-middle of the screen, not at its top edge
  drawTimeline(svg, 'top 90%', 'top 35%')
    .to(strokes(svg, '.g-ground'), { strokeDashoffset: 0, duration: 1, stagger: 0.15 })
    .to(strokes(svg, '.g-walls'), { strokeDashoffset: 0, duration: 1.2, stagger: 0.2 }, '-=0.4')
    .to(fill, { opacity: 1, duration: 0.6 }, '-=0.4')
    .to(strokes(svg, '.g-windows'), { strokeDashoffset: 0, duration: 0.7, stagger: 0.07 }, '-=0.3')
    .to(strokes(svg, '.g-dims'), { strokeDashoffset: 0, duration: 0.7, stagger: 0.15 }, '-=0.2')
    .to(labels, { opacity: 1, duration: 0.4, stagger: 0.1 }, '-=0.3');
}

function drawTiles() {
  const svg = qs('#svg-tiles');
  if (!svg) return;
  prepDraw(svg);
  const tiles = qsa('.tile', svg).sort((a, b) => a.dataset.d - b.dataset.d);
  const key = qs('.tile--key', svg);
  const label = qsa('.svg-label', svg);
  gsap.set(tiles, { opacity: 0, scale: 1.7, rotate: -14, transformOrigin: '50% 50%', y: -18 });
  gsap.set(label, { opacity: 0 });
  const tl = drawTimeline(svg, 'top 88%', 'bottom 45%');
  tl.to(strokes(svg, '.g-chalk'), { strokeDashoffset: 0, duration: 1, stagger: 0.2 })
    .to(tiles.filter((t) => t !== key), {
      opacity: 1, scale: 1, rotate: 0, y: 0, duration: 0.6, ease: 'back.out(2.2)',
      stagger: { each: 0.06, from: 'start' },
    }, '-=0.5')
    .to(key, { opacity: 1, scale: 1, rotate: 0, y: 0, duration: 0.9, ease: 'elastic.out(1.1, 0.4)' }, '-=0.1')
    .to(label, { opacity: 1, duration: 0.3 }, '-=0.4');
}

function drawFoundation() {
  const svg = qs('#svg-found');
  if (!svg) return;
  prepDraw(svg);
  const labels = qsa('.svg-label', svg);
  const dots = [...qsa('.gravel circle', svg), ...qsa('.rebar circle', svg)];
  const fill = qsa('.fill', svg);
  gsap.set([...labels, ...fill], { opacity: 0 });
  gsap.set(dots, { scale: 0.2, opacity: 0, transformOrigin: '50% 50%' });
  drawTimeline(svg, 'top 88%', 'top 35%')
    .to(strokes(svg, '.g-soil'), { strokeDashoffset: 0, duration: 1, stagger: 0.18 })
    .to(qsa('.g-soil .svg-label', svg), { opacity: 1, duration: 0.3, stagger: 0.1 }, '-=0.5')
    .to(strokes(svg, '.g-trench'), { strokeDashoffset: 0, duration: 0.9, stagger: 0.2 }, '-=0.3')
    .to(qsa('.gravel circle', svg), { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(3)', stagger: 0.03 }, '-=0.3')
    .to(qsa('.g-footing > .draw', svg), { strokeDashoffset: 0, duration: 0.8, stagger: 0.15 })
    .to(fill, { opacity: 1, duration: 0.4 }, '-=0.4')
    .to(qsa('.rebar circle', svg), { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(3)', stagger: 0.04 }, '-=0.3')
    .to(strokes(svg, '.g-stem'), { strokeDashoffset: 0, duration: 0.9, stagger: 0.15 })
    .to(strokes(svg, '.g-dims'), { strokeDashoffset: 0, duration: 0.6, stagger: 0.12 }, '-=0.2')
    .to(qsa('.g-dims .svg-label', svg), { opacity: 1, duration: 0.3, stagger: 0.08 }, '-=0.3');
}

/* ---------- 3D sections: floating glass blocks rise (scrubbed) ---------- */
function floatingBlocks() {
  qsa('[data-repel]').forEach((block) => {
    const section = block.closest('section');
    gsap.timeline({
      scrollTrigger: {
        trigger: section, start: 'top bottom', end: 'bottom top', scrub: 0.6,
        invalidateOnRefresh: true,
      },
    })
      .fromTo(block, { y: () => window.innerHeight * 0.38 }, { y: 0, ease: 'power2.out', duration: 1 })
      .to(block, { y: () => -window.innerHeight * 0.1, ease: 'none', duration: 1 });
  });
}

function workCards() {
  const cards = qsa('.work-card');
  if (!cards.length) return;
  gsap.from(cards, {
    y: 70, rotate: (i) => (i - 1) * 5, opacity: 0, transformOrigin: '50% 100%',
    duration: 0.95, ease: 'back.out(1.7)', stagger: 0.08,
    scrollTrigger: { trigger: '#munkak', start: 'top 60%', once: true },
  });
}
