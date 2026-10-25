// svg-anim.js · Motion agent (v2)
// Fills the D3 `[data-svg="name"]` slots with original line-art and animates it:
//   ruler       (#rolunk)      folding ruler unfolds hinge by hinge, scrubbed
//   level       (#burkolas)    spirit level draws (scrubbed), then rights itself and the bubble springs to centre
//   blueprint   (#alapozas)    floor plan + dimension lines with arrowheads, scrubbed
//   frame       (#galeria)     viewfinder corners + crosshair, scrubbed; focus-pull loop while in view
//   quote-stars (#velemenyek)  quote mark + 5 stars draw once; stars re-play on `reviews:change`
// Never pins, never locks scrolling. Loops pause off-screen, in hidden tabs and while a modal is open.
// Reduced motion: everything drawn fully and static; no springs, no loops.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

const STYLE = `
.svg-slot{--sa-ink:#f3efe8;--sa-dim:rgba(243,239,232,.42);--sa-amber:#f2a900;--sa-amber-line:#f2a900;--sa-cool:#7fb4ff;--sa-fill:rgba(242,169,0,.13)}
.section--light .svg-slot{--sa-ink:#0b0c0f;--sa-dim:rgba(11,12,15,.45);--sa-amber-line:#8a5c00;--sa-cool:#2f5f9e;--sa-fill:rgba(242,169,0,.32)}
.svg-slot>svg.sa{display:block;width:100%;height:100%;overflow:visible}
.sa .ln{fill:none;stroke:var(--sa-ink);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.sa .thin{stroke-width:1;stroke:var(--sa-dim)}
.sa .amb{stroke:var(--sa-amber-line);stroke-width:2}
.sa .cool{stroke:var(--sa-cool)}
.sa .txt{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:8px;fill:var(--sa-dim);letter-spacing:.04em}
.sa .rb{fill:var(--sa-fill);stroke:var(--sa-amber-line);stroke-width:1.4}
.sa .fill-amb{fill:var(--sa-amber);stroke:none}
.sa .grid{fill:none;stroke:var(--sa-cool);stroke-width:.6;opacity:.22}
.sa .star{fill:var(--sa-amber);fill-opacity:0;stroke:var(--sa-amber);stroke-width:1.6;stroke-linejoin:round}
.sa .q{fill:var(--sa-amber);fill-opacity:0;stroke:var(--sa-amber);stroke-width:2.2;stroke-linecap:round}
`;

let started = false;
let reduce = false;
let modalOpen = false;
const loops = new Set();

/* ---------- helpers ---------- */
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const r2 = (n) => Math.round(n * 100) / 100;

function aspectOf(slot, fallback) {
  const r = slot.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r.width / r.height : fallback;
}

function mount(slot, viewBox, inner) {
  slot.innerHTML = `<svg class="sa" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${inner}</svg>`;
  return slot.firstElementChild;
}

// Hide every `.d` stroke so it can be drawn (pathLength="1" on each).
function prepDraw(svg) {
  const lines = qsa('.d', svg);
  if (!reduce) gsap.set(lines, { strokeDasharray: 1, strokeDashoffset: 1 });
  return lines;
}

// Decorative loops play only while in view, the tab is visible and no modal is open.
function syncLoop(l) {
  if (l.inView && !modalOpen && !document.hidden) l.tl.play();
  else l.tl.pause();
}
function registerLoop(tl, trigger) {
  const l = { tl: tl.pause(), inView: false };
  loops.add(l);
  ScrollTrigger.create({
    trigger, start: 'top bottom', end: 'bottom top',
    onToggle: (self) => { l.inView = self.isActive; syncLoop(l); },
  });
  return l;
}
const syncAll = () => loops.forEach(syncLoop);

/* =========================================================
   ruler · #rolunk: a folding (carpenter's) ruler unfolds left → right
   ========================================================= */
function buildRuler(slot) {
  const H = 70;
  const ar = Math.max(4, aspectOf(slot, 16));
  const W = Math.round(H * ar);
  const n = ar >= 11 ? 8 : 4;            // 8 × 20 cm desktop, 4 on mobile
  const pad = 12;
  const L = (W - pad * 2) / n;
  const cy = 35;
  const y0 = 24; const h = 22;

  const seg = (i) => {
    let ticks = '';
    for (let k = 1; k < 20; k++) {
      const x = r2((k * L) / 20);
      const len = k % 10 === 0 ? 10 : k % 5 === 0 ? 7 : 4;
      ticks += `M${x} ${y0}v${len}`;
    }
    const mid = i * 20 + 10;
    return `<rect class="rb" x="0" y="${y0}" width="${r2(L)}" height="${h}" rx="2"/>`
      + `<path class="thin" d="${ticks}" style="stroke:var(--sa-ink);opacity:.75"/>`
      + `<text class="txt" x="${r2(L / 2)}" y="${y0 + h - 3}" text-anchor="middle">${mid}</text>`
      + `<circle cx="${r2(L - 4)}" cy="${cy}" r="1.6" class="fill-amb" style="fill:var(--sa-ink);opacity:.55"/>`;
  };
  // Nested hinge groups: each segment hangs off the end of the previous one.
  let inner = '';
  for (let i = n - 1; i >= 0; i--) {
    inner = `<g class="seg" data-i="${i}">${seg(i)}${inner}</g>`;
  }
  const svg = mount(slot, `0 0 ${W} ${H}`, `<g class="ruler" transform="translate(${pad} 0)">${inner}</g>`);
  const groups = qsa('.seg', svg);
  const folded = groups.map((_, i) => (i === 0 ? 0 : (i % 2 ? 1 : -1) * 177));
  const win = 0.34;
  const step = n > 1 ? (1 - win) / (n - 1) : 0;
  const hinge = gsap.parseEase('back.out(1.5)');

  const apply = (p) => {
    groups.forEach((g, i) => {
      if (i === 0) return;
      const t = clamp01((p - (i - 1) * step) / win);
      const a = folded[i] * (1 - hinge(t));
      g.setAttribute('transform', `translate(${r2(L)} 0) rotate(${r2(a)} 0 ${cy})`);
    });
  };

  if (reduce) { apply(1); return { ar }; }
  apply(0);
  const ruler = qs('.ruler', svg);
  const proxy = { p: 0 };
  gsap.timeline({
    scrollTrigger: { trigger: slot, start: 'top 94%', end: 'top 38%', scrub: 0.8 },
  })
    .fromTo(ruler, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.12, ease: 'power2.out' })
    .to(proxy, { p: 1, duration: 1, ease: 'none', onUpdate: () => apply(proxy.p) }, 0.06);
  return { ar };
}

/* =========================================================
   level · #burkolas: spirit level draws, rights itself, bubble springs to centre
   ========================================================= */
function buildLevel(slot) {
  let ticks = '';
  for (let x = 18; x <= 282; x += 12) ticks += `M${x} 46v${(x - 18) % 48 === 0 ? -6 : -3}`;
  const uid = 'sa-vial-' + Math.random().toString(36).slice(2, 7);
  const svg = mount(slot, '0 0 300 60', `
    <defs><clipPath id="${uid}"><rect x="111" y="22" width="78" height="16" rx="8"/></clipPath></defs>
    <g class="lvl">
      <rect class="ln d" pathLength="1" x="6" y="14" width="288" height="32" rx="6"/>
      <path class="ln thin d" pathLength="1" d="M34 14v32M266 14v32"/>
      <circle class="ln thin d" pathLength="1" cx="20" cy="30" r="7"/>
      <circle class="ln thin d" pathLength="1" cx="280" cy="30" r="7"/>
      <path class="ln thin d" pathLength="1" d="${ticks}"/>
      <g clip-path="url(#${uid})"><g class="bubw"><ellipse class="bub fill-amb" cx="150" cy="30" rx="11" ry="6.2"/></g></g>
      <rect class="ln amb d" pathLength="1" x="110" y="21" width="80" height="18" rx="9"/>
      <path class="ln thin d" pathLength="1" d="M138 21v18M162 21v18"/>
    </g>`);
  const lines = prepDraw(svg);
  const lvl = qs('.lvl', svg);
  const bub = qs('.bub', svg);
  const bubw = qs('.bubw', svg);
  if (reduce) return;

  const TILT = -4.5;     // right end up
  const OFF = 27;        // bubble pinned to the high (right) end
  const tilted = () => {
    gsap.set(lvl, { rotation: TILT, svgOrigin: '150 30' });
    gsap.set(bub, { x: OFF, scaleX: 1.25, svgOrigin: '150 30' });
  };
  tilted();
  bub.style.opacity = '0';

  gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: { trigger: slot, start: 'top 96%', end: 'top 62%', scrub: 0.6 },
  })
    .to(lines.slice(0, 1), { strokeDashoffset: 0, duration: 1 })
    .to(lines.slice(1), { strokeDashoffset: 0, duration: 0.6, stagger: 0.08 }, 0.3);

  let settle;
  ScrollTrigger.create({
    trigger: slot, start: 'top 62%',
    onEnter: () => {
      settle?.kill();
      bub.style.opacity = '1';
      settle = gsap.timeline()
        .fromTo(bub, { opacity: 0 }, { opacity: 1, duration: 0.15 }, 0)
        .to(lvl, { rotation: 0, duration: 0.9, ease: 'elastic.out(1, 0.45)' }, 0)
        .to(bub, { x: 0, duration: 1.1, ease: 'elastic.out(1.1, 0.32)' }, 0.06)
        .to(bub, { scaleX: 1, duration: 0.5, ease: 'back.out(3)' }, 0.18);
    },
    onLeaveBack: () => { settle?.kill(); tilted(); bub.style.opacity = '0'; },
  });

  // Idle: the bubble breathes a hair left/right.
  registerLoop(
    gsap.timeline({ repeat: -1, yoyo: true })
      .fromTo(bubw, { x: -1.4 }, { x: 1.4, duration: 2.2, ease: 'sine.inOut' }),
    slot,
  );
}

/* =========================================================
   blueprint · #alapozas: floor plan with dimension arrows
   ========================================================= */
function buildBlueprint(slot) {
  let grid = '';
  for (let x = 20; x <= 260; x += 20) grid += `M${x} 8V192`;
  for (let y = 20; y <= 180; y += 20) grid += `M8 ${y}H272`;
  const svg = mount(slot, '0 0 280 200', `
    <path class="grid" d="${grid}"/>
    <g class="walls">
      <rect class="ln d" pathLength="1" x="40" y="40" width="200" height="120" style="stroke-width:2.2"/>
      <rect class="ln thin d" pathLength="1" x="46" y="46" width="188" height="108"/>
      <path class="ln d" pathLength="1" d="M140 46V110M140 130V154"/>
      <path class="ln d" pathLength="1" d="M46 100H100"/>
    </g>
    <g class="openings">
      <path class="ln cool d" pathLength="1" d="M66 40h44M66 46h44"/>
      <path class="ln cool d" pathLength="1" d="M170 40h44M170 46h44"/>
      <path class="ln cool d" pathLength="1" d="M240 84v32M234 84v32"/>
      <path class="ln amb d" pathLength="1" d="M140 130h20" style="stroke-width:1.4"/>
      <path class="ln amb thin d" pathLength="1" d="M160 130A20 20 0 0 0 140 110" style="stroke:var(--sa-amber-line)"/>
    </g>
    <g class="dims">
      <path class="ln thin d" pathLength="1" d="M40 14v22M240 14v22"/>
      <path class="ln amb d" pathLength="1" d="M40 22H240" style="stroke-width:1.2"/>
      <path class="ln thin d" pathLength="1" d="M246 40h22M246 160h22"/>
      <path class="ln amb d" pathLength="1" d="M260 40V160" style="stroke-width:1.2"/>
      <path class="arr fill-amb" d="M40 22l8-3.6v7.2z"/>
      <path class="arr fill-amb" d="M240 22l-8-3.6v7.2z"/>
      <path class="arr fill-amb" d="M260 40l-3.6 8h7.2z"/>
      <path class="arr fill-amb" d="M260 160l-3.6-8h7.2z"/>
      <text class="txt" x="140" y="16" text-anchor="middle">8,40</text>
      <text class="txt" x="272" y="100" text-anchor="middle" transform="rotate(-90 272 100)">6,00</text>
      <text class="txt" x="92" y="132" text-anchor="middle">NAPPALI</text>
      <text class="txt" x="190" y="96" text-anchor="middle">KONYHA</text>
    </g>`);
  prepDraw(svg);
  if (reduce) return;
  const grid$ = qs('.grid', svg);
  const arrows = qsa('.arr', svg);
  const texts = qsa('.txt', svg);
  gsap.set(grid$, { opacity: 0 });
  gsap.set(arrows, { scale: 0.1, opacity: 0, transformOrigin: '50% 50%' });
  gsap.set(texts, { opacity: 0, y: 4 });
  gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: { trigger: slot, start: 'top 92%', end: 'bottom 50%', scrub: 0.7 },
  })
    .to(grid$, { opacity: 0.22, duration: 0.4, ease: 'none' })
    .to(qsa('.walls .d', svg), { strokeDashoffset: 0, duration: 1, stagger: 0.18 }, 0.1)
    .to(qsa('.openings .d', svg), { strokeDashoffset: 0, duration: 0.5, stagger: 0.1 }, '-=0.3')
    .to(qsa('.dims .d', svg), { strokeDashoffset: 0, duration: 0.6, stagger: 0.12, ease: 'expo.out' }, '-=0.2')
    .to(arrows, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(3)', stagger: 0.06 }, '-=0.35')
    .to(texts, { opacity: 1, y: 0, duration: 0.3, stagger: 0.06, ease: 'power2.out' }, '-=0.2');
}

/* =========================================================
   frame · #galeria: viewfinder corners close in, crosshair draws, focus-pull loop
   ========================================================= */
function buildFrame(slot) {
  const C = [
    { d: 'M14 44V14H44', dx: -1, dy: -1 },
    { d: 'M176 14H206V44', dx: 1, dy: -1 },
    { d: 'M206 96V126H176', dx: 1, dy: 1 },
    { d: 'M44 126H14V96', dx: -1, dy: 1 },
  ];
  const svg = mount(slot, '0 0 220 140', `
    ${C.map((c) => `<g class="cw" data-dx="${c.dx}" data-dy="${c.dy}"><path class="ln amb d corner" pathLength="1" d="${c.d}" style="stroke-width:2.4"/></g>`).join('')}
    <g class="xh">
      <path class="ln thin d" pathLength="1" d="M110 46V60M110 80V94M86 70H100M120 70H134"/>
      <g class="ringw"><circle class="ln d ring" pathLength="1" cx="110" cy="70" r="14"/></g>
      <circle class="fill-amb dot" cx="110" cy="70" r="1.8"/>
    </g>
    <circle class="fill-amb rec" cx="28" cy="28" r="3"/>
    <text class="txt" x="38" y="31">REC</text>
    <text class="txt" x="196" y="118" text-anchor="end">f/2.8</text>`);
  prepDraw(svg);
  if (reduce) return;
  const wraps = qsa('.cw', svg);
  const corners = qsa('.corner', svg);
  const ringw = qs('.ringw', svg);
  const ring = qs('.ring', svg);
  const extras = qsa('.dot, .rec, .txt', svg);
  gsap.set(extras, { opacity: 0 });
  gsap.set(ringw, { scale: 1.7, transformOrigin: '50% 50%' });

  gsap.timeline({
    defaults: { ease: 'power2.out' },
    scrollTrigger: { trigger: slot, start: 'top 94%', end: 'top 50%', scrub: 0.6 },
  })
    .fromTo(wraps, { x: (i, el) => el.dataset.dx * 16, y: (i, el) => el.dataset.dy * 16 },
      { x: 0, y: 0, duration: 1, ease: 'expo.out', stagger: 0.05 }, 0)
    .to(corners, { strokeDashoffset: 0, duration: 0.8, stagger: 0.05 }, 0)
    .to(qsa('.xh .d', svg), { strokeDashoffset: 0, duration: 0.6, stagger: 0.1 }, 0.35)
    .to(ringw, { scale: 1, duration: 0.7, ease: 'back.out(2)' }, 0.4)
    .to(extras, { opacity: 1, duration: 0.25, stagger: 0.05 }, 0.8);

  // Focus pull: corners breathe inward, the ring tightens, REC blinks.
  registerLoop(
    gsap.timeline({ repeat: -1, repeatDelay: 0.5, defaults: { ease: 'sine.inOut' } })
      .to(corners, { x: (i) => -C[i].dx * 3, y: (i) => -C[i].dy * 3, duration: 1.1, yoyo: true, repeat: 1 }, 0)
      .to(ring, { scale: 0.84, svgOrigin: '110 70', duration: 1.1, yoyo: true, repeat: 1 }, 0)
      .to(qs('.rec', svg), { opacity: 0.25, duration: 0.5, yoyo: true, repeat: 3, ease: 'steps(1)' }, 0),
    slot,
  );
}

/* =========================================================
   quote-stars · #velemenyek: quote mark draws, five stars draw + fill; re-play on reviews:change
   ========================================================= */
function starPath(cx, cy, R, r) {
  let d = '';
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rad = k % 2 ? r : R;
    d += (k ? 'L' : 'M') + r2(cx + rad * Math.cos(a)) + ' ' + r2(cy + rad * Math.sin(a));
  }
  return d + 'Z';
}
function quoteGlyph(cx, cy, r) {
  // An opening “ : round head, tail sweeping up and right.
  return `M${cx - r} ${cy}C${cx - r} ${r2(cy - 2.3 * r)} ${r2(cx + 0.1 * r)} ${r2(cy - 3.3 * r)} ${r2(cx + 1.2 * r)} ${r2(cy - 3.5 * r)}`
    + `M${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}`;
}
function buildQuoteStars(slot) {
  const stars = Array.from({ length: 5 }, (_, i) => `<path class="star d" pathLength="1" d="${starPath(28 + i * 36, 128, 13, 5.6)}"/>`).join('');
  const svg = mount(slot, '0 0 200 160', `
    <path class="q d" pathLength="1" d="${quoteGlyph(62, 74, 13)}"/>
    <path class="q d" pathLength="1" d="${quoteGlyph(108, 74, 13)}"/>
    <path class="ln thin d" pathLength="1" d="M140 66h40M140 78h28" />
    ${stars}`);
  prepDraw(svg);
  const q = qsa('.q', svg);
  const s = qsa('.star', svg);
  const rule = qsa('.thin', svg);
  if (reduce) { gsap.set(q, { fillOpacity: 0.16 }); gsap.set(s, { fillOpacity: 1 }); return; }
  gsap.set(s, { transformOrigin: '50% 50%' });

  let played = false;
  let tl;
  const starsIn = (t, at) => t
    .to(s, { strokeDashoffset: 0, duration: 0.32, ease: 'power2.out', stagger: 0.06 }, at)
    .fromTo(s, { scale: 0.6 }, { fillOpacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2.6)', stagger: 0.06 }, at + 0.16);

  ScrollTrigger.create({
    trigger: slot, start: 'top 85%', once: true,
    onEnter: () => {
      played = true;
      tl = gsap.timeline()
        .to(q, { strokeDashoffset: 0, duration: 0.55, ease: 'expo.out', stagger: 0.08 }, 0)
        .to(q, { fillOpacity: 0.16, duration: 0.4, ease: 'power1.out' }, 0.35)
        .to(rule, { strokeDashoffset: 0, duration: 0.4, ease: 'expo.out', stagger: 0.08 }, 0.2);
      starsIn(tl, 0.22);
    },
  });

  // Re-play only the stars when the slider changes (cheap, ~0.6 s, interrupts cleanly).
  const section = slot.closest('section') || document;
  section.addEventListener('reviews:change', () => {
    if (!played || modalOpen) return;
    tl?.progress(1);
    tl = gsap.timeline()
      .to(s, { fillOpacity: 0, scale: 0.86, duration: 0.12, ease: 'power2.in' }, 0)
      .set(s, { strokeDashoffset: 1 }, 0.12);
    starsIn(tl, 0.14);
  });
}

/* ========================================================= */
const BUILDERS = {
  ruler: buildRuler,
  level: buildLevel,
  blueprint: buildBlueprint,
  frame: buildFrame,
  'quote-stars': buildQuoteStars,
};

export function initSvgAnims() {
  if (started) return;
  started = true;
  gsap.registerPlugin(ScrollTrigger);
  reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!document.getElementById('svg-anim-style')) {
    const st = document.createElement('style');
    st.id = 'svg-anim-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  Object.entries(BUILDERS).forEach(([name, build]) => {
    qsa(`[data-svg="${name}"]`).forEach((slot) => {
      if (name !== 'ruler') { build(slot); return; }
      // The ruler's geometry follows the slot's aspect (16:1 desktop, 8:1 mobile): rebuild on a real change.
      let info = null;
      let ctx = gsap.context(() => { info = build(slot); });
      let t = 0;
      window.addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const ar = aspectOf(slot, 16);
          if (!info || Math.abs(ar - info.ar) / info.ar < 0.2) return;
          ctx.revert();
          ctx = gsap.context(() => { info = build(slot); });
          ScrollTrigger.refresh();
        }, 200);
      });
    });
  });

  if (reduce) return;
  document.addEventListener('modal:open', () => { modalOpen = true; syncAll(); });
  document.addEventListener('modal:close', () => { modalOpen = false; syncAll(); });
  document.addEventListener('visibilitychange', syncAll);
}
