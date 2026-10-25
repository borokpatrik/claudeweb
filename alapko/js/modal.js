// modal.js · Content agent
// Project modal ([data-project]) and gallery lightbox ([data-lightbox][data-index]), D6.
// Both are native <dialog>s opened with showModal(): the rest of the page is inert,
// Esc and backdrop clicks close, focus is trapped and returned to the trigger.
// Motion: CSS transitions on [data-state] (spring-shaped linear() for the open,
// quick ease-out for the close), so open/close/reopen retarget mid-flight.
import { getProject, loadManifest, photoFor, hydratePhotos, CATEGORY_LABEL, CATEGORY_MORE } from './projects.js';
import { getGalleryItems } from './gallery.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const html = document.documentElement;
const CLOSE_MS = 240;          // must cover the CSS close transition
const pad2 = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ICON_CLOSE = '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_PREV = '<svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_ARROW = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let manifest = new Map();
let current = null;            // { dlg, type, trigger, closeTimer, onClosed }
let pmDlg, lbDlg;

/* =========================================================
   Shared dialog plumbing
   ========================================================= */
function makeDialog(id, cls, inner, labelAttr) {
  const dlg = document.createElement('dialog');
  dlg.id = id;
  dlg.className = `modal ${cls}`;
  Object.entries(labelAttr).forEach(([k, v]) => dlg.setAttribute(k, v));
  dlg.innerHTML = inner;
  document.body.appendChild(dlg);

  // Esc: run our animated close instead of the instant native one.
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeModal(); });
  // If the browser closes it anyway (e.g. a forced second Esc), still clean up.
  dlg.addEventListener('close', () => { if (current?.dlg === dlg) finish(); });

  // Backdrop click: the press must start and end on the backdrop itself, so a
  // text selection dragged out of the panel doesn't close it.
  let downOnBackdrop = false;
  const isBackdrop = (t) => t === dlg || t.hasAttribute?.('data-backdrop');
  dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = isBackdrop(e.target); });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeModal(); return; }
    if (downOnBackdrop && isBackdrop(e.target) && !dlg.dataset.dragged) closeModal();
    downOnBackdrop = false;
  });

  // Focus trap (showModal already makes the page inert; this keeps Tab cycling
  // inside instead of escaping to the browser chrome).
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = Array.from(dlg.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dlg)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  return dlg;
}

function openDialog(dlg, type, trigger, detail, focusEl) {
  if (current && current.dlg !== dlg) finish(true);
  if (current?.dlg === dlg) {               // reopened while closing: retarget
    clearTimeout(current.closeTimer);
    current.closeTimer = 0;
    dlg.dataset.state = 'open';
    return;
  }
  current = { dlg, type, trigger, closeTimer: 0, onClosed: null };
  html.classList.add('modal-open');
  dlg.showModal();
  dlg.dataset.state = 'enter';
  void dlg.offsetWidth;                     // commit the closed pose, then transition
  dlg.dataset.state = 'open';
  (focusEl || dlg.querySelector('[data-close]'))?.focus({ preventScroll: true });
  document.dispatchEvent(new CustomEvent('modal:open', { detail: { type, ...detail } }));
}

/** Close whichever modal is open (animated). */
export function closeModal(onClosed) {
  if (!current || current.closeTimer) return;
  const c = current;
  c.onClosed = onClosed || null;
  c.dlg.dataset.state = 'closing';
  c.closeTimer = setTimeout(() => finish(), reduce.matches ? 160 : CLOSE_MS);
}

function finish(silent = false) {
  const c = current;
  if (!c) return;
  current = null;
  clearTimeout(c.closeTimer);
  delete c.dlg.dataset.state;
  if (c.dlg.open) c.dlg.close();
  html.classList.remove('modal-open');
  c.dlg.dispatchEvent(new CustomEvent('modal:cleanup'));
  if (!silent) {
    if (c.onClosed) c.onClosed();
    else returnFocus(c.trigger);
  }
  document.dispatchEvent(new CustomEvent('modal:close', { detail: { type: c.type } }));
}

function returnFocus(el) {
  if (!el || !el.isConnected) return;
  // Marquee clones are aria-hidden: hand focus to the real card with the same index.
  if (el.closest('[aria-hidden="true"]') && el.dataset.lightbox) {
    el = document.querySelector(`.gallery-set:not([aria-hidden]) .g-card:not([data-repeat]) [data-lightbox="${el.dataset.lightbox}"][data-index="${el.dataset.index}"]`) || el;
  }
  el.focus({ preventScroll: true });
}

/* =========================================================
   Project modal
   ========================================================= */
function buildProjectModal() {
  pmDlg = makeDialog('project-modal', 'modal--project', `
    <div class="modal-panel pm-panel" data-panel>
      <button class="modal-close" type="button" data-close aria-label="Bezárás">${ICON_CLOSE}</button>
      <div class="pm-media">
        <div class="pm-hero" data-hero></div>
        <p class="pm-credit" data-credit></p>
        <div class="pm-strip" role="group" aria-label="A projekt fotói" data-strip></div>
      </div>
      <div class="pm-body">
        <h2 class="pm-title" id="pm-title" data-title></h2>
        <p class="pm-sub" data-sub></p>
        <dl class="pm-facts" data-facts></dl>
        <div class="pm-desc" data-desc></div>
        <div class="pm-group">
          <h3 class="pm-h">Elvégzett munkák</h3>
          <ul class="pm-chips" data-scope></ul>
        </div>
        <div class="pm-group">
          <h3 class="pm-h">Felhasznált anyagok</h3>
          <ul class="pm-chips pm-chips--quiet" data-materials></ul>
        </div>
        <figure class="pm-quote" data-quote hidden>
          <svg class="pm-quote-mark" viewBox="0 0 40 32" width="34" height="27" aria-hidden="true"><path fill="currentColor" d="M0 32V19.2C0 8.5 5.4 2.1 16.2 0l1.6 4.4C11.6 6.3 8.6 10 8.6 15.6h8V32zm22.2 0V19.2C22.2 8.5 27.6 2.1 38.4 0L40 4.4c-6.2 1.9-9.2 5.6-9.2 11.2h8V32z"/></svg>
          <blockquote><p data-quote-text></p></blockquote>
          <figcaption data-quote-author></figcaption>
        </figure>
        <div class="pm-foot">
          <a class="btn btn--pill btn--ghost pm-more" href="#burkolas" data-more></a>
          <p class="pm-note">Bemutató célú mintaprojekt.</p>
        </div>
      </div>
    </div>`, { 'aria-labelledby': 'pm-title' });

  pmDlg.querySelector('[data-strip]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-photo-index]');
    if (b) setHero(+b.dataset.photoIndex);
  });
  pmDlg.querySelector('[data-more]').addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.querySelector(e.currentTarget.getAttribute('href'));
    closeModal(() => {
      if (!target) return;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + target.id);
    });
  });
  pmDlg.addEventListener('modal:cleanup', () => { pmDlg.querySelector('[data-hero]').textContent = ''; });
}

let pmPhotos = [];
let heroIndex = -1;

function heroImg(p, eager) {
  const img = new Image();
  img.className = 'pm-hero-img';
  img.alt = p.alt || '';
  img.width = p.w; img.height = p.h;
  if (p.h > p.w) img.classList.add('is-portrait');
  img.decoding = 'async';
  if (eager) img.fetchPriority = 'high';
  // Thumb first (usually cached from the page), full file swapped in when ready.
  img.src = p.thumb;
  const full = new Image();
  full.decoding = 'async';
  full.src = p.file;
  full.decode().then(() => { img.src = p.file; }).catch(() => {});
  img.addEventListener('error', () => img.classList.add('is-missing'), { once: true });
  return img;
}

function setHero(i, instant = false) {
  if (i === heroIndex || !pmPhotos[i]) return;
  heroIndex = i;
  const p = pmPhotos[i];
  const hero = pmDlg.querySelector('[data-hero]');
  const next = heroImg(p, true);
  const prev = Array.from(hero.querySelectorAll('.pm-hero-img'));
  hero.appendChild(next);
  if (!instant && !reduce.matches) {
    next.animate(
      [{ opacity: 0, filter: 'blur(8px)', transform: 'scale(1.035)' }, { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' }],
      { duration: 420, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    ).finished.then(() => prev.forEach((n) => n.remove())).catch(() => {});
  } else if (!instant) {
    next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }).finished.then(() => prev.forEach((n) => n.remove())).catch(() => {});
  } else prev.forEach((n) => n.remove());
  // Fallback when animations are throttled (background tab): never stack stale heroes.
  if (!instant) setTimeout(() => prev.forEach((n) => n.remove()), 600);

  const credit = pmDlg.querySelector('[data-credit]');
  credit.innerHTML = p.credit
    ? `${esc(p.caption)}${p.caption ? ' · ' : ''}Fotó: ${p.source ? `<a href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">${esc(p.credit)}</a>` : esc(p.credit)}${p.license ? `, ${esc(p.license)}` : ''}`
    : esc(p.caption);
  pmDlg.querySelectorAll('[data-photo-index]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.photoIndex === i)));
}

/** Open the project modal for a D4 project id. */
export function openProject(id, trigger = document.activeElement) {
  const proj = getProject(id);
  if (!proj) return;
  if (!pmDlg) buildProjectModal();
  const q = (s) => pmDlg.querySelector(s);

  pmPhotos = proj.photos.map((pid) => photoFor(manifest, pid));
  heroIndex = -1;
  q('[data-title]').textContent = proj.title;
  q('[data-sub]').textContent = `${CATEGORY_LABEL[proj.category]} · ${proj.location}, ${proj.year}`;
  q('[data-facts]').innerHTML = [
    ['Helyszín', proj.location], ['Év', proj.year], ['Méret', proj.area], ['Időtartam', proj.duration],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  q('[data-desc]').innerHTML = proj.description.split(/\n\n+/).map((t) => `<p>${esc(t)}</p>`).join('');
  q('[data-scope]').innerHTML = proj.scope.map((s) => `<li>${esc(s)}</li>`).join('');
  q('[data-materials]').innerHTML = proj.materials.map((s) => `<li>${esc(s)}</li>`).join('');
  const quote = q('[data-quote]');
  quote.hidden = !proj.quote;
  if (proj.quote) {
    q('[data-quote-text]').textContent = proj.quote.text;
    q('[data-quote-author]').textContent = proj.quote.author;
  }
  const more = q('[data-more]');
  more.href = '#' + proj.category;
  more.innerHTML = `${CATEGORY_MORE[proj.category]} ${ICON_ARROW}`;

  q('[data-strip]').innerHTML = pmPhotos.map((p, i) => `
    <button class="pm-thumb" type="button" data-photo-index="${i}" aria-pressed="false" aria-label="${i + 1}. fotó${p.alt ? ': ' + esc(p.alt) : ''}">
      <img src="${esc(p.thumb)}" alt="" width="160" height="107" decoding="async">
    </button>`).join('');
  q('[data-strip]').querySelectorAll('img').forEach((img) => img.addEventListener('error', () => img.classList.add('is-missing'), { once: true }));
  setHero(Math.max(0, proj.photos.indexOf(proj.cover)), true);

  pmDlg.querySelector('.pm-body').scrollTop = 0;
  pmDlg.querySelector('.pm-panel').scrollTop = 0;
  openDialog(pmDlg, 'project', trigger, { id });
}

/* =========================================================
   Gallery lightbox
   ========================================================= */
let lbIndex = 0;
let lbToken = 0;

function buildLightbox() {
  lbDlg = makeDialog('lightbox', 'modal--lightbox', `
    <div class="modal-panel lb-panel" data-panel>
      <div class="lb-bar">
        <p class="lb-count" data-count aria-live="polite" aria-atomic="true"></p>
        <button class="modal-close" type="button" data-close aria-label="Bezárás">${ICON_CLOSE}</button>
      </div>
      <div class="lb-stage" data-stage data-backdrop></div>
      <button class="lb-nav lb-prev" type="button" data-prev aria-label="Előző kép">${ICON_PREV}</button>
      <button class="lb-nav lb-next" type="button" data-next aria-label="Következő kép">${ICON_NEXT}</button>
      <div class="lb-info">
        <p class="lb-caption" id="lb-caption" data-caption></p>
        <p class="lb-credit" data-credit></p>
      </div>
    </div>`, { 'aria-label': 'Képnézegető', 'aria-describedby': 'lb-caption' });

  lbDlg.querySelector('[data-prev]').addEventListener('click', () => go(-1));
  lbDlg.querySelector('[data-next]').addEventListener('click', () => go(1));
  lbDlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'Home') { e.preventDefault(); show(0, -1); }
    else if (e.key === 'End') { e.preventDefault(); show(getGalleryItems().length - 1, 1); }
  });
  initSwipe(lbDlg.querySelector('[data-stage]'));
  lbDlg.addEventListener('modal:cleanup', () => { lbDlg.querySelector('[data-stage]').textContent = ''; });
}

function go(step) {
  const n = getGalleryItems().length;
  if (n < 2) return;
  show((lbIndex + step + n) % n, step);
}

function preload(i) {
  const items = getGalleryItems();
  const p = items[(i + items.length) % items.length];
  if (p) { const im = new Image(); im.decoding = 'async'; im.src = p.file; }
}

function show(i, dir = 0, fromX = 0) {
  const items = getGalleryItems();
  const p = items[i];
  if (!p) return;
  lbIndex = i;
  const token = ++lbToken;
  const stage = lbDlg.querySelector('[data-stage]');
  const old = Array.from(stage.querySelectorAll('.lb-img:not(.is-leaving)'));

  const img = new Image();
  img.className = 'lb-img';
  img.alt = p.alt || p.caption || '';
  img.width = p.w; img.height = p.h;
  img.decoding = 'async';
  img.draggable = false;
  img.src = p.thumb;                                   // instant, cached from the marquee
  img.addEventListener('error', () => img.classList.add('is-missing'), { once: true });
  const full = new Image();
  full.src = p.file;
  full.decode().then(() => { if (token === lbToken || img.isConnected) img.src = p.file; }).catch(() => {});
  stage.appendChild(img);

  const ease = 'cubic-bezier(0.23, 1, 0.32, 1)';
  old.forEach((o) => {
    o.classList.add('is-leaving');
    const anim = reduce.matches || !dir
      ? o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dir ? 140 : 0, fill: 'forwards' })
      : o.animate([{ transform: `translateX(${fromX}px)`, opacity: 1, filter: 'blur(0px)' },
          { transform: `translateX(${-dir * 14}%) scale(0.96)`, opacity: 0, filter: 'blur(6px)' }],
          { duration: 260, easing: ease, fill: 'forwards' });
    anim.finished.then(() => o.remove()).catch(() => o.remove());
    setTimeout(() => o.remove(), 500);
  });
  if (dir) {
    if (reduce.matches) img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    else img.animate([{ transform: `translateX(${dir * 12}%) scale(0.98)`, opacity: 0, filter: 'blur(6px)' },
      { transform: 'none', opacity: 1, filter: 'blur(0px)' }], { duration: 380, easing: ease });
  }

  const total = items.length;
  lbDlg.querySelector('[data-count]').textContent = `${pad2(i + 1)} / ${pad2(total)}`;
  lbDlg.querySelector('[data-count]').setAttribute('aria-label', `${i + 1}. kép, összesen ${total}`);
  lbDlg.querySelector('[data-caption]').textContent = p.caption || '';
  lbDlg.querySelector('[data-credit]').innerHTML = p.credit
    ? `Fotó: ${p.source ? `<a href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">${esc(p.credit)}</a>` : esc(p.credit)}${p.license ? ` · ${esc(p.license)}` : ''}`
    : '';
  const single = total < 2;
  lbDlg.querySelector('[data-prev]').hidden = single;
  lbDlg.querySelector('[data-next]').hidden = single;
  preload(i + 1); preload(i - 1);
}

// Horizontal swipe / drag on the stage. Follows the finger, rubber-bands past the
// ends of nothing (the list loops), commits on distance or a quick flick.
function initSwipe(stage) {
  let id = null, x0 = 0, y0 = 0, t0 = 0, dx = 0, axis = null, img = null;
  stage.addEventListener('pointerdown', (e) => {
    if (id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    img = stage.querySelector('.lb-img:not(.is-leaving)');
    if (!img) return;
    id = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); dx = 0; axis = null;
    delete lbDlg.dataset.dragged;
  });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!axis && Math.hypot(mx, my) > 8) {
      axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (axis === 'x') { try { stage.setPointerCapture(id); } catch {} lbDlg.dataset.dragged = '1'; }
    }
    if (axis !== 'x') return;
    dx = mx;
    img.style.transform = `translateX(${dx}px) rotate(${dx / 120}deg)`;
    img.style.opacity = String(1 - Math.min(0.5, Math.abs(dx) / 900));
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    if (axis !== 'x') { img = null; return; }
    const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
    const el = img; img = null;
    const commit = Math.abs(dx) > 70 || v > 0.11;
    if (commit && getGalleryItems().length > 1) {
      el.style.transform = ''; el.style.opacity = '';
      const n = getGalleryItems().length;
      const dir = dx < 0 ? 1 : -1;
      show((lbIndex + dir + n) % n, dir, dx);
    } else {
      const from = el.style.transform;
      el.style.transform = ''; el.style.opacity = '';
      el.animate([{ transform: from }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    }
    // Let the click that follows a drag through without closing.
    setTimeout(() => { delete lbDlg.dataset.dragged; }, 0);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
}

/** Open the lightbox for a gallery group at an index into GALLERY_IDS. */
export function openLightbox(group = 'galeria', index = 0, trigger = document.activeElement) {
  if (group !== 'galeria' || !getGalleryItems().length) return;
  if (!lbDlg) buildLightbox();
  show(Math.max(0, Math.min(index, getGalleryItems().length - 1)), 0);
  openDialog(lbDlg, 'lightbox', trigger, { index });
}

/* =========================================================
   Init: one delegated click listener (D6)
   ========================================================= */
let inited = false;
export function initModals() {
  if (inited) return;
  inited = true;
  loadManifest().then((m) => { manifest = m; });
  hydratePhotos(document);

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.target.closest('dialog.modal')) return;
    const pj = e.target.closest('[data-project]');
    if (pj) { e.preventDefault(); openProject(pj.dataset.project, pj); return; }
    const lb = e.target.closest('[data-lightbox]');
    if (lb) { e.preventDefault(); openLightbox(lb.dataset.lightbox, +lb.dataset.index || 0, lb); }
  });
}
