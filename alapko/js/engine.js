// engine.js: fine pixel-grid point world behind the 3D sections (Alapkő v2).
// export createEngine(canvas, SCENES) -> { show(id), start(), stats }
//
// Each 3D section shows one composed cloud (CONTRACT-V2 D2):
//   far layer  - a landscape photo + depth map; every sampled pixel becomes a point on its camera
//                ray, pushed back by its depth. Sky pixels become sparse, dim, fog-tinted haze.
//   object     - the procedural scene from scenes.js, baked offscreen (colour + linear depth from
//                three yaws), placed at the section's anchor on the landscape's ground, lit to match
//                the photo (sun side/colour estimated from the sky) and slightly fogged by distance.
//   near layer - a second photo, only its lower part (depth > ~0.45), in front of the object.
// Points are soft round dots of varied size over a flat dark gradient (no sky points), so the frame
// reads as one painterly image. Everything is in one buffer, so section changes morph the whole composition.
//
// All heavy work (manifest/blob fetch, createImageBitmap decode with resize, getImageData on an
// offscreen 2D canvas, object renders + readback, typed-array builds) runs as an async job that
// yields every ~8 ms (idle callbacks, or an immediate task when the visible section is waiting).
// stats.worstStep records the longest synchronous stretch.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const FOV = 35;
const TAN = Math.tan((FOV * DEG) / 2);
const CAM_DIST = 3.2;                 // camera orbit radius; the object sits near the pivot
const D_NEAR = 0.5 * CAM_DIST;        // far-layer depth 1 (white) -> this distance from the camera
const D_FAR = 2.4 * CAM_DIST;         // far-layer depth 0 (sky)
const MARGIN_Y = 0.5;               // landscape overscan (fraction of half height), for parallax + scroll roll
const SKY_D = 0.035;                  // depth below this is sky (DAv2 maps: sky is ~0, far hills 0.05+)
const SKY_KEEP = 0;                   // sky pixels dropped: the flat gradient behind the canvas is the sky
const ROLL_MAX = 30 * DEG;            // section tilt when it is a full viewport away from centre
const ROLL_EXIT = 8 * DEG;            // smaller tilt on the way out (top away from the viewer)
const BAKE_YAWS = [0, 55 * DEG, -55 * DEG];
const MORPH_DUR = 1.3;
const DISPERSE_DUR = 0.9;
const STAGGER = 0.45;
const REPEL_PX = 28;
const MOUSE_R = 130;      // cursor disturbance radius, CSS px
const MOUSE_REST = 7;     // push under a resting cursor: a dent, not a hole
const MOUSE_MAX = 56;     // push at full swipe speed
const MOUSE_FAST = 2200;  // cursor speed (CSS px/s) that reaches MOUSE_MAX
const SLICE_MS = 8;
const MANIFEST_URL = 'assets/photos/manifest.json';

// point budgets per GPU tier (object / far landscape / near landscape)
const TIERS = {
  high: { obj: 22000, far: 70000, near: 18000, bakeW: 480, glow: true },   // 110k, discrete GPUs
  mid: { obj: 14000, far: 40000, near: 10000, bakeW: 380, glow: false },   //  64k, integrated
  low: { obj: 9000, far: 24000, near: 7000, bakeW: 280, glow: false },     //  40k, mobile/software
};

/* ------------------------------------------------------------------ */
/* shaders                                                            */
/* ------------------------------------------------------------------ */

const DEPTH_VERT = /* glsl */ `
#include <common>
varying float vViewZ;
void main() {
  #include <begin_vertex>
  #include <project_vertex>
  vViewZ = -mvPosition.z;
}`;

// linear view depth packed into 24 bits of RGB
const DEPTH_FRAG = /* glsl */ `
uniform float uNear;
uniform float uFar;
varying float vViewZ;
void main() {
  float d = clamp((vViewZ - uNear) / (uFar - uNear), 0.0, 0.99999);
  vec3 enc = fract(d * vec3(1.0, 255.0, 65025.0));
  enc -= enc.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);
  gl_FragColor = vec4(enc, 1.0);
}`;

const POINT_VERT = /* glsl */ `
uniform float uTime;
uniform float uMorph;
uniform float uStagger;
uniform float uArc;
uniform float uFade;      // 1 = reduced-motion cross-fade instead of flight
uniform float uShimmer;   // 0 under reduced motion
uniform float uPx;        // base point size, device px
uniform float uSizeMul;
uniform vec2 uViewport;   // CSS px
uniform vec4 uRect0;      // repel rects: centre xy, half size zw (CSS px); z <= 0 = off
uniform vec4 uRect1;
uniform float uRepel;     // max push in CSS px
uniform vec4 uMouse;      // cursor xy (CSS px), push in CSS px, radius in CSS px
uniform float uOccA;      // place.solid occluders: object points are indices [0, n) of the morph source...
uniform float uOccB;      // ...and of the morph target
uniform float uOccSize;   // depth-splat size multiplier (OCC_PASS only)
attribute vec3 aPosB;
attribute vec4 aColA;
attribute vec4 aColB;
attribute vec4 aRnd;      // xyz random unit dir, w seed
attribute float aDelay;
varying vec4 vCol;

float easeIO(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5; }

vec2 repel(vec2 sp, vec4 r, inout float inside) {
  if (r.z <= 0.0) return vec2(0.0);
  vec2 d = sp - r.xy;
  vec2 q = abs(d) - r.zw;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float f = 1.0 - smoothstep(0.0, 90.0, sd);
  inside = max(inside, 1.0 - smoothstep(-30.0, 10.0, sd));
  vec2 dir = normalize(d * vec2(r.w, r.z) + vec2(1e-3, 0.0));
  return dir * f * smoothstep(0.15, 0.95, length(d / r.zw));
}

void main() {
  float t = clamp((uMorph - aDelay * uStagger) / (1.0 - uStagger), 0.0, 1.0);
  float e = easeIO(t);
  vec3 p;
  vec4 c;
  if (uFade > 0.5) {
    float second = step(0.5, uMorph);
    p = mix(position, aPosB, second);
    c = mix(aColA, aColB, second);
    c.a *= abs(uMorph * 2.0 - 1.0);
  } else {
    p = mix(position, aPosB, e) + aRnd.xyz * (sin(3.14159265 * e) * uArc);
    c = mix(aColA, aColB, e);
  }

  float seed = aRnd.w;
  float sh = 1.0 + uShimmer * (0.08 * sin(uTime * (1.2 + 2.4 * seed) + seed * 61.0)
    + 0.5 * pow(max(0.0, sin(uTime * (0.3 + 0.5 * fract(seed * 7.31)) + seed * 97.0)), 24.0));

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec4 clip = projectionMatrix * mv;

  vec2 ndc = clip.xy / clip.w;
  vec2 sp = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5) * uViewport;
  float inside = 0.0;
  vec2 push = (repel(sp, uRect0, inside) + repel(sp, uRect1, inside)) * uRepel;
  // cursor disturbance: radial push plus a quarter swirl; per-point jitter keeps it from reading as a lens
  vec2 dm = sp - uMouse.xy;
  float dl = length(dm);
  // zero at the very centre too, so the cursor thins the cloud instead of punching a clean hole
  float fm = smoothstep(0.0, 0.4 * uMouse.w, dl) * (1.0 - smoothstep(0.2 * uMouse.w, uMouse.w, dl));
  fm *= step(0.01, uMouse.z);
  vec2 md = dm / max(dl, 1.0);
  push += (md + vec2(-md.y, md.x) * 0.3) * fm * uMouse.z * (0.6 + 0.8 * fract(seed * 5.13));
  clip.xy += push * vec2(2.0 / uViewport.x, -2.0 / uViewport.y) * clip.w;

#ifdef OCC_PASS
  // depth-only splat of a solid object's points, a touch deeper than the points themselves: land dots behind
  // the object fail the depth test every frame, so nothing shows through and no baked hole ever slides into view
  float lim = mix(uOccA, uOccB, uFade > 0.5 ? step(0.5, uMorph) : step(0.5, e));
  if (float(gl_VertexID) >= lim || c.a < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec4 mvb = mv;
  mvb.z -= 0.06;
  vec4 cb = projectionMatrix * mvb;
  clip.z = cb.z / cb.w * clip.w;
  gl_PointSize = max(uPx * uOccSize, 1.0);
  gl_Position = clip;
  return;
#endif

  vCol = vec4(c.rgb * sh * (1.0 + 0.25 * fm * min(uMouse.z / 30.0, 1.0)), c.a * (1.0 - 0.3 * inside));
  // varied dot sizes give the painterly, scattered look (no grid)
  gl_PointSize = max(uPx * uSizeMul * (0.55 + 0.9 * fract(seed * 13.7)), 1.0);
  gl_Position = vCol.a < 0.003 ? vec4(2.0, 2.0, 2.0, 1.0) : clip;
}`;

// soft round dot
const POINT_FRAG = /* glsl */ `
varying vec4 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0 || vCol.a < 0.01) discard;
  gl_FragColor = vec4(vCol.rgb, vCol.a * (1.0 - d * d));
}`;

// soft additive halo, only on bright points (lights, sunlit faces, the sky glow)
const GLOW_FRAG = /* glsl */ `
uniform float uGlow;
varying vec4 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float lum = max(vCol.r, max(vCol.g, vCol.b));
  float a = exp(-dot(c, c) * 3.0) * vCol.a * uGlow * smoothstep(0.5, 0.95, lum);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol.rgb, a);
}`;

// lifts landscape mid-tones: a dotted image covers under half the screen, so it needs the extra light
const LIFT = new Float32Array(256).map((_, v) => 255 * (1 - Math.pow(1 - v / 255, 1.45)));
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const marginX = (asp) => clamp((0.16 * 1.6) / asp, 0.16, 0.6); // portrait screens get more side overscan

function pickTier(renderer) {
  const q = new URLSearchParams(location.search).get('particles');
  if (q && TIERS[q]) return q;
  let name = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
  } catch (e) { /* ignore */ }
  const w = innerWidth, h = innerHeight;
  const narrow = w < 760 || Math.min(w, h) < 520;
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'low';
  if (narrow || coarse || renderer.capabilities.maxTextureSize < 8192 || /mali|adreno|powervr|apple gpu/i.test(name)) return 'low';
  if (/intel|uhd|iris|radeon\(tm\) graphics|vega \d+ graphics/i.test(name) || (navigator.hardwareConcurrency || 8) <= 4) return 'mid';
  return 'high';
}

/* ------------------------------------------------------------------ */
/* engine                                                             */
/* ------------------------------------------------------------------ */

export function createEngine(canvas, SCENES) {
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = mqReduce.matches;
  const touch = matchMedia('(hover: none)').matches || matchMedia('(pointer: coarse)').matches;

  if (getComputedStyle(canvas).position === 'static') {
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '-1', pointerEvents: 'none' });
  }

  // throws if WebGL is unavailable; main.js catches
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);

  const tierName = pickTier(renderer);
  const T = TIERS[tierName];
  const CAP = T.obj + T.far + T.near;
  const OBJ_ONLY = Math.min(CAP, Math.round(T.obj * 1.5)); // object budget when no landscape exists
  const BAKE_W = T.bakeW;
  const BAKE_H = Math.round((BAKE_W * 9) / 16);

  const stats = { tier: tierName, cap: CAP, worstStep: 0, steps: 0, clouds: {}, manifest: 'pending' };

  /* ---------- display scene ---------- */
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 100);
  const scene = new THREE.Scene();
  const spin = new THREE.Group(); // idle + scroll rotation around up, pivot at the object plane
  scene.add(spin);

  const geo = new THREE.BufferGeometry();
  const attr = (name, size, Arr = Float32Array, norm = false) => {
    const a = new THREE.BufferAttribute(new Arr(CAP * size), size, norm);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
    return a;
  };
  const aPosA = attr('position', 3);
  const aPosB = attr('aPosB', 3);
  const aColA = attr('aColA', 4, Uint8Array, true);
  const aColB = attr('aColB', 4, Uint8Array, true);
  const aDelay = attr('aDelay', 1, Uint8Array, true);
  const aRnd = attr('aRnd', 4);
  for (let i = 0; i < CAP; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const i4 = i * 4;
    aRnd.array[i4] = r * Math.cos(th); aRnd.array[i4 + 1] = u; aRnd.array[i4 + 2] = r * Math.sin(th); aRnd.array[i4 + 3] = Math.random();
  }
  aRnd.setUsage(THREE.StaticDrawUsage);
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e3);

  const U = {
    uTime: { value: 0 },
    uMorph: { value: 1 },
    uStagger: { value: STAGGER },
    uArc: { value: 0 },
    uFade: { value: reduced ? 1 : 0 },
    uShimmer: { value: reduced ? 0 : 1 },
    uPx: { value: 3 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uRect0: { value: new THREE.Vector4() },
    uRect1: { value: new THREE.Vector4() },
    uRepel: { value: REPEL_PX },
    uMouse: { value: new THREE.Vector4(0, 0, 0, MOUSE_R) },
    uOccA: { value: 0 },
    uOccB: { value: 0 },
  };
  const mainMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uSizeMul: { value: 1 } },
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: true,
    depthTest: true,
  });
  const points = new THREE.Points(geo, mainMat);
  points.frustumCulled = false;
  points.renderOrder = 1;
  spin.add(points);
  // opaque, colour-less, drawn before the transparent dots: writes only the solid object's depth splats
  const occPoints = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { ...U, uSizeMul: { value: 1 }, uOccSize: { value: 1.7 } },
    defines: { OCC_PASS: '' },
    vertexShader: POINT_VERT,
    fragmentShader: 'void main() { vec2 c = gl_PointCoord * 2.0 - 1.0; if (dot(c, c) > 1.0) discard; gl_FragColor = vec4(0.0); }',
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
  }));
  occPoints.frustumCulled = false;
  occPoints.renderOrder = 0;
  spin.add(occPoints);

  if (T.glow) {
    const glowMat = new THREE.ShaderMaterial({
      uniforms: { ...U, uSizeMul: { value: 2.2 }, uGlow: { value: 0.11 } },
      vertexShader: POINT_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Points(geo, glowMat);
    glow.frustumCulled = false;
    glow.renderOrder = 2;
    spin.add(glow);
  }

  /* ---------- job timing ---------- */
  let stepT0 = performance.now();
  let stepTag = '';
  const tag = (t) => { stepTag = t; };
  const ric = window.requestIdleCallback ? (fn) => requestIdleCallback(() => fn(), { timeout: 700 }) : (fn) => setTimeout(fn, 30);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const urgent = () => wanted && !clouds.has(wanted);
  function endStep() {
    const d = performance.now() - stepT0;
    if (d > stats.worstStep) { stats.worstStep = d; stats.worstTag = stepTag; }
    stats.steps++;
  }
  async function wait(p) {
    endStep();
    try { return await p; } finally { stepT0 = performance.now(); }
  }
  async function yieldNow() {
    endStep();
    await new Promise((r) => (urgent() ? setTimeout(r, 0) : ric(r)));
    while (document.hidden) await sleep(400);
    stepT0 = performance.now();
  }
  const over = () => performance.now() - stepT0 > SLICE_MS;
  const checkpoint = () => (over() ? yieldNow() : null);

  /* ---------- manifest + images ---------- */
  let manifestP = null;
  const manifest = () => (manifestP ||= fetch(MANIFEST_URL)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { const ok = j && Array.isArray(j.photos); stats.manifest = ok ? 'ok' : 'missing'; return ok ? j : null; })
    .catch(() => { stats.manifest = 'missing'; return null; }));

  // Without a manifest, fall back to the D9 path convention; w/h are then read from the image.
  const convention = new Map();
  function pickLand(man, id, layer, avoid) {
    if (!id) return null;
    if (!man) {
      if (!convention.has(id)) convention.set(id, { id, layer, kind: 'landscape', file: `assets/photos/${id}.jpg`, depth: `assets/depth/${id}.png`, w: 0, h: 0 });
      return convention.get(id);
    }
    const L = man.photos.filter((p) => p && p.kind === 'landscape' && p.depth && p.file);
    return L.find((p) => p.id === id) || L.find((p) => p.layer === layer && p.id !== avoid) || null;
  }

  async function ensureSize(entry) {
    if (entry.w > 0 && entry.h > 0) return;
    const bmp = await wait(createImageBitmap(await wait(getBlob(entry.file))));
    entry.w = bmp.width; entry.h = bmp.height;
    if (bmp.close) bmp.close();
  }

  const blobs = new Map();
  const getBlob = (url) => {
    if (!blobs.has(url)) {
      blobs.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.blob(); }));
    }
    return blobs.get(url);
  };

  // decode with the browser's off-thread resize, then read pixels through a small 2D canvas
  async function decode(url, w, h, raw) {
    const blob = await wait(getBlob(url));
    const o = { resizeWidth: w, resizeHeight: h, resizeQuality: raw ? 'medium' : 'high', premultiplyAlpha: 'none' };
    if (raw) o.colorSpaceConversion = 'none';
    let bmp;
    try { bmp = await wait(createImageBitmap(blob, o)); } catch (e) { bmp = await wait(createImageBitmap(blob)); }
    tag('decode:' + url);
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const data = ctx.getImageData(0, 0, w, h).data;
    await checkpoint();
    return data;
  }

  // Layout of a photo on screen: cover-fit to the overscanned viewport. Units: half viewport height.
  function fit(entry, asp) {
    const ai = (entry.w && entry.h) ? entry.w / entry.h : 1.6;
    const Ey = 1 + MARGIN_Y, Ex = (1 + marginX(asp)) * asp;
    const h0 = Math.max(Ey, Ex / ai);
    return { ai, h0, Ex, Ey, fx: Math.min(1, Ex / (ai * h0)), fy: Math.min(1, Ey / h0) };
  }

  async function loadLayer(entry, budget, asp, rowShare, keepShare) {
    const f = fit(entry, asp);
    const need = (1.2 * budget) / Math.max(0.05, f.fx * f.fy * rowShare * keepShare);
    const gw = Math.round(clamp(Math.sqrt(need * f.ai), 64, Math.min(1600, entry.w || 1600)));
    const gh = Math.max(32, Math.round(gw / f.ai));
    const rgb = await decode(entry.file, gw, gh, false);
    const dep = await decode(entry.depth, gw, gh, true);
    return { ...f, gw, gh, rgb, dep, id: entry.id };
  }

  // light + fog from the far photo: sky centroid of brightness = sun side
  function envFrom(L) {
    const { gw, gh, rgb, dep } = L;
    let n = 0, sr = 0, sg = 0, sb = 0, wsum = 0, wx = 0, wr = 0, wg = 0, wb = 0, gn = 0, gr = 0, gg = 0, gb = 0;
    const topRows = Math.round(gh * 0.12);
    for (let y = 0; y < gh; y += 2) {
      for (let x = 0; x < gw; x += 2) {
        const i = (y * gw + x) * 4;
        const d = dep[i] / 255;
        const r = rgb[i] / 255, g = rgb[i + 1] / 255, b = rgb[i + 2] / 255;
        if (d < SKY_D || (y < topRows && d < 0.1)) {
          const lum = 0.3 * r + 0.59 * g + 0.11 * b;
          n++; sr += r; sg += g; sb += b;
          const w = lum * lum * lum * lum;
          wsum += w; wx += w * (x / gw); wr += w * r; wg += w * g; wb += w * b;
        } else if (d > 0.7) { gn++; gr += r; gg += g; gb += b; }
      }
    }
    const fog = n ? [sr / n, sg / n, sb / n] : [0.62, 0.68, 0.76];
    let sunSide = -0.6, sun = [1, 0.92, 0.82];
    if (wsum > 0) {
      sunSide = clamp((wx / wsum - 0.5) * 3, -1, 1);
      const m = Math.max(wr, wg, wb) / wsum || 1;
      sun = [wr / wsum / m, wg / wsum / m, wb / wsum / m].map((c) => 0.35 + 0.65 * c);
    }
    const ground = gn ? [gr / gn, gg / gn, gb / gn].map((c) => c * 0.6) : [0.23, 0.19, 0.16];
    const col = (a) => new THREE.Color().setRGB(a[0], a[1], a[2], THREE.SRGBColorSpace);
    return { fog, env: { bare: true, sunSide, sunColor: col(sun), skyColor: col(fog), groundColor: col(ground) } };
  }

  /* ---------- object bake ---------- */
  const rtColor = new THREE.WebGLRenderTarget(BAKE_W, BAKE_H, { colorSpace: THREE.SRGBColorSpace });
  const rtDepth = new THREE.WebGLRenderTarget(BAKE_W, BAKE_H);
  const bufC = new Uint8Array(BAKE_W * BAKE_H * 4);
  const bufD = new Uint8Array(BAKE_W * BAKE_H * 4);
  const depthMat = new THREE.ShaderMaterial({
    uniforms: { uNear: { value: 0.1 }, uFar: { value: 100 } },
    vertexShader: DEPTH_VERT,
    fragmentShader: DEPTH_FRAG,
    side: THREE.DoubleSide,
  });

  function disposeScene(root) {
    root.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
    });
    // geometries and materials are cached/shared inside scenes.js, keep them for the next build
  }

  // Object cloud in a camera-aligned frame (2 units tall at the pivot), with the source camera's
  // pitch applied, so "up" on screen stays up. Returns the full shuffled set; compose() caps it.
  async function bakeObject(id, env) {
    tag(id + ':build');
    const built = SCENES[id].build(0, env);
    const src = built.scene, cam = built.camera;
    const size = built.size || 1;
    src.background = null;
    cam.updateMatrixWorld(true);
    if (cam.parent) { cam.matrixWorld.decompose(cam.position, cam.quaternion, cam.scale); cam.removeFromParent(); }
    cam.aspect = BAKE_W / BAKE_H;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    src.updateMatrixWorld(true);
    tag(id + ':compile');
    if (renderer.compileAsync) {
      // compile for the bake target (its colour space is part of the program key)
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rtColor);
      const p = renderer.compileAsync(src, cam);
      renderer.setRenderTarget(prev);
      await wait(p);
    } else await checkpoint();

    const camPos = cam.position.clone();
    const camQuat = cam.quaternion.clone();
    const f = cam.getWorldDirection(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(src);
    const center = box.isEmpty() ? camPos.clone().addScaledVector(f, size * 3) : box.getCenter(new THREE.Vector3());
    let dist = center.clone().sub(camPos).dot(f);
    if (!(dist > cam.near * 2)) dist = size * 3;
    const pivot = camPos.clone().addScaledVector(f, dist);
    const tanH = Math.tan((cam.getEffectiveFOV() * DEG) / 2);
    const s = 1 / (dist * tanH);
    const fh = new THREE.Vector3(f.x, 0, f.z);
    if (fh.lengthSq() < 1e-6) fh.set(0, 0, -1);
    fh.normalize();
    const qAlign = new THREE.Quaternion().setFromUnitVectors(fh, new THREE.Vector3(0, 0, -1));
    const pitch = Math.asin(clamp(f.y, -1, 1));
    const toCloud = new THREE.Matrix4().makeRotationX(-pitch)
      .multiply(new THREE.Matrix4().makeScale(s, s, s))
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(qAlign))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));

    const near = cam.near, far = cam.far;
    depthMat.uniforms.uNear.value = near;
    depthMat.uniforms.uFar.value = far;
    const aspect = cam.aspect;
    const cell = 2 / BAKE_H;
    const vox = cell * 0.9;
    const maxPts = BAKE_W * BAKE_H * 2;
    const pos = new Float32Array(maxPts * 3), col = new Uint8Array(maxPts * 4);
    let n = 0;
    const voxels = new Set();
    const M = new THREE.Matrix4();
    const qYaw = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);

    for (let v = 0; v < BAKE_YAWS.length; v++) {
      await checkpoint();
      qYaw.setFromAxisAngle(up, BAKE_YAWS[v]);
      cam.position.copy(camPos).sub(pivot).applyQuaternion(qYaw).add(pivot);
      cam.quaternion.copy(qYaw).multiply(camQuat);
      cam.updateMatrixWorld(true);

      await yieldNow();
      tag(id + ':render' + v);
      const prevTarget = renderer.getRenderTarget();
      src.overrideMaterial = null;
      renderer.setRenderTarget(rtColor);
      renderer.clear();
      renderer.render(src, cam);
      src.overrideMaterial = depthMat;
      renderer.setRenderTarget(rtDepth);
      renderer.clear();
      renderer.render(src, cam);
      src.overrideMaterial = null;
      renderer.setRenderTarget(prevTarget);
      // read back in a later task, once the GPU has finished, so the sync readback doesn't stall
      await yieldNow();
      tag(id + ':read' + v);
      renderer.readRenderTargetPixels(rtColor, 0, 0, BAKE_W, BAKE_H, bufC);
      renderer.readRenderTargetPixels(rtDepth, 0, 0, BAKE_W, BAKE_H, bufD);

      M.multiplyMatrices(toCloud, cam.matrixWorld);
      const e = M.elements;
      const keepAll = v === 0;
      for (let py = 0; py < BAKE_H; py++) {
        if ((py & 7) === 0) { await checkpoint(); tag(id + ':pixels'); }
        const ny = ((py + 0.5) / BAKE_H) * 2 - 1;
        for (let px = 0; px < BAKE_W; px++) {
          const i = (py * BAKE_W + px) * 4;
          const a = bufC[i + 3];
          if (a < 40 || bufD[i + 3] < 255 || n >= maxPts) continue;
          const d = bufD[i] / 255 + bufD[i + 1] / 65025 + bufD[i + 2] / 16581375;
          const vz = near + d * (far - near);
          const nx = ((px + 0.5) / BAKE_W) * 2 - 1;
          const xv = nx * vz * tanH * aspect, yv = ny * vz * tanH, zv = -vz;
          const x = e[0] * xv + e[4] * yv + e[8] * zv + e[12];
          const y = e[1] * xv + e[5] * yv + e[9] * zv + e[13];
          const z = e[2] * xv + e[6] * yv + e[10] * zv + e[14];
          const key = (Math.floor(x / vox) + 4096) * 67108864 + (Math.floor(y / vox) + 4096) * 8192 + (Math.floor(z / vox) + 4096);
          if (!keepAll && voxels.has(key)) continue;
          voxels.add(key);
          const af = a / 255;
          pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
          col[n * 4] = Math.min(255, bufC[i] / af);
          col[n * 4 + 1] = Math.min(255, bufC[i + 1] / af);
          col[n * 4 + 2] = Math.min(255, bufC[i + 2] / af);
          col[n * 4 + 3] = Math.min(255, a * 1.1);
          n++;
        }
      }
    }
    disposeScene(src);
    await checkpoint();
    tag(id + ':shuffle');

    // shuffle (cheap uniform subsampling + random morph pairing), keep at most the object-only budget
    const keep = Math.min(n, OBJ_ONLY);
    const P = new Float32Array(keep * 3), C = new Uint8Array(keep * 4);
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    for (let k = 0; k < keep; k++) {
      const o = order[k];
      const x = (P[k * 3] = pos[o * 3]), y = (P[k * 3 + 1] = pos[o * 3 + 1]), z = (P[k * 3 + 2] = pos[o * 3 + 2]);
      C[k * 4] = col[o * 4]; C[k * 4 + 1] = col[o * 4 + 1]; C[k * 4 + 2] = col[o * 4 + 2]; C[k * 4 + 3] = col[o * 4 + 3];
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      if (z < b.z0) b.z0 = z; if (z > b.z1) b.z1 = z;
    }
    return { pos: P, col: C, n: keep, box: b };
  }

  /* ---------- composition ---------- */
  const objects = new Map(); // id -> baked object (aspect independent)
  const layers = new Map();  // key -> decoded layer

  async function layer(entry, budget, asp, rowShare, keepShare) {
    await ensureSize(entry);
    const f = fit(entry, asp);
    const key = `${entry.id}|${budget}|${f.fx.toFixed(2)}|${f.fy.toFixed(2)}`;
    if (!layers.has(key)) layers.set(key, await loadLayer(entry, budget, asp, rowShare, keepShare));
    return { ...layers.get(key), ...f };
  }

  async function compose(id, asp) {
    const t0 = performance.now();
    const def = SCENES[id];
    const land = def.land || null;
    const man = await wait(manifest());
    const farE = land ? pickLand(man, land.far, 'far') : null;
    const nearE = land && farE ? pickLand(man, land.near, 'near', farE.id) : null;

    let far = null, near = null;
    if (farE) {
      try { far = await layer(farE, T.far + (nearE ? 0 : T.near), asp, 1, 0.8); } catch (e) { console.warn('[engine] far layer failed:', e); }
    }
    if (far && nearE) {
      try { near = await layer(nearE, T.near, asp, 0.3, 0.85); } catch (e) { console.warn('[engine] near layer failed:', e); }
    }
    tag(id + ':env');
    const lit = far ? envFrom(far) : null;
    const fog = lit ? lit.fog : [0.6, 0.66, 0.74];

    if (!objects.has(id)) objects.set(id, await bakeObject(id, lit ? lit.env : null));
    const obj = objects.get(id);

    // placement (D2): normalized anchor at 16:9; portrait centres and shrinks the object
    const pl = def.place || { x: 0.5, base: 0.8, h: 0.5 };
    const portrait = asp < 1;
    // optional per-scene overrides { x, base, h, w? } (place.portrait / place.desktop), final screen fractions;
    // w caps the width (default 0.92); above 1 the object runs off the frame edges
    const pp = portrait ? pl.portrait : pl.desktop;
    const ax = pp ? pp.x : portrait ? 0.5 : pl.x;
    // foreground: the object stands low in the frame on the near ground, which overlaps its base
    const hFrac = pp ? pp.h : portrait ? Math.min(0.3, pl.h * 0.8) : Math.min(0.7, pl.h * 1.2);
    const base = pp ? pp.base : portrait ? 0.7 : Math.min(0.94, pl.base + 0.1);
    let objH = hFrac; // actual on-screen height fraction, set once the object is fitted
    const axh = (2 * ax - 1) * asp, byh = 1 - 2 * base;
    let Dobj = CAM_DIST;
    if (far) {
      // depth of the landscape ground under the anchor
      const u = (((2 * clamp(ax, 0.05, 0.95) - 1) * asp) / (far.ai * far.h0) + 1) / 2, // an anchor off-frame (w > 1) samples the visible ground
        v = (1 - byh / far.h0) / 2;
      const cx = Math.round(u * far.gw), cy = Math.round(v * far.gh);
      let s = 0, c = 0;
      for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
        if (x < 0 || y < 0 || x >= far.gw || y >= far.gh) continue;
        s += far.dep[(y * far.gw + x) * 4]; c++;
      }
      const d = c ? s / c / 255 : 0.5;
      Dobj = clamp(1 / (1 / D_FAR + (1 / D_NEAR - 1 / D_FAR) * d), 0.75 * CAM_DIST, 1.5 * CAM_DIST);
      // the back sits at the anchor's ground depth, so a deep object's front hangs nearer than the
      // ground on its own screen rows; push scales the whole object back (screen size unchanged)
      Dobj *= pl.push || 1;
    }

    // a solid object without a near layer takes the near budget (denser dots); otherwise the far layer does
    const spare = far && !near ? T.near : 0, objSpare = pl.solid ? spare : 0;
    const nObj = Math.min(obj.n, far ? T.obj + objSpare : OBJ_ONLY);
    const total = nObj + (far ? T.far + T.near : 0);
    const pos = new Float32Array(total * 3), col = new Uint8Array(total * 4), del = new Uint8Array(total);
    let n = 0;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const fogAt = (D) => 0.3 * smooth(0.9 * CAM_DIST, D_FAR, D);

    tag(id + ':placeObj');
    // object
    {
      const b = obj.box;
      // back at the ground depth; size and anchor are taken at the object's middle depth
      const fitAt = (D) => Math.min((hFrac * 2 * TAN * D) / Math.max(1e-3, b.y1 - b.y0), (((pp && pp.w) || 0.92) * 2 * TAN * asp * D) / Math.max(1e-3, b.x1 - b.x0));
      let sc = fitAt(Dobj);
      const Dc = Math.max(0.35 * CAM_DIST, Dobj - 0.5 * (b.z1 - b.z0) * sc);
      sc = fitAt(Dc);
      objH = ((b.y1 - b.y0) * sc) / (2 * TAN * Dc);
      const X = axh * TAN * Dc, Yb = byh * TAN * Dc, Z = CAM_DIST - Dobj;
      // the object's back sits at the ground depth under the anchor, so it is never behind the land
      const xm = (b.x0 + b.x1) / 2, zm = b.z0;
      const fa = far ? 0.08 + fogAt(Dobj) * 0.7 : 0;
      const jit = (2 / BAKE_H) * sc; // one bake cell: breaks up the render's pixel lattice
      // `base` anchors the object's lowest local y, but perspective puts its near corner lower on screen
      // (past the bottom edge at low bases); lift it so its true lowest screen point sits on `base`
      let maxYs = -Infinity;
      for (let k = 0; k < nObj; k++) {
        const y = (obj.pos[k * 3 + 1] - b.y0) * sc + Yb, z = (obj.pos[k * 3 + 2] - zm) * sc + Z;
        const ys = 0.5 - y / (2 * TAN * Math.max(0.1, CAM_DIST - z));
        if (ys > maxYs) maxYs = ys;
      }
      const lift = Math.max(0, maxYs - base) * 2 * TAN * Dc;
      for (let k = 0; k < nObj; k++) {
        if ((k & 4095) === 0) await checkpoint();
        const x = (obj.pos[k * 3] - xm) * sc + X + (rnd() - 0.5) * jit;
        const y = (obj.pos[k * 3 + 1] - b.y0) * sc + Yb + lift + (rnd() - 0.5) * jit;
        const z = (obj.pos[k * 3 + 2] - zm) * sc + Z;
        pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
        for (let c = 0; c < 3; c++) col[n * 4 + c] = obj.col[k * 4 + c] * (1 - fa) + fog[c] * 255 * fa;
        col[n * 4 + 3] = obj.col[k * 4 + 3];
        const ys = 0.5 - y / (2 * TAN * Math.max(0.1, CAM_DIST - z));
        del[n] = 255 * (0.55 * (1 - clamp(ys, 0, 1)) + 0.45 * rnd());
        n++;
      }
    }
    await checkpoint();

    // landscape sheet: each grid sample sits on its camera ray at its depth distance
    async function sheet(L, isNear, budget) {
      const { gw, gh, rgb, dep, ai, h0, Ex, Ey } = L;
      const asp0 = asp, mx = marginX(asp0);
      // pass 1: count candidates, so the budget is met by a uniform keep rate (no cut-off rows)
      let cand = 0;
      for (let gy = 0; gy < gh; gy++) {
        const yh = (1 - (2 * (gy + 0.5)) / gh) * h0;
        if (yh > Ey || yh < -Ey) continue;
        const ys = (1 - yh) / 2;
        if (isNear && ys < nearTop) continue;
        for (let gx = 0; gx < gw; gx++) {
          const xh = ((2 * (gx + 0.5)) / gw - 1) * ai * h0;
          if (xh > Ex || xh < -Ex) continue;
          const d = dep[(gy * gw + gx) * 4] / 255;
          if (isNear) { if (d > 0.42) cand++; } else cand += d < SKY_D ? SKY_KEEP : 1;
        }
        if ((gy & 31) === 0) await checkpoint();
      }
      tag(id + ':sheet');
      const keep = Math.min(1, budget / Math.max(1, cand));
      const cellX = (2 * ai * h0) / gw, cellY = (2 * h0) / gh;
      const nearThin = !isNear && near;
      const bright = isNear ? 0.92 : 0.95;
      const end = n + budget;
      for (let gy = 0; gy < gh; gy++) {
        if ((gy & 7) === 0) await checkpoint();
        const yh = (1 - (2 * (gy + 0.5)) / gh) * h0;
        if (yh > Ey || yh < -Ey) continue;
        const ys = (1 - yh) / 2;
        if (isNear && ys < nearTop) continue;
        const fadeY = 1 - smooth(1 + MARGIN_Y * 0.3, 1 + MARGIN_Y, Math.abs(yh));
        for (let gx = 0; gx < gw; gx++) {
          if (n >= end) return;
          const xh = ((2 * (gx + 0.5)) / gw - 1) * ai * h0;
          if (xh > Ex || xh < -Ex) continue;
          const i = (gy * gw + gx) * 4;
          const d = dep[i] / 255;
          let a = fadeY * (1 - smooth(1 + mx * 0.35, 1 + mx, Math.abs(xh) / asp0));
          let D, sky = 0;
          if (isNear) {
            if (d <= 0.42) continue;
            a *= smooth(0.42, 0.55, d) * smooth(nearTop, nearTop + 0.1, ys);
            D = CAM_DIST * (0.95 - 0.53 * clamp((d - 0.42) / 0.58, 0, 1));
          } else {
            sky = 1 - smooth(SKY_D * 0.4, SKY_D, d);
            if (rnd() > keep * (1 - sky * (1 - SKY_KEEP))) continue;
            if (nearThin && ys > nearTop + 0.08 && rnd() < 0.35) continue;
            D = 1 / (1 / D_FAR + (1 / D_NEAR - 1 / D_FAR) * d);
            if (sky > 0) D *= 1 + 0.25 * sky * rnd();
            a *= 1 - 0.4 * sky;
          }
          if (isNear && rnd() > keep) continue;
          if (a < 0.02) continue;
          const fa = Math.min(0.85, fogAt(D) + 0.45 * sky);
          // jitter within the sample's cell: scattered dots, not a visible pixel lattice
          const jx = xh + (rnd() - 0.5) * cellX, jy = yh + (rnd() - 0.5) * cellY;
          pos[n * 3] = jx * TAN * D; pos[n * 3 + 1] = jy * TAN * D; pos[n * 3 + 2] = CAM_DIST - D;
          // copy sits on the left in every 3D section: dim the land there so text stays legible
          const xs = (xh / asp0 + 1) / 2;
          const lb = bright * (0.5 + 0.5 * smooth(0.04, 0.52, xs));
          for (let c = 0; c < 3; c++) col[n * 4 + c] = (LIFT[rgb[i + c]] * (1 - fa) + fog[c] * 255 * fa) * lb;
          col[n * 4 + 3] = 255 * a;
          del[n] = 255 * (0.55 * (1 - clamp(ys, 0, 1)) + 0.45 * rnd());
          n++;
        }
      }
    }
    // grass overlaps the object's base so it stands in the land; scaled to the object's real height, since wide
    // objects shrink on narrow screens and a fixed 6% overlap then buries them
    const nearTop = base - Math.min(0.06, 0.15 * objH);
    let nFar = 0, nNear = 0;
    if (far) { const s = n; await sheet(far, false, T.far + spare - objSpare); nFar = n - s; }
    if (near) { const s = n; await sheet(near, true, T.near); nNear = n - s; }

    stats.clouds[id] = { obj: nObj, far: nFar, near: nNear, total: n, farId: far && far.id, nearId: near && near.id, sunSide: lit ? +lit.env.sunSide.toFixed(2) : null, ms: Math.round(performance.now() - t0) };
    // flat dark gradient in the landscape's own sky tone stands in for the sky
    const tone = (k) => fog.map((c) => Math.round(c * 255 * k)).join(',');
    const bg = `linear-gradient(180deg, rgb(${tone(0.36)}) 0%, rgb(${tone(0.16)}) 55%, rgb(${tone(0.07)}) 100%)`;
    // object points come first in the cloud, so the depth-splat pass can find them by index
    return { id, n, pos, col, del, bg, occN: pl.solid ? nObj : 0 };
  }

  /* ---------- bake queue ---------- */
  const clouds = new Map(); // id -> cloud | null (failed), for the current aspect generation
  let queue = [];
  let ready = false, baking = false, gen = 0, bakeAspect = 16 / 9;

  async function bakeLoop() {
    if (baking || !ready) return;
    baking = true;
    stepT0 = performance.now();
    try {
      for (;;) {
        let id = wanted && !clouds.has(wanted) ? wanted : null;
        if (!id) id = queue.find((q) => !clouds.has(q)) || null;
        if (!id) break;
        const g = gen;
        await yieldNow();
        let cloud = null;
        try { cloud = await compose(id, bakeAspect); } catch (err) {
          console.warn(`[engine] bake "${id}" failed:`, err);
          renderer.setRenderTarget(null);
        }
        endStep();
        if (g !== gen) continue; // aspect changed meanwhile: redo
        clouds.set(id, cloud);
        if (wanted === id && shown !== id) { if (cloud) begin(cloud); else begin(null); }
        stepT0 = performance.now();
      }
    } finally { baking = false; }
  }

  /* ---------- morph ---------- */
  let wanted; // undefined until the first show()
  let shown = null;
  let count = 0, finalCount = 0;
  let morph = 1, morphDur = MORPH_DUR;

  function upload() {
    for (const a of [aPosA, aPosB, aColA, aColB, aDelay]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  // bake the current interpolated state into the A buffers
  function snapshot() {
    const A = aPosA.array, B = aPosB.array, CA = aColA.array, CB = aColB.array, R = aRnd.array, D = aDelay.array;
    if (morph >= 1) {
      A.set(B.subarray(0, count * 3));
      CA.set(CB.subarray(0, count * 4));
      return;
    }
    if (morph <= 0) return;
    const fade = U.uFade.value > 0.5, arc = U.uArc.value, stag = U.uStagger.value;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3, i4 = i * 4;
      if (fade) {
        if (morph >= 0.5) {
          A[i3] = B[i3]; A[i3 + 1] = B[i3 + 1]; A[i3 + 2] = B[i3 + 2];
          CA[i4] = CB[i4]; CA[i4 + 1] = CB[i4 + 1]; CA[i4 + 2] = CB[i4 + 2]; CA[i4 + 3] = CB[i4 + 3] * (morph * 2 - 1);
        } else CA[i4 + 3] *= 1 - morph * 2;
        continue;
      }
      const t = clamp((morph - (D[i] / 255) * stag) / (1 - stag), 0, 1);
      const e = easeIO(t), h = Math.sin(Math.PI * e) * arc;
      A[i3] += (B[i3] - A[i3]) * e + R[i4] * h;
      A[i3 + 1] += (B[i3 + 1] - A[i3 + 1]) * e + R[i4 + 1] * h;
      A[i3 + 2] += (B[i3 + 2] - A[i3 + 2]) * e + R[i4 + 2] * h;
      for (let k = 0; k < 4; k++) CA[i4 + k] = CA[i4 + k] + (CB[i4 + k] - CA[i4 + k]) * e + 0.5;
    }
  }

  function begin(cloud) {
    const tb = performance.now();
    beginInner(cloud);
    const d = performance.now() - tb;
    if (d > (stats.worstBegin || 0)) stats.worstBegin = d;
  }

  function beginInner(cloud) {
    const A = aPosA.array, B = aPosB.array, CA = aColA.array, CB = aColB.array, R = aRnd.array, D = aDelay.array;
    snapshot();
    const n0 = count;
    // occluder ranges follow the morph: whatever was showing becomes the source
    U.uOccA.value = n0 === 0 ? 0 : morph >= 0.5 ? U.uOccB.value : U.uOccA.value;
    U.uFade.value = reduced ? 1 : 0;
    U.uStagger.value = reduced ? 0 : STAGGER;

    if (cloud) {
      const n = cloud.n, P = cloud.pos, C = cloud.col, L = cloud.del;
      const cnt = Math.max(n0, n);
      if (n0 === 0) {
        // first appearance: condense out of a dust cloud
        for (let i = 0; i < cnt; i++) {
          const j = i < n ? i : (Math.random() * n) | 0, i4 = i * 4, sp = 0.5 + 1.0 * R[i4 + 3];
          for (let k = 0; k < 3; k++) A[i * 3 + k] = P[j * 3 + k] + R[i4 + k] * sp;
          CA[i4] = C[j * 4]; CA[i4 + 1] = C[j * 4 + 1]; CA[i4 + 2] = C[j * 4 + 2]; CA[i4 + 3] = 0;
        }
      } else {
        for (let i = n0; i < cnt; i++) {
          const j = (Math.random() * n0) | 0; // pad: duplicate existing points
          A[i * 3] = A[j * 3]; A[i * 3 + 1] = A[j * 3 + 1]; A[i * 3 + 2] = A[j * 3 + 2];
          for (let k = 0; k < 4; k++) CA[i * 4 + k] = CA[j * 4 + k];
        }
      }
      // index-aligned pairing: object -> object, landscape rows -> landscape rows
      B.set(P.subarray(0, n * 3));
      CB.set(C.subarray(0, n * 4));
      D.set(L.subarray(0, n));
      for (let i = n; i < cnt; i++) {
        const j = (Math.random() * n) | 0;
        B[i * 3] = P[j * 3]; B[i * 3 + 1] = P[j * 3 + 1]; B[i * 3 + 2] = P[j * 3 + 2];
        for (let k = 0; k < 4; k++) CB[i * 4 + k] = C[j * 4 + k];
        D[i] = L[j];
      }
      count = cnt;
      finalCount = n;
      morphDur = reduced ? 0.45 : MORPH_DUR;
      U.uArc.value = n0 === 0 ? 0 : 0.22;
      shown = cloud.id;
      U.uOccB.value = cloud.occN || 0;
      if (cloud.bg) canvas.style.background = cloud.bg;
    } else {
      if (n0 === 0) { shown = null; return; }
      for (let i = 0; i < n0; i++) {
        const i4 = i * 4, sp = 0.5 + 1.0 * R[i4 + 3];
        for (let k = 0; k < 3; k++) B[i * 3 + k] = A[i * 3 + k] + R[i4 + k] * sp;
        CB[i4] = CA[i4]; CB[i4 + 1] = CA[i4 + 1]; CB[i4 + 2] = CA[i4 + 2]; CB[i4 + 3] = 0;
        D[i] = Math.random() * 255;
      }
      finalCount = 0;
      U.uOccB.value = 0;
      morphDur = reduced ? 0.35 : DISPERSE_DUR;
      U.uArc.value = 0;
      shown = null;
    }
    upload();
    morph = 0;
    geo.setDrawRange(0, count);
    wake();
  }

  function show(id) {
    if (id == null || !SCENES[id]) id = null;
    if (id === wanted) return;
    wanted = id;
    if (id === null) { begin(null); return; }
    if (clouds.has(id)) {
      const c = clouds.get(id);
      begin(c || null);
    } else bakeLoop();
  }

  /* ---------- input / motion ---------- */
  let mx = 0, my = 0, cmx = 0, cmy = 0;
  let idleFor = 0, idleAmp = 0, idlePhase = 0;
  let roll = 0;
  const poke = () => { idleFor = 0; };

  // cursor disturbance: distance travelled between frames becomes speed in frame()
  let mIn = false, mDist = 0, mSpeed = 0, mStr = 0;
  function onPointer(e) {
    poke();
    if (e.pointerType !== 'mouse') return;
    mx = (e.clientX / innerWidth) * 2 - 1;
    my = (e.clientY / innerHeight) * 2 - 1;
    const m = U.uMouse.value;
    if (mIn) mDist += Math.hypot(e.clientX - m.x, e.clientY - m.y);
    m.x = e.clientX; m.y = e.clientY;
    mIn = true;
  }
  const onLeave = (e) => { if (!e.relatedTarget) mIn = false; };

  /* ---------- activation ---------- */
  let active = null, repelEls = [];
  const coverage = new Map();
  function pickSection() {
    let best = null, bestC = 0;
    for (const [el, c] of coverage) if (c > bestC) { bestC = c; best = el; }
    if (!best || bestC < 0.5 || best === active) return;
    active = best;
    repelEls = [...best.querySelectorAll('[data-repel]')].slice(0, 2);
    show(best.dataset.scene || null);
  }

  /* ---------- loop ---------- */
  let raf = 0, last = 0, running = false, lost = false, sizeDirty = true, cleared = false, modal = false;
  let cssW = 1, cssH = 1, yawMax = 0.12, pitchMax = 0.06, aspectTimer = 0;

  function resize() {
    sizeDirty = false;
    cssW = canvas.clientWidth || innerWidth;
    cssH = canvas.clientHeight || innerHeight;
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
    U.uViewport.value.set(cssW, cssH);
    U.uPx.value = 3 * renderer.getPixelRatio();
    // rotation limits so the overscanned landscape edges stay off screen (sky at ~0.58 lever)
    const asp = camera.aspect;
    yawMax = clamp((marginX(asp) * TAN * asp) / 0.58, 0.03, 0.2);
    pitchMax = (0.28 * TAN) / 0.58;   // fixed: a bigger ground overscan must not widen the cursor orbit
    // landscapes are composed for one aspect; re-compose when it changes for real (debounced)
    if (Math.abs(Math.log(asp / bakeAspect)) > 0.18) {
      clearTimeout(aspectTimer);
      aspectTimer = setTimeout(() => {
        const a = (canvas.clientWidth || innerWidth) / (canvas.clientHeight || innerHeight);
        if (Math.abs(Math.log(a / bakeAspect)) <= 0.18) return;
        bakeAspect = a;
        gen++;
        clouds.clear();
        layers.clear();
        if (wanted) { shown = null; bakeLoop(); }
      }, 350);
    }
  }

  function wake() {
    if (running && !raf && !document.hidden && !lost && !modal) { last = performance.now(); mDist = 0; raf = requestAnimationFrame(frame); }
  }

  const rect = (el, v) => {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > cssH || r.width === 0) v.set(0, 0, 0, 0);
    else v.set(r.left + r.width / 2, r.top + r.height / 2, r.width / 2, r.height / 2);
  };

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    if (sizeDirty) resize();
    U.uTime.value += dt;

    if (morph < 1) {
      morph = Math.min(1, morph + dt / morphDur);
      if (morph >= 1) {
        count = finalCount;
        geo.setDrawRange(0, count);
      }
    }
    U.uMorph.value = morph;

    // rolling: the section's offset from the viewport centre tilts the scene around X, top toward
    // the viewer while it enters from below, receding as it scrolls away (±ROLL_MAX a viewport off)
    let rollT = 0;
    if (active && !reduced) {
      const r = active.getBoundingClientRect();
      const rel = clamp((r.top + r.height / 2 - cssH / 2) / cssH, -1, 1);
      // receding past ~10° shows the ground's underside, so the exit tilt stays small
      rollT = rel * (rel > 0 ? ROLL_MAX : ROLL_EXIT);
    }
    roll += (rollT - roll) * (1 - Math.exp(-dt * 8));
    spin.rotation.x = roll;

    // idle sway after ~6 s without input
    idleFor += dt;
    const wantIdle = !reduced && idleFor > 6 ? 1 : 0;
    idleAmp += (wantIdle - idleAmp) * (1 - Math.exp(-dt * (wantIdle ? 0.6 : 2.5)));
    if (idleAmp > 0.001) idlePhase += dt * ((Math.PI * 2) / 26);
    spin.rotation.y = idleAmp * yawMax * 0.3 * Math.sin(idlePhase);

    // camera: mouse parallax orbit around the object plane (near layer and sky move opposite)
    if (touch) {
      const t = U.uTime.value;
      mx = reduced ? 0 : 0.35 * Math.sin(t * 0.21);
      my = reduced ? 0 : 0.3 * Math.sin(t * 0.17 + 1.3);
    }
    const k = 1 - Math.exp(-dt * 3);
    cmx += (mx - cmx) * k;
    cmy += (my - cmy) * k;
    // cursor orbit kept at 15% of its old reach (user asked for -85%)
    const yaw = cmx * yawMax * 0.55 * 0.15 * (reduced ? 0.5 : 1);
    const pit = cmy * pitchMax * 0.85 * 0.15 * (reduced ? 0.5 : 1);
    camera.position.set(CAM_DIST * Math.sin(yaw) * Math.cos(pit), CAM_DIST * Math.sin(pit), CAM_DIST * Math.cos(yaw) * Math.cos(pit));
    camera.lookAt(0, 0, 0);

    U.uRect0.value.set(0, 0, 0, 0);
    U.uRect1.value.set(0, 0, 0, 0);
    if (count > 0) repelEls.forEach((el, i) => rect(el, i ? U.uRect1.value : U.uRect0.value));

    // speed is smoothed so uneven pointer-event timing doesn't flicker; strength attacks fast
    // (a swipe answers at once) and releases slowly (points drift home instead of snapping)
    mSpeed += (mDist / dt - mSpeed) * (1 - Math.exp(-dt * 8));
    mDist = 0;
    const mWant = reduced || !mIn ? 0 : MOUSE_REST + (MOUSE_MAX - MOUSE_REST) * smooth(0, MOUSE_FAST, mSpeed);
    mStr += (mWant - mStr) * (1 - Math.exp(-dt * (mWant > mStr ? 12 : 2.2)));
    U.uMouse.value.z = mStr;

    if (count > 0) {
      renderer.render(scene, camera);
      cleared = false;
    } else if (!cleared) {
      renderer.setRenderTarget(null);
      renderer.clear();
      cleared = true;
    }
    raf = requestAnimationFrame(frame);
  }

  function stop() { cancelAnimationFrame(raf); raf = 0; }

  function start() {
    if (running) return;
    running = true;
    resize();
    bakeAspect = cssW / cssH;

    addEventListener('pointermove', onPointer, { passive: true });
    addEventListener('pointerdown', onPointer, { passive: true });
    document.addEventListener('pointerout', onLeave, { passive: true });
    addEventListener('blur', () => { mIn = false; });
    for (const ev of ['scroll', 'wheel', 'keydown', 'touchstart']) addEventListener(ev, poke, { passive: true });
    addEventListener('resize', () => { sizeDirty = true; wake(); });
    mqReduce.addEventListener('change', (e) => {
      reduced = e.matches;
      U.uShimmer.value = reduced ? 0 : 1;
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else wake(); });
    document.addEventListener('modal:open', () => { modal = true; stop(); });
    document.addEventListener('modal:close', () => { modal = false; wake(); });
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; stop(); });
    canvas.addEventListener('webglcontextrestored', () => { lost = false; wake(); });

    const sections = [...document.querySelectorAll('section')];
    queue = [...new Set(sections.map((s) => s.dataset.scene).filter((id) => id && SCENES[id]))];
    manifest();

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const vh = (e.rootBounds && e.rootBounds.height) || innerHeight;
        coverage.set(e.target, e.isIntersecting ? Math.max(e.intersectionRatio, e.intersectionRect.height / vh) : 0);
      }
      pickSection();
    }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
    sections.forEach((s) => io.observe(s));

    wake();
    // let the page paint first, then bake (the visible section first, the rest in idle time)
    const go = () => { if (!ready) { ready = true; stepT0 = performance.now(); bakeLoop(); } };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 300);
  }

  const api = { show, start, stats };
  window.__alapkoEngine = api; // debug handle (stats, fps checks)
  return api;
}
