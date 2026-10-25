// engine.js: pixelated point-cloud world behind the 3D sections.
// export createEngine(canvas, SCENES) -> { show(id), start() }
//
// Bake: each scene's build(0) is rendered offscreen at low resolution (colour pass + linear-depth
// pass) from three yaw angles; every covered pixel becomes one particle at its reconstructed 3D
// position. Points from the side views are only kept where the front view left a voxel empty.
// Clouds live in a camera-aligned frame (pivot on the scene camera's view ray, yaw aligned, scaled
// so the bake frame is 2 units tall), so any cloud morphs into any other with no extra transforms.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const FOV = 35;
const BAKE_YAWS = [0, 55 * DEG, -55 * DEG];
const MORPH_DUR = 1.25;
const DISPERSE_DUR = 0.9;
const STAGGER = 0.45;
const REPEL_PX = 28;

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

// linear view depth packed into 24 bits of RGB (alpha marks coverage)
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
uniform float uScale;     // drawing-buffer px per world unit at distance 1
uniform float uCell;      // world size of one baked pixel
uniform float uSizeMul;
uniform vec2 uViewport;   // CSS px
uniform vec4 uRect0;      // repel rects: centre xy, half size zw (CSS px); z <= 0 = off
uniform vec4 uRect1;
uniform float uRepel;     // max push in CSS px
attribute vec3 aPosB;
attribute vec4 aColA;
attribute vec4 aColB;
attribute vec4 aRnd;      // xyz random unit dir, w seed
attribute float aDelay;
varying vec4 vCol;
varying float vSize;

float easeIO(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5; }

vec2 repel(vec2 sp, vec4 r, inout float inside) {
  if (r.z <= 0.0) return vec2(0.0);
  vec2 d = sp - r.xy;
  vec2 q = abs(d) - r.zw;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);  // signed distance to the rect
  float f = 1.0 - smoothstep(0.0, 90.0, sd);                  // soft falloff outside
  inside = max(inside, 1.0 - smoothstep(-30.0, 10.0, sd));
  vec2 dir = normalize(d * vec2(r.w, r.z) + vec2(1e-3, 0.0)); // squarish: points above go up
  // weak at the centre (no "bullet hole"), full strength from the rim outward
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
  float sh = 1.0 + uShimmer * (0.1 * sin(uTime * (1.2 + 2.4 * seed) + seed * 61.0)
    + 0.75 * pow(max(0.0, sin(uTime * (0.3 + 0.5 * fract(seed * 7.31)) + seed * 97.0)), 24.0));
  p += uShimmer * 0.004 * vec3(sin(uTime * 0.9 + seed * 31.0), sin(uTime * 0.7 + seed * 17.0), 0.0);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec4 clip = projectionMatrix * mv;

  vec2 ndc = clip.xy / clip.w;
  vec2 sp = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5) * uViewport;
  float inside = 0.0;
  vec2 push = repel(sp, uRect0, inside) + repel(sp, uRect1, inside);
  clip.xy += push * uRepel * vec2(2.0 / uViewport.x, -2.0 / uViewport.y) * clip.w;

  vCol = vec4(c.rgb * sh, c.a * (1.0 - 0.3 * inside));
  float size = uCell * uScale / max(-mv.z, 0.01);
  vSize = size;
  gl_PointSize = max(size * uSizeMul, 1.0);
  gl_Position = vCol.a < 0.003 ? vec4(2.0, 2.0, 2.0, 1.0) : clip;
}`;

// square "pixel" with a hairline dark rim, so the grid reads like a pixelated render
const POINT_FRAG = /* glsl */ `
varying vec4 vCol;
varying float vSize;
void main() {
  if (vCol.a < 0.01) discard;
  vec2 q = abs(gl_PointCoord - 0.5) * 2.0;
  float m = max(q.x, q.y);
  float rim = vSize > 3.5 ? smoothstep(1.0 - 2.2 / vSize, 1.0, m) : 0.0;
  gl_FragColor = vec4(vCol.rgb * (1.04 - 0.5 * rim), vCol.a);
}`;

const GLOW_FRAG = /* glsl */ `
uniform float uGlow;
varying vec4 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(c, c) * 3.0) * vCol.a * uGlow;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol.rgb, a);
}`;

const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ */
/* engine                                                             */
/* ------------------------------------------------------------------ */

export function createEngine(canvas, SCENES) {
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = mqReduce.matches;
  const touch = matchMedia('(hover: none)').matches || matchMedia('(pointer: coarse)').matches;
  const mobile = touch || Math.min(innerWidth, (screen && screen.width) || innerWidth) < 760;
  const BAKE_W = mobile ? 140 : 220;
  const BAKE_H = Math.round((BAKE_W * 9) / 16);
  const CAP = mobile ? 40000 : 80000; // per cloud; drawn count never exceeds this
  const CELL = 2 / BAKE_H; // one baked pixel, in cloud units

  // fallback placement if the stylesheet doesn't position the canvas
  if (getComputedStyle(canvas).position === 'static') {
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '-1', pointerEvents: 'none' });
  }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true; // only used by the bake renders (scenes may cast shadows)
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  /* ---------- display scene ---------- */
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 100);
  const scene = new THREE.Scene();
  const tilt = new THREE.Group(); // pitch of the source camera
  const spin = new THREE.Group(); // idle + scroll rotation around up
  scene.add(tilt);
  tilt.add(spin);

  const geo = new THREE.BufferGeometry();
  const attr = (name, size) => {
    const a = new THREE.BufferAttribute(new Float32Array(CAP * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
    return a;
  };
  const aPosA = attr('position', 3);
  const aPosB = attr('aPosB', 3);
  const aColA = attr('aColA', 4);
  const aColB = attr('aColB', 4);
  const aDelay = attr('aDelay', 1);
  const aRnd = attr('aRnd', 4);
  for (let i = 0; i < CAP; i++) {
    // random unit vector + seed
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    aRnd.array.set([r * Math.cos(th), u, r * Math.sin(th), Math.random()], i * 4);
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
    uScale: { value: 1 },
    uCell: { value: CELL },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uRect0: { value: new THREE.Vector4() },
    uRect1: { value: new THREE.Vector4() },
    uRepel: { value: REPEL_PX },
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

  if (!mobile) {
    const glowMat = new THREE.ShaderMaterial({
      uniforms: { ...U, uSizeMul: { value: 2.2 }, uGlow: { value: 0.13 } },
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

  /* ---------- bake ---------- */
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
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      }
      if (o.dispose && o.isLight) o.dispose();
    });
  }

  // Generator: one yield per expensive step, so the idle scheduler can spread a bake out.
  function* bakeSteps(id) {
    const built = SCENES[id].build(0);
    const src = built.scene, cam = built.camera;
    const size = built.size || 1;
    src.background = null;
    yield;

    cam.updateMatrixWorld(true);
    if (cam.parent) { cam.matrixWorld.decompose(cam.position, cam.quaternion, cam.scale); cam.removeFromParent(); }
    cam.aspect = BAKE_W / BAKE_H;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    src.updateMatrixWorld(true);

    const camPos = cam.position.clone();
    const camQuat = cam.quaternion.clone();
    const f = cam.getWorldDirection(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(src);
    const center = box.isEmpty() ? camPos.clone().addScaledVector(f, size * 3) : box.getCenter(new THREE.Vector3());
    let dist = center.clone().sub(camPos).dot(f);
    if (!(dist > cam.near * 2)) dist = size * 3;
    const pivot = camPos.clone().addScaledVector(f, dist);
    const tanH = Math.tan((cam.getEffectiveFOV() * DEG) / 2);
    const s = 1 / (dist * tanH); // bake frame is 2 units tall at the pivot

    const fh = new THREE.Vector3(f.x, 0, f.z);
    if (fh.lengthSq() < 1e-6) fh.set(0, 0, -1);
    fh.normalize();
    const qAlign = new THREE.Quaternion().setFromUnitVectors(fh, new THREE.Vector3(0, 0, -1));
    const pitch = Math.asin(clamp(f.y, -1, 1));
    const toCloud = new THREE.Matrix4().makeScale(s, s, s)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(qAlign))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));

    const near = cam.near, far = cam.far;
    depthMat.uniforms.uNear.value = near;
    depthMat.uniforms.uFar.value = far;
    const aspect = cam.aspect;

    const pos = [], col = [];
    const voxels = new Set();
    const vox = CELL * 0.9;
    const M = new THREE.Matrix4();
    const qYaw = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const prevTarget = renderer.getRenderTarget();

    for (let v = 0; v < BAKE_YAWS.length; v++) {
      qYaw.setFromAxisAngle(up, BAKE_YAWS[v]);
      cam.position.copy(camPos).sub(pivot).applyQuaternion(qYaw).add(pivot);
      cam.quaternion.copy(qYaw).multiply(camQuat);
      cam.updateMatrixWorld(true);

      src.overrideMaterial = null;
      renderer.setRenderTarget(rtColor);
      renderer.clear();
      renderer.render(src, cam);
      renderer.readRenderTargetPixels(rtColor, 0, 0, BAKE_W, BAKE_H, bufC);
      src.overrideMaterial = depthMat;
      renderer.setRenderTarget(rtDepth);
      renderer.clear();
      renderer.render(src, cam);
      renderer.readRenderTargetPixels(rtDepth, 0, 0, BAKE_W, BAKE_H, bufD);
      src.overrideMaterial = null;
      renderer.setRenderTarget(prevTarget);

      M.multiplyMatrices(toCloud, cam.matrixWorld);
      const e = M.elements;
      const keepAll = v === 0;
      for (let py = 0; py < BAKE_H; py++) {
        const ny = ((py + 0.5) / BAKE_H) * 2 - 1;
        for (let px = 0; px < BAKE_W; px++) {
          const i = (py * BAKE_W + px) * 4;
          const a = bufC[i + 3];
          if (a < 40 || bufD[i + 3] < 255) continue;
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
          pos.push(x, y, z);
          // un-premultiply (transparent materials), keep the alpha for the point
          col.push(Math.min(1, bufC[i] / 255 / af), Math.min(1, bufC[i + 1] / 255 / af), Math.min(1, bufC[i + 2] / 255 / af), Math.min(1, af * 1.1));
        }
      }
      yield;
    }

    disposeScene(src);

    // shuffle (random morph pairing, cheap subsampling) and cap
    const total = pos.length / 3;
    const order = new Uint32Array(total);
    for (let i = 0; i < total; i++) order[i] = i;
    for (let i = total - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    const n = Math.min(total, CAP);
    const P = new Float32Array(n * 3), C = new Float32Array(n * 4);
    let ymin = Infinity, ymax = -Infinity;
    for (let k = 0; k < n; k++) {
      const o = order[k];
      P[k * 3] = pos[o * 3]; P[k * 3 + 1] = pos[o * 3 + 1]; P[k * 3 + 2] = pos[o * 3 + 2];
      C[k * 4] = col[o * 4]; C[k * 4 + 1] = col[o * 4 + 1]; C[k * 4 + 2] = col[o * 4 + 2]; C[k * 4 + 3] = col[o * 4 + 3];
      const y = P[k * 3 + 1];
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
    return { id, pos: P, col: C, n, pitch, ymin, ymax: ymax > ymin ? ymax : ymin + 1 };
  }

  const clouds = new Map(); // id -> cloud | null (failed)
  let job = null;
  let queue = [];
  let ready = false; // first paint has happened
  let pumpScheduled = false;
  let urgentTimer = 0;
  const ric = window.requestIdleCallback ? (fn) => requestIdleCallback(fn, { timeout: 1500 }) : (fn) => setTimeout(() => fn(null), 120);

  function step() {
    if (!job) {
      let id = wanted && !clouds.has(wanted) ? wanted : null;
      while (!id && queue.length) {
        const q = queue.shift();
        if (!clouds.has(q)) id = q;
      }
      if (!id) return false;
      job = { id, it: bakeSteps(id) };
    }
    try {
      const r = job.it.next();
      if (r.done) finish(job.id, r.value);
    } catch (err) {
      console.warn(`[engine] bake "${job.id}" failed:`, err);
      renderer.setRenderTarget(null);
      finish(job.id, null);
    }
    return true;
  }

  function finish(id, cloud) {
    job = null;
    clouds.set(id, cloud);
    if (wanted === id && shown !== id) begin(cloud);
  }

  // urgent (a section wants an unbaked scene): next task. Otherwise: idle time, with a timer
  // fallback because idle callbacks can starve (busy page, throttled tab).
  function schedule() {
    if (!ready) return;
    if (wanted && !clouds.has(wanted)) {
      if (!urgentTimer) urgentTimer = setTimeout(() => { urgentTimer = 0; pump(null); }, 0);
      return;
    }
    if (pumpScheduled || (!job && !queue.some((q) => !clouds.has(q)))) return;
    pumpScheduled = true;
    let fallback = 0;
    const run = (deadline) => {
      if (!pumpScheduled) return;
      pumpScheduled = false;
      clearTimeout(fallback);
      pump(deadline);
    };
    ric(run);
    fallback = setTimeout(() => run(null), 2500);
  }

  function pump(deadline) {
    if (document.hidden) { setTimeout(schedule, 500); return; }
    // one step (scene build, or one view render + readback) per task, more while idle time lasts
    do {
      if (!step()) return;
    } while (deadline && deadline.timeRemaining() > 12);
    schedule();
  }

  /* ---------- morph ---------- */
  let wanted; // undefined until the first show()
  let shown = null; // id currently displayed (or flying in)
  let count = 0, finalCount = 0;
  let morph = 1, morphDur = MORPH_DUR;
  let pitch = 0, pitchFrom = 0, pitchTo = 0;

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
      const t = clamp((morph - D[i] * stag) / (1 - stag), 0, 1);
      const e = easeIO(t), h = Math.sin(Math.PI * e) * arc;
      for (let k = 0; k < 3; k++) A[i3 + k] += (B[i3 + k] - A[i3 + k]) * e + R[i4 + k] * h;
      for (let k = 0; k < 4; k++) CA[i4 + k] += (CB[i4 + k] - CA[i4 + k]) * e;
    }
  }

  function begin(cloud) {
    const A = aPosA.array, B = aPosB.array, CA = aColA.array, CB = aColB.array, R = aRnd.array, D = aDelay.array;
    snapshot();
    const n0 = count;
    pitchFrom = pitch;
    U.uFade.value = reduced ? 1 : 0;
    U.uStagger.value = reduced ? 0 : STAGGER;

    if (cloud) {
      const n = cloud.n;
      const cnt = Math.max(n0, n);
      if (n0 === 0) {
        // first appearance: condense out of a dust cloud
        for (let i = 0; i < cnt; i++) {
          const j = i % n, i4 = i * 4, sp = 0.8 + 1.4 * R[i4 + 3];
          for (let k = 0; k < 3; k++) A[i * 3 + k] = cloud.pos[j * 3 + k] + R[i4 + k] * sp;
          for (let k = 0; k < 3; k++) CA[i4 + k] = cloud.col[j * 4 + k];
          CA[i4 + 3] = 0;
        }
      } else {
        for (let i = n0; i < cnt; i++) {
          // pad: duplicate existing points
          const j = i % n0;
          A[i * 3] = A[j * 3]; A[i * 3 + 1] = A[j * 3 + 1]; A[i * 3 + 2] = A[j * 3 + 2];
          for (let k = 0; k < 4; k++) CA[i * 4 + k] = CA[j * 4 + k];
        }
      }
      const yr = 1 / (cloud.ymax - cloud.ymin);
      for (let i = 0; i < cnt; i++) {
        const j = i % n;
        B[i * 3] = cloud.pos[j * 3]; B[i * 3 + 1] = cloud.pos[j * 3 + 1]; B[i * 3 + 2] = cloud.pos[j * 3 + 2];
        for (let k = 0; k < 4; k++) CB[i * 4 + k] = cloud.col[j * 4 + k];
        // builds up from the ground, with some randomness
        D[i] = 0.62 * (B[i * 3 + 1] - cloud.ymin) * yr + 0.38 * Math.random();
      }
      count = cnt;
      finalCount = n;
      pitchTo = cloud.pitch;
      morphDur = reduced ? 0.45 : MORPH_DUR;
      U.uArc.value = n0 === 0 ? 0 : 0.28;
      shown = cloud.id;
    } else {
      if (n0 === 0) { shown = null; return; }
      for (let i = 0; i < n0; i++) {
        const i4 = i * 4, sp = 0.6 + 1.2 * R[i4 + 3];
        for (let k = 0; k < 3; k++) B[i * 3 + k] = A[i * 3 + k] + R[i4 + k] * sp;
        for (let k = 0; k < 3; k++) CB[i4 + k] = CA[i4 + k];
        CB[i4 + 3] = 0;
        D[i] = Math.random();
      }
      finalCount = 0;
      pitchTo = pitch;
      morphDur = reduced ? 0.35 : DISPERSE_DUR;
      U.uArc.value = 0;
      shown = null;
    }
    for (const a of [aPosA, aPosB, aColA, aColB, aDelay]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * a.itemSize);
      a.needsUpdate = true;
    }
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
      if (c) begin(c);
      else begin(null);
    } else schedule();
  }

  /* ---------- input / motion ---------- */
  let mx = 0, my = 0, cmx = 0, cmy = 0;
  let idleFor = 0, idleAmp = 0, idlePhase = 0;
  let lastScroll = scrollY, vel = 0, sr = 0, sv = 0;
  const poke = () => { idleFor = 0; };

  function onPointer(e) {
    poke();
    if (e.pointerType !== 'mouse') return;
    mx = (e.clientX / innerWidth) * 2 - 1;
    my = (e.clientY / innerHeight) * 2 - 1;
  }

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
  let raf = 0, last = 0, running = false, lost = false, sizeDirty = true, cleared = false;
  let cssW = 1, cssH = 1;

  function resize() {
    sizeDirty = false;
    cssW = canvas.clientWidth || innerWidth;
    cssH = canvas.clientHeight || innerHeight;
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
    U.uViewport.value.set(cssW, cssH);
    const tanV = Math.tan((FOV * DEG) / 2);
    U.uScale.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * tanV);
    const dH = 1 / (tanV * 0.92);
    const dW = 16 / 9 / (tanV * camera.aspect * 0.92);
    camDist = Math.max(dH, dW * 0.78);
  }
  let camDist = 3;

  function wake() {
    if (running && !raf && !document.hidden && !lost) { last = performance.now(); raf = requestAnimationFrame(frame); }
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

    // morph
    if (morph < 1) {
      morph = Math.min(1, morph + dt / morphDur);
      if (morph >= 1) {
        count = finalCount;
        geo.setDrawRange(0, count);
      }
    }
    U.uMorph.value = morph;
    pitch = pitchFrom + (pitchTo - pitchFrom) * easeIO(morph);
    tilt.rotation.x = -pitch;

    // scroll velocity -> spring-damped yaw in the scroll direction
    const y = scrollY;
    const vInst = (y - lastScroll) / dt;
    lastScroll = y;
    vel += (vInst - vel) * Math.min(1, dt * 12);
    const target = reduced ? 0 : clamp(vel * 0.00045, -0.55, 0.55);
    sv += ((target - sr) * 42 - sv * 9.5) * dt;
    sr += sv * dt;

    // idle sway after ~6 s without input
    idleFor += dt;
    const wantIdle = !reduced && idleFor > 6 ? 1 : 0;
    idleAmp += (wantIdle - idleAmp) * (1 - Math.exp(-dt * (wantIdle ? 0.6 : 2.5)));
    if (idleAmp > 0.001) idlePhase += dt * ((Math.PI * 2) / 26);
    spin.rotation.y = sr + idleAmp * 0.5 * Math.sin(idlePhase);

    // camera: mouse parallax, or gentle drift on touch
    if (touch) {
      const t = U.uTime.value;
      mx = reduced ? 0 : 0.35 * Math.sin(t * 0.21);
      my = reduced ? 0 : 0.3 * Math.sin(t * 0.17 + 1.3);
    }
    const k = 1 - Math.exp(-dt * 3);
    cmx += (mx - cmx) * k;
    cmy += (my - cmy) * k;
    const yaw = cmx * 8 * DEG * (reduced ? 0.5 : 1);
    const pit = cmy * 5 * DEG * (reduced ? 0.5 : 1);
    camera.position.set(camDist * Math.sin(yaw) * Math.cos(pit), camDist * Math.sin(pit), camDist * Math.cos(yaw) * Math.cos(pit));
    camera.lookAt(0, 0, 0);

    // repel rects of the active section
    U.uRect0.value.set(0, 0, 0, 0);
    U.uRect1.value.set(0, 0, 0, 0);
    if (count > 0) repelEls.forEach((el, i) => rect(el, i ? U.uRect1.value : U.uRect0.value));

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

  function start() {
    if (running) return;
    running = true;

    addEventListener('pointermove', onPointer, { passive: true });
    addEventListener('pointerdown', onPointer, { passive: true });
    for (const ev of ['scroll', 'wheel', 'keydown', 'touchstart']) addEventListener(ev, poke, { passive: true });
    addEventListener('resize', () => { sizeDirty = true; });
    mqReduce.addEventListener('change', (e) => {
      reduced = e.matches;
      U.uShimmer.value = reduced ? 0 : 1;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else wake();
    });
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; cancelAnimationFrame(raf); raf = 0; });
    canvas.addEventListener('webglcontextrestored', () => { lost = false; wake(); });

    // bake order: scenes used on the page, in DOM order (the first one is the hero)
    const sections = [...document.querySelectorAll('section')];
    queue = [...new Set(sections.map((s) => s.dataset.scene).filter((id) => id && SCENES[id]))];

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const vh = (e.rootBounds && e.rootBounds.height) || innerHeight;
        coverage.set(e.target, e.isIntersecting ? Math.max(e.intersectionRatio, e.intersectionRect.height / vh) : 0);
      }
      pickSection();
    }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
    sections.forEach((s) => io.observe(s));

    wake();
    // let the page paint first, then bake (hero first, the rest in idle time)
    const go = () => { if (!ready) { ready = true; schedule(); } };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 300); // rAF can be throttled (background tab)
  }

  return { show, start };
}
