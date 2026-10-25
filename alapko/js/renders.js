// renders.js: turns SCENES into "photo" stills for img[data-render="<id>:<variant>"].
// One shared offscreen WebGLRenderer; renders run lazily, one per idle callback,
// and are cached by "id:variant" as JPEG object URLs.
import * as THREE from 'three';

const W = 800, H = 600;
const BG_INNER = '#23262e', BG_OUTER = '#0f1014'; // dark studio sweep (#15171c-ish average)

const cache = new Map();   // key -> Promise<string>
const waiting = new Map(); // key -> Set<img>
const queue = [];          // keys waiting for an idle slot (FIFO)
const seen = new WeakSet();
let renderer = null, comp = null, glFailed = false, pumping = false, sharedSCENES = null, io = null;

injectStyle();

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('renders-style')) return;
  const s = document.createElement('style');
  s.id = 'renders-style';
  s.textContent = `
img[data-render]{opacity:0;transition:opacity .7s cubic-bezier(0.23,1,0.32,1)}
img[data-render].is-rendered{opacity:1}
@media (prefers-reduced-motion: reduce){img[data-render]{transition-duration:.2s}}`;
  document.head.appendChild(s);
}

function getRenderer() {
  if (renderer || glFailed) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    comp = document.createElement('canvas');
    comp.width = W; comp.height = H;
  } catch (e) {
    console.warn('renders: WebGL unavailable, stills disabled', e);
    glFailed = true; renderer = null;
  }
  return renderer;
}

function disposeScene(scene) {
  scene.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => {
      for (const k in x) if (x[k] && x[k].isTexture) x[k].dispose();
      x.dispose?.();
    });
  });
}

// Synchronous GPU part + async JPEG encode. Returns an object URL.
async function renderNow(SCENES, id, variant, w = W, h = H) {
  const def = SCENES?.[id];
  if (!def) throw new Error(`renders: unknown scene "${id}"`);
  const r = getRenderer();
  if (!r) throw new Error('renders: no WebGL');
  if (comp.width !== w || comp.height !== h) { comp.width = w; comp.height = h; }
  r.setSize(w, h, false);

  const { scene, camera } = def.build(variant);
  scene.background = null;
  // Scenes are framed for 16:9. Keep the horizontal field of view, so the subject
  // keeps its width and simply gains headroom at 4:3.
  const baseAspect = 16 / 9, aspect = w / h;
  if (aspect < baseAspect) {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (baseAspect / aspect);
    camera.fov = THREE.MathUtils.radToDeg(Math.atan(t)) * 2;
  }
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  r.render(scene, camera);

  // Composite: studio sweep, then the transparent render, then a soft vignette.
  const ctx = comp.getContext('2d');
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.62);
  g.addColorStop(0, BG_INNER); g.addColorStop(1, BG_OUTER);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(r.domElement, 0, 0, w, h);
  const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);

  disposeScene(scene);
  const blob = await new Promise((res, rej) =>
    comp.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.85));
  return URL.createObjectURL(blob);
}

// Public: render (or reuse) one still. Goes through the idle queue unless already cached.
export function renderStill(SCENES, id, variant = 0, w = W, h = H) {
  const key = w === W && h === H ? `${id}:${variant}` : `${id}:${variant}@${w}x${h}`;
  if (!cache.has(key)) {
    let resolve, reject;
    const p = new Promise((a, b) => { resolve = a; reject = b; });
    p.catch(() => {}); // failures are reported by the caller / pump
    p._job = { SCENES, id, variant: +variant || 0, w, h, resolve, reject };
    cache.set(key, p);
    queue.push(key);
    pump();
  }
  return cache.get(key);
}

const idle = (fn) => (window.requestIdleCallback
  ? window.requestIdleCallback(fn, { timeout: 400 })
  : setTimeout(() => fn({ timeRemaining: () => 8 }), 60));

function pump() {
  if (pumping) return;
  pumping = true;
  idle(async () => {
    const key = queue.shift();
    if (key) {
      const job = cache.get(key)._job;
      try { job.resolve(await renderNow(job.SCENES, job.id, job.variant, job.w, job.h)); }
      catch (e) { console.warn(e); job.reject(e); }
    }
    pumping = false;
    if (queue.length) pump();
  });
}

function applyTo(key, url) {
  const imgs = waiting.get(key);
  if (!imgs) return;
  waiting.delete(key);
  imgs.forEach((img) => {
    img.addEventListener('load', () => img.classList.add('is-rendered'), { once: true });
    img.src = url;
  });
}

const requested = new WeakSet();
function request(img) {
  if (requested.has(img)) return;
  requested.add(img);
  const spec = img.dataset.render || '';
  const [id, v = '0'] = spec.split(':');
  const key = `${id}:${+v || 0}`;
  if (!waiting.has(key)) waiting.set(key, new Set());
  waiting.get(key).add(img);
  renderStill(sharedSCENES, id, +v || 0).then((url) => applyTo(key, url), () => {});
}

// Public: fill every img[data-render] under root. Lazy: an image is queued when it
// (or its [data-render-group] container) comes within ~1.5 screens of the viewport.
// img[data-render-eager] is queued immediately (still rendered in idle time).
export async function fillRenders(root = document, SCENES) {
  if (SCENES) sharedSCENES = SCENES;
  if (!sharedSCENES) return;
  if (!io) {
    io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        if (e.target.tagName === 'IMG') request(e.target);
        else e.target.querySelectorAll('img[data-render]').forEach(request);
      });
    }, { rootMargin: '150% 0px 150% 0px' });
  }
  const groups = new Set();
  root.querySelectorAll('img[data-render]').forEach((img) => {
    if (seen.has(img)) return;
    seen.add(img);
    if (img.hasAttribute('data-render-eager')) { request(img); return; }
    const group = img.closest('[data-render-group]');
    if (group) groups.add(group); else io.observe(img);
  });
  groups.forEach((g) => { if (!seen.has(g)) { seen.add(g); io.observe(g); } });
}
