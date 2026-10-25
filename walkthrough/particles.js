// particles.js: point-cloud house that materialises into solid (v2).
// export createMaterializer({ zones, boards, renderer }) -> { object, update(t, dt, camera, mix) }
//
// Three Points objects (house, boards, dust) with one soft additive shader, plus an
// onBeforeCompile noise dissolve (amber edge) patched into every zone / board material.
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

const ZONE_IDS = ['exterior', 'hall', 'living', 'studio'];
const BOARD_IDS = ['about', 'process', 'services', 'projects', 'contact'];
const ZONE_SHARE = [0.34, 0.2, 0.23, 0.23]; // house budget split per zone

// point budgets per tier: [house, boards, dust]
const TIERS = {
  high: [145000, 58000, 17000], // 220k
  mid: [100000, 40000, 10000], //  150k (integrated GPUs)
  low: [58000, 25000, 7000], //     90k (narrow / mobile / software)
};

const AMBER = new THREE.Color(0xf2a900); // linear working space after Color parse
const EDGE_INTENSITY = 1.5;

/* ------------------------------------------------------------------ */
/* GPU tier                                                            */
/* ------------------------------------------------------------------ */

function pickTier(renderer) {
  const q = typeof location !== 'undefined' && new URLSearchParams(location.search).get('particles');
  if (q && TIERS[q]) return q;
  let name = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
  } catch (e) { /* ignore */ }
  const w = innerWidth, h = innerHeight;
  const narrow = w < 760 || Math.min(w, h) < 520;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  const caps = renderer.capabilities;
  if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'low';
  if (narrow || coarse || caps.maxTextureSize < 8192 || /mali|adreno|powervr/i.test(name)) return 'low';
  if (/intel|uhd|iris/i.test(name) || (navigator.hardwareConcurrency || 8) <= 4) return 'mid';
  return 'high';
}

/* ------------------------------------------------------------------ */
/* point shader                                                        */
/* ------------------------------------------------------------------ */

const POINT_VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;      // viewport height px / (2 tan(fov/2))
uniform float uViewH;      // viewport height px
uniform float uMotion;     // 1 = drift on, 0 = reduced motion
uniform float uScatterAmp;
uniform float uBaseSize;   // world size of a point (m)
uniform float uIntensity;
uniform float uZoneMix[4];
uniform float uBoardMix[5];
attribute vec3 aColor;
attribute vec3 aScatter;
attribute vec3 aInfo;      // group index, seed, size jitter
varying vec3 vColor;
varying float vAlpha;

void main() {
  float seed = aInfo.y;
  float ph = seed * 6.2831853;
  vec3 p = position;

#if defined(MODE_DUST)
  float m = 0.0;
  float loose = 1.0;
  // slow rise with wrap, faded at the ends of the column
  p.y = mod(p.y + uTime * 0.035 * (0.3 + seed) * uMotion, 11.0) - 0.5;
  float edgeFade = smoothstep(-0.5, 1.0, p.y) * (1.0 - smoothstep(8.0, 10.5, p.y));
  float amp = 0.45 * uMotion;
#else
  #if defined(MODE_BOARD)
  float m = uBoardMix[int(aInfo.x + 0.5)];
  #else
  float m = uZoneMix[int(aInfo.x + 0.5)];
  #endif
  // staggered per point, strong ease-out: rushes in, settles softly
  #if defined(MODE_BOARD)
  float k = clamp((m - 0.15 * seed) / 0.45, 0.0, 1.0); // boards condense more together
  #else
  float k = clamp((m - 0.25 * seed) / 0.55, 0.0, 1.0);
  #endif
  float inv = 1.0 - k;
  float loose = inv * inv * inv;
  p += aScatter * (loose * uScatterAmp);
  float edgeFade = 1.0;
  float amp = (0.02 + 0.07 * loose) * uMotion;
#endif

  // cheap curl-ish drift
  p += amp * vec3(
    sin(uTime * 0.43 + p.y * 1.3 + ph),
    sin(uTime * 0.37 + p.z * 1.1 + ph * 1.7),
    sin(uTime * 0.31 + p.x * 1.2 + ph * 2.3));

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  // particles leave only once the solid is mostly in
  float fade = 1.0 - smoothstep(0.68, 0.97, m);
  float tw = 0.72 + 0.28 * sin(uTime * (1.1 + 2.3 * fract(seed * 7.13)) + ph * 5.0);
  tw += 0.9 * pow(max(0.0, sin(uTime * (0.35 + fract(seed * 3.7)) + ph * 11.0)), 40.0);
  float a = fade * edgeFade * tw * uIntensity * (0.8 + 0.3 * loose);

  float size = uBaseSize * aInfo.z * uScale / max(-mv.z, 0.05);
  size = min(size, uViewH * 0.007);
  if (size < 1.5) { a *= (size * size) / 2.25; size = 1.5; } // sub-pixel: fade, don't shimmer

  vColor = aColor;
  vAlpha = a;
  if (a < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }
  else gl_PointSize = size;
}
`;

const POINT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(c, c);
  if (d2 > 1.0) discard;
  float a = max(exp(-d2 * 3.5) - 0.03, 0.0) * vAlpha;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

function pointMaterial(mode, common, baseSize, intensity, mixArray) {
  const uniforms = {
    ...common,
    uBaseSize: { value: baseSize },
    uIntensity: { value: intensity },
    uZoneMix: { value: mode === 'HOUSE' ? mixArray : new Float32Array(4) },
    uBoardMix: { value: mode === 'BOARD' ? mixArray : new Float32Array(5) },
  };
  return new THREE.ShaderMaterial({
    name: `nb-points-${mode.toLowerCase()}`,
    defines: { [`MODE_${mode}`]: '' },
    uniforms,
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
}

/* ------------------------------------------------------------------ */
/* dissolve patch                                                      */
/* ------------------------------------------------------------------ */

const DISSOLVE_COMMON = /* glsl */ `
uniform float uMix;
uniform vec3 uEdgeColor;
varying vec3 vDissolvePos;
float nbHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float nbNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(nbHash(i), nbHash(i + vec3(1,0,0)), f.x), mix(nbHash(i + vec3(0,1,0)), nbHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(nbHash(i + vec3(0,0,1)), nbHash(i + vec3(1,0,1)), f.x), mix(nbHash(i + vec3(0,1,1)), nbHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float nbDissolveN(vec3 p) {
  // ~0.4 m features: coarser noise leaves flat regions that light up the whole edge band at once
  float n = 0.66 * nbNoise(p * 2.4) + 0.27 * nbNoise(p * 7.2 + 7.1) + 0.07 * nbNoise(p * 19.0 + 3.3);
  n = clamp((n - 0.18) / 0.64, 0.0, 1.0);
  return mix(n, clamp(p.y / 3.4, 0.0, 1.0), 0.3); // builds a little from the ground up
}
`;

function patchMaterial(mat, uMix, uEdge) {
  if (mat.userData.nbDissolve) return;
  mat.userData.nbDissolve = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev.call(mat, shader, r);
    shader.uniforms.uMix = uMix;
    shader.uniforms.uEdgeColor = uEdge;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDissolvePos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vec4 nbWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  nbWp = instanceMatrix * nbWp;
  #endif
  vDissolvePos = (modelMatrix * nbWp).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DISSOLVE_COMMON)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  float nbEdge = 0.0;
  if (uMix < 0.999) {
    float nbN = nbDissolveN(vDissolvePos);
    float nbT = uMix * 1.15 - 0.075;
    if (nbN > nbT) discard;
    // thin hot rim: ~0.02 of n, never thinner than ~1.5 px
    float nbW = max(0.012, fwidth(nbN) * 1.5);
    nbEdge = 1.0 - smoothstep(0.0, nbW, nbT - nbN);
    nbEdge *= nbEdge;
  }`)
      .replace('#include <opaque_fragment>', 'outgoingLight += uEdgeColor * nbEdge;\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|nbDissolve';
  mat.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const SRGB_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_LUT[i] = c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function meshesOf(root) {
  const out = [];
  root.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
}

function materialsOf(mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function particleColorOf(mesh) {
  if (mesh.userData.particleColor && mesh.userData.particleColor.isColor) return mesh.userData.particleColor.clone();
  const m = materialsOf(mesh)[0];
  const c = m && m.color ? m.color.clone() : new THREE.Color(1, 1, 1);
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  if (l < 0.12) c.lerp(new THREE.Color(1, 0.95, 0.88), 0.35);
  return c;
}

// world-space surface area with a soft cap so lawns do not eat the budget
function weightOf(area) { return area <= 40 ? area : 40 + Math.sqrt(area - 40) * 6; }

function splitCounts(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const out = weights.map((w) => Math.floor((total * w) / sum));
  let rest = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0 && out.length; i = (i + 1) % out.length, rest--) if (weights[i] > 0) out[i]++;
  return out;
}

class PointBuffer {
  constructor(n, withScatter = true) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Uint8Array(n * 3);
    this.info = new Float32Array(n * 3);
    this.scatter = withScatter ? new Float32Array(n * 3) : null;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3, true));
    g.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 3));
    if (this.scatter) g.setAttribute('aScatter', new THREE.BufferAttribute(this.scatter, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.geo = g;
    return g;
  }
  set(i, p, c, group, seed, size) {
    const j = i * 3;
    this.pos[j] = p.x; this.pos[j + 1] = p.y; this.pos[j + 2] = p.z;
    this.col[j] = Math.min(255, Math.max(0, Math.round(c.r * 255)));
    this.col[j + 1] = Math.min(255, Math.max(0, Math.round(c.g * 255)));
    this.col[j + 2] = Math.min(255, Math.max(0, Math.round(c.b * 255)));
    this.info[j] = group; this.info[j + 1] = seed; this.info[j + 2] = size;
  }
  setScatter(i, normal, liftScale = 1) {
    // ~0.15–0.6 m along a random direction biased off the surface, plus upward lift
    let x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
    const l = Math.hypot(x, y, z) || 1;
    x = x / l + normal.x * 0.8; y = y / l + normal.y * 0.8; z = z / l + normal.z * 0.8;
    const l2 = Math.hypot(x, y, z) || 1;
    // mostly modest offsets (keeps the shape legible as dust), a long tail out to ~0.6 m
    const q = Math.random();
    const r = 0.06 + 0.54 * q * q;
    const j = i * 3;
    this.scatter[j] = (x / l2) * r;
    this.scatter[j + 1] = (y / l2) * r + (0.04 + 0.26 * Math.random() * Math.random()) * liftScale;
    this.scatter[j + 2] = (z / l2) * r;
  }
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

export function createMaterializer({ zones, boards, renderer }) {
  const tier = pickTier(renderer);
  const [HOUSE_N, BOARD_N, DUST_N] = TIERS[tier];
  // fewer points → slightly larger, brighter points so the cloud keeps its body
  const comp = Math.sqrt(TIERS.high[0] / HOUSE_N);
  const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const object = new THREE.Group();
  object.name = 'materializer';

  const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color();
  const _nm = new THREE.Matrix3(), _im = new THREE.Matrix4(), _wm = new THREE.Matrix4();
  const _vp = new THREE.Vector4();

  const zoneMix = new Float32Array(4);
  const boardMix = new Float32Array(5);
  const uEdge = { value: AMBER.clone().multiplyScalar(EDGE_INTENSITY) };

  const common = {
    uTime: { value: 0 },
    uScale: { value: 800 },
    uViewH: { value: 900 },
    uMotion: { value: reduceMotion ? 0 : 1 },
    uScatterAmp: { value: reduceMotion ? 0.35 : 1 },
  };
  // size uniforms follow whatever target is being drawn (screen or the composer's RT)
  const setScale = (r, s, cam) => {
    r.getCurrentViewport(_vp);
    const h = _vp.w || 900;
    common.uViewH.value = h;
    common.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad((cam.fov || 55) * 0.5)));
  };

  // ---- dissolve groups ---------------------------------------------
  const groups = []; // { key, mixIndex, isBoard, uMix, meshes: [{mesh, cast}] }
  const seenMat = new Map(); // material -> group (clone when shared across groups)

  function adopt(group, mesh) {
    const mats = materialsOf(mesh).map((m) => {
      if (!m) return m;
      const owner = seenMat.get(m);
      if (owner && owner !== group) {
        const c = m.clone();
        seenMat.set(c, group);
        return c;
      }
      seenMat.set(m, group);
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
    for (const m of mats) if (m) patchMaterial(m, group.uMix, uEdge);
    group.meshes.push({ mesh, cast: mesh.castShadow });
    mesh.visible = false;
  }

  // ---- house points ---------------------------------------------------
  const zoneMeshes = ZONE_IDS.map((id) => (zones && zones[id]) || []);
  ZONE_IDS.forEach((id, zi) => {
    const g = { key: id, index: zi, isBoard: false, uMix: { value: 0 }, meshes: [] };
    groups.push(g);
    for (const mesh of zoneMeshes[zi]) if (mesh && mesh.isMesh) adopt(g, mesh);
  });

  // sampler per mesh, world area
  const entries = [];
  zoneMeshes.forEach((list, zi) => {
    for (const mesh of list) {
      if (!mesh || !mesh.isMesh || !mesh.geometry || !mesh.geometry.getAttribute('position')) continue;
      mesh.updateWorldMatrix(true, false);
      let sampler;
      try { sampler = new MeshSurfaceSampler(mesh).build(); } catch (e) { continue; }
      const localArea = sampler.distribution ? sampler.distribution[sampler.distribution.length - 1] : 0;
      const s = mesh.matrixWorld.getMaxScaleOnAxis();
      const inst = mesh.isInstancedMesh ? mesh.count : 1;
      const area = localArea * s * s * inst;
      if (!(area > 1e-5)) continue;
      entries.push({ mesh, sampler, zi, area, color: particleColorOf(mesh) });
    }
  });
  const zoneHas = ZONE_IDS.map((_, zi) => entries.some((e) => e.zi === zi));
  const zoneBudget = splitCounts(HOUSE_N, ZONE_SHARE.map((s, i) => (zoneHas[i] ? s : 0)));
  const counts = new Array(entries.length).fill(0);
  ZONE_IDS.forEach((_, zi) => {
    const idx = []; const w = [];
    entries.forEach((e, i) => { if (e.zi === zi) { idx.push(i); w.push(weightOf(e.area)); } });
    splitCounts(zoneBudget[zi], w).forEach((c, k) => { counts[idx[k]] = c; });
  });
  const houseTotal = counts.reduce((a, b) => a + b, 0);
  const house = new PointBuffer(houseTotal);
  {
    let i = 0;
    entries.forEach((e, ei) => {
      const { mesh, sampler, zi, color } = e;
      for (let k = 0; k < counts[ei]; k++, i++) {
        sampler.sample(_p, _n);
        if (mesh.isInstancedMesh) {
          mesh.getMatrixAt((Math.random() * mesh.count) | 0, _im);
          _wm.multiplyMatrices(mesh.matrixWorld, _im);
        } else _wm.copy(mesh.matrixWorld);
        _p.applyMatrix4(_wm);
        _nm.getNormalMatrix(_wm);
        _n.applyMatrix3(_nm).normalize();
        _p.addScaledVector(_n, 0.012); // sit just proud of the face (no z-fight with the solid)
        const j = 0.9 + Math.random() * 0.2; // ±10% jitter
        _c.setRGB(color.r * j, color.g * j, color.b * j);
        house.set(i, _p, _c, zi, Math.random(), 0.6 + Math.random() * 0.8);
        house.setScatter(i, _n);
      }
    });
  }
  const houseMat = pointMaterial('HOUSE', common, 0.009 * comp, 1.05 * Math.sqrt(comp), zoneMix);
  const housePoints = new THREE.Points(house.geometry(), houseMat);
  housePoints.name = 'points-house';
  housePoints.frustumCulled = false;
  housePoints.onBeforeRender = setScale;
  object.add(housePoints);

  // ---- board points ---------------------------------------------------
  const boardList = []; // { index, face, w, h, dressing: [mesh], start, count, faceCount }
  if (boards) {
    boards.updateMatrixWorld(true);
    for (const child of boards.children) {
      const id = child.userData && child.userData.id;
      const bi = BOARD_IDS.indexOf(id);
      if (bi < 0) continue;
      const g = { key: id, index: bi, isBoard: true, uMix: { value: 0 }, meshes: [] };
      groups.push(g);
      const meshes = meshesOf(child);
      for (const m of meshes) adopt(g, m);
      const face = meshes.find((m) => m.material && m.material.map && m.material.map.image && m.geometry.parameters && m.geometry.parameters.width)
        || null;
      boardList.push({ index: bi, face, dressing: meshes.filter((m) => m !== face) });
    }
  }
  const perBoard = boardList.length ? splitCounts(BOARD_N, boardList.map(() => 1)) : [];
  const board = new PointBuffer(perBoard.reduce((a, b) => a + b, 0));
  {
    let start = 0;
    boardList.forEach((b, k) => {
      b.start = start;
      b.count = perBoard[k];
      b.faceCount = b.face ? Math.round(b.count * 0.86) : 0;
      start += b.count;
    });
  }

  // scratch canvas for reading board art at half resolution
  let scratch = null, sctx = null, cdf = null;
  function readArt(face) {
    const src = face.material.map.image;
    const W = Math.max(2, Math.round(src.width / 2)), H = Math.max(2, Math.round(src.height / 2));
    if (!scratch) {
      scratch = document.createElement('canvas');
      sctx = scratch.getContext('2d', { willReadFrequently: true });
    }
    if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
    sctx.clearRect(0, 0, W, H);
    sctx.drawImage(src, 0, 0, W, H);
    const data = sctx.getImageData(0, 0, W, H).data;
    const N = W * H;
    let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < N * 4; i += 4) { mr += data[i]; mg += data[i + 1]; mb += data[i + 2]; }
    mr /= N; mg /= N; mb /= N;
    if (!cdf || cdf.length < N) cdf = new Float32Array(N);
    let acc = 0;
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      const dr = data[p] - mr, dg = data[p + 1] - mg, db = data[p + 2] - mb;
      const d = Math.sqrt(dr * dr + dg * dg + db * db) / 441.7; // 0..1
      const t = Math.min(1, Math.max(0, (d - 0.06) / 0.29));
      acc += 0.04 + t * t * (3 - 2 * t); // density weighted toward ink
      cdf[i] = acc;
    }
    return { data, W, H, N, total: acc, mean: [mr / 255, mg / 255, mb / 255] };
  }

  function sampleBoard(b) {
    const seedBase = b.index;
    let i = b.start;
    _nm.getNormalMatrix(b.face ? b.face.matrixWorld : boards.matrixWorld);
    if (b.face && b.faceCount > 0) {
      const { data, W, H, N, total, mean } = readArt(b.face);
      const meanL = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2];
      const { width: w, height: h } = b.face.geometry.parameters;
      _n.set(0, 0, 1).applyMatrix3(_nm).normalize();
      for (let k = 0; k < b.faceCount; k++, i++) {
        const target = Math.random() * total;
        let lo = 0, hi = N - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < target) lo = mid + 1; else hi = mid; }
        const cx = lo % W, cy = (lo / W) | 0;
        const u = (cx + Math.random()) / W, v = (cy + Math.random()) / H;
        _p.set((u - 0.5) * w, (0.5 - v) * h, 0.006).applyMatrix4(b.face.matrixWorld);
        const p4 = lo * 4;
        const r = data[p4] / 255, g = data[p4 + 1] / 255, bl = data[p4 + 2] / 255;
        const d = Math.hypot(r - mean[0], g - mean[1], bl - mean[2]) / 1.732;
        const ink = Math.min(1, Math.max(0, (d - 0.06) / 0.29));
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
        let ir = r, ig = g, ib = bl;
        if (L < meanL) { // dark ink on a light board: glow it (black → warm white, blue → bright blue)
          const mx = Math.max(r, g, bl) + 0.12;
          ir = (r + 0.12) / mx; ig = (g + 0.12) / mx * 0.97; ib = (bl + 0.12) / mx * 0.92;
        }
        // sRGB → linear, ink bright, background dim
        const fr = SRGB_LUT[Math.round(ir * 255)], fg = SRGB_LUT[Math.round(ig * 255)], fb = SRGB_LUT[Math.round(ib * 255)];
        const br = SRGB_LUT[Math.round(r * 255)] * 0.35, bg = SRGB_LUT[Math.round(g * 255)] * 0.35, bb = SRGB_LUT[Math.round(bl * 255)] * 0.35;
        _c.setRGB(br + (fr - br) * ink, bg + (fg - bg) * ink, bb + (fb - bb) * ink);
        board.set(i, _p, _c, b.index, Math.random(), 0.75 + Math.random() * 0.5);
        board.setScatter(i, _n, 0.6);
      }
    }
    // frames, trays, props: area-proportional, flat material colour
    const rest = b.start + b.count - i;
    if (rest > 0 && b.dressing.length) {
      const samplers = [], w = [];
      for (const m of b.dressing) {
        try {
          const s = new MeshSurfaceSampler(m).build();
          samplers.push({ m, s, c: particleColorOf(m) });
          w.push(s.distribution[s.distribution.length - 1]);
        } catch (e) { /* skip */ }
      }
      const cnt = splitCounts(rest, w);
      samplers.forEach(({ m, s, c }, k) => {
        _nm.getNormalMatrix(m.matrixWorld);
        for (let q = 0; q < cnt[k]; q++, i++) {
          s.sample(_p, _n);
          _p.applyMatrix4(m.matrixWorld);
          _n.applyMatrix3(_nm).normalize();
          _p.addScaledVector(_n, 0.006);
          const j = (0.9 + Math.random() * 0.2) * 0.8;
          _c.setRGB(c.r * j, c.g * j, c.b * j);
          board.set(i, _p, _c, b.index, Math.random(), 0.7 + Math.random() * 0.5);
          board.setScatter(i, _n, 0.6);
        }
      });
    }
    for (; i < b.start + b.count; i++) { // nothing to sample: park invisibly
      board.pos[i * 3 + 1] = -1000;
      board.info[i * 3] = seedBase;
    }
  }
  boardList.forEach(sampleBoard);

  const boardMat = pointMaterial('BOARD', common, 0.0075 * Math.sqrt(comp), 1.3, boardMix);
  const boardPoints = new THREE.Points(board.geometry(), boardMat);
  boardPoints.name = 'points-boards';
  boardPoints.frustumCulled = false;
  boardPoints.onBeforeRender = setScale;
  object.add(boardPoints);

  // re-sample board art once web fonts have landed (boards redraw asynchronously)
  if (boardList.length && typeof document !== 'undefined' && document.fonts) {
    let timer = 0, runs = 0;
    const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 16));
    const resample = () => {
      if (runs++ > 3) return;
      let k = 0;
      const step = () => {
        if (k >= boardList.length) {
          board.geo.attributes.position.needsUpdate = true;
          board.geo.attributes.aColor.needsUpdate = true;
          board.geo.attributes.aScatter.needsUpdate = true;
          board.geo.attributes.aInfo.needsUpdate = true;
          return;
        }
        sampleBoard(boardList[k++]);
        idle(step);
      };
      idle(step);
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(resample, 400); };
    document.fonts.ready.then(schedule);
    document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', schedule);
    setTimeout(() => document.fonts.removeEventListener && document.fonts.removeEventListener('loadingdone', schedule), 12000);
  }

  // ---- ambient dust ---------------------------------------------------
  const dust = new PointBuffer(DUST_N, false);
  {
    const cool = new THREE.Color(0.5, 0.6, 0.85), warm = new THREE.Color(0.95, 0.55, 0.12);
    for (let i = 0; i < DUST_N; i++) {
      // denser near the house, thinning out toward the edges of the property
      const rx = Math.random() * 2 - 1, rz = Math.random() * 2 - 1;
      _p.set(Math.sign(rx) * Math.pow(Math.abs(rx), 1.4) * 24, Math.random() * 11, -3 + Math.sign(rz) * Math.pow(Math.abs(rz), 1.4) * 27);
      const isWarm = Math.random() < 0.18;
      const b = 0.25 + Math.random() * 0.5;
      _c.copy(isWarm ? warm : cool).multiplyScalar(b);
      dust.set(i, _p, _c, 0, Math.random(), 0.6 + Math.random() * 1.2);
    }
  }
  const dustMat = pointMaterial('DUST', common, 0.022, 0.5, null);
  const dustPoints = new THREE.Points(dust.geometry(), dustMat);
  dustPoints.name = 'points-dust';
  dustPoints.frustumCulled = false;
  dustPoints.onBeforeRender = setScale;
  object.add(dustPoints);

  object.userData.tier = tier;
  object.userData.counts = { house: house.n, boards: board.n, dust: dust.n, total: house.n + board.n + dust.n };

  // ---- per frame ------------------------------------------------------
  function update(t, dt, camera, mix) {
    common.uTime.value = t;
    for (let g = 0; g < groups.length; g++) {
      const grp = groups[g];
      let m = mix ? mix[grp.key] : 0;
      m = m > 0 ? (m < 1 ? m : 1) : 0;
      grp.uMix.value = m;
      if (grp.isBoard) boardMix[grp.index] = m; else zoneMix[grp.index] = m;
      const vis = m > 0.001, full = m >= 0.999;
      for (let k = 0; k < grp.meshes.length; k++) {
        const e = grp.meshes[k];
        e.mesh.visible = vis;
        e.mesh.castShadow = e.cast && full;
      }
    }
  }

  return { object, update };
}
