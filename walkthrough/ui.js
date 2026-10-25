// HUD for the Northbeam walkthrough (v2). Owns the room rail, progress, chapter card, scroll hint and loader.
// createUI(sections) -> { setProgress(p), setActive(id), ready(), announce(id) }

const pad2 = n => String(n).padStart(2, '0');

export function createUI(sections = []) {
  const rail = document.getElementById('rail');
  const list = document.getElementById('rail-list');
  const count = document.getElementById('progress-count');
  const current = document.getElementById('rail-current');
  const hint = document.getElementById('hint');
  const loader = document.getElementById('loader');
  const marker = rail.querySelector('.rail-marker');
  const chapter = document.getElementById('chapter');
  const chapterKicker = chapter?.querySelector('.kicker');
  const chapterTitle = chapter?.querySelector('h2');

  const total = sections.length;
  const items = new Map();
  list.textContent = '';
  sections.forEach(({ id, label }, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rail-item';
    btn.dataset.id = id;
    btn.dataset.index = String(i);
    btn.setAttribute('aria-label', `${label}, room ${i + 1} of ${total}`);
    btn.innerHTML = '<span class="rail-dot" aria-hidden="true"></span><span class="rail-num"></span><span class="rail-label"></span>';
    btn.querySelector('.rail-num').textContent = pad2(i + 1);
    btn.querySelector('.rail-label').textContent = label;
    btn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('walk:goto', { detail: { id } }));
    });
    li.appendChild(btn);
    list.appendChild(li);
    items.set(id, btn);
  });

  let lastPct = -1;
  let lastP = -1;
  let hintHidden = false;
  let activeId = null;

  function setProgress(p) {
    p = Math.min(1, Math.max(0, Number(p) || 0));
    if (Math.abs(p - lastP) > 0.0005) {
      lastP = p;
      rail.style.setProperty('--p', p.toFixed(4));
    }
    const pct = Math.round(p * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      count.textContent = String(pct).padStart(3, '0') + '%';
    }
    const hide = p > 0.02;
    if (hide !== hintHidden) {
      hintHidden = hide;
      hint.classList.toggle('is-hidden', hide);
    }
  }

  // The highlight slides between rows with a transform, so a fast scrub retargets mid-flight.
  function placeMarker() {
    const btn = activeId && items.get(activeId);
    if (!marker || !btn || !btn.offsetWidth) return;
    // buttons are offset within .rail-list (positioned); the marker lives in .rail-body
    const x = btn.offsetLeft + list.offsetLeft;
    const y = btn.offsetTop + list.offsetTop;
    marker.style.width = btn.offsetWidth + 'px';
    marker.style.height = btn.offsetHeight + 'px';
    marker.style.transform = `translate(${x}px, ${y}px)`;
    if (!marker.classList.contains('is-on')) {
      // first placement: appear in place rather than sliding in from the corner
      marker.style.transition = 'none';
      void marker.offsetWidth;
      marker.style.transition = '';
      marker.classList.add('is-on');
    }
  }
  let resizeRaf = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      // snap, don't animate, on layout changes (e.g. desktop rail -> mobile bar)
      if (marker) marker.style.transition = 'none';
      placeMarker();
      if (marker) { void marker.offsetWidth; marker.style.transition = ''; }
    });
  });

  function setActive(id) {
    if (id === activeId || !items.has(id)) return;
    activeId = id;
    const activeIndex = Number(items.get(id).dataset.index);
    items.forEach((btn) => {
      const i = Number(btn.dataset.index);
      const on = i === activeIndex;
      btn.classList.toggle('is-active', on);
      btn.classList.toggle('is-done', i < activeIndex);
      if (on) btn.setAttribute('aria-current', 'location');
      else btn.removeAttribute('aria-current');
    });
    const sec = sections[activeIndex];
    current.textContent = sec ? sec.label : '';
    placeMarker();
  }

  // ----- Chapter title card -----
  const HOLD_MS = 1600;
  const SWAP_MS = 220; // let the outgoing card fade before the new text lands
  let chapterTimer = 0;
  let swapTimer = 0;
  let pending = null;
  let isReady = false;

  function showChapter(id) {
    const i = sections.findIndex(s => s.id === id);
    if (i < 0 || !chapter) return;
    clearTimeout(chapterTimer);
    clearTimeout(swapTimer);
    const fill = () => {
      chapterKicker.textContent = `${pad2(i + 1)} / ${pad2(total)}`;
      chapterTitle.textContent = sections[i].label;
      void chapter.offsetWidth; // commit the hidden state so the entrance always plays
      chapter.classList.add('is-in');
      chapterTimer = setTimeout(() => chapter.classList.remove('is-in'), HOLD_MS);
    };
    if (chapter.classList.contains('is-in')) {
      chapter.classList.remove('is-in');
      swapTimer = setTimeout(fill, SWAP_MS);
    } else {
      fill();
    }
  }

  function announce(id) {
    if (!isReady) { pending = id; return; } // shown once the loader has cleared
    showChapter(id);
  }

  function ready() {
    if (isReady) return;
    isReady = true;
    loader.classList.add('is-done');
    document.body.classList.remove('is-loading');
    const cleanup = () => { loader.hidden = true; };
    loader.addEventListener('transitionend', (e) => { if (e.target === loader) cleanup(); });
    setTimeout(cleanup, 1200); // fallback if transitionend never fires
    placeMarker();
    if (pending) {
      const id = pending;
      pending = null;
      setTimeout(() => showChapter(id), 450);
    }
  }

  if (sections.length) setActive(sections[0].id);
  setProgress(0);

  return { setProgress, setActive, ready, announce };
}
