// scenes.js: procedural construction scenes for Alapkő (Engine agent since v2).
// Every build(variant, env) returns a fresh { scene, camera, size }.
// env (optional, used by the engine when the object sits in a photo landscape):
//   { bare: true }            omit the site ground plate / plinth (the landscape is the ground)
//   { sunSide: -1..1 }        sun azimuth relative to the camera (-1 left, +1 right of frame)
//   { sunColor, skyColor, groundColor }  THREE.Color-compatible values for the lights
// Convention: the subject is centred on the world origin, `size` is its
// approximate radius, the camera looks at the origin (camera.userData.target).
import * as THREE from 'three';

const D2R = Math.PI / 180;

/* ------------------------------------------------------------------ caches */
const GEO = new Map();
function geo(key, make) {
  let g = GEO.get(key);
  if (!g) { g = make(); GEO.set(key, g); }
  return g;
}
const boxGeo = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const cylGeo = (seg = 8) => geo('cyl' + seg, () => new THREE.CylinderGeometry(0.5, 0.5, 1, seg));

const MAT = new Map();
// Material with a subtle ground-contact darkening ("fake AO") baked in the shader.
function getMat(color, o, aoBase, aoH) {
  const key = [color, o.r ?? 0.8, o.m ?? 0, o.e ?? '', o.ei ?? 1, o.flat ? 1 : 0, o.side ?? 0, aoBase, aoH].join('|');
  let m = MAT.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color, roughness: o.r ?? 0.8, metalness: o.m ?? 0,
    flatShading: !!o.flat, side: o.side ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (o.e) { m.emissive.set(o.e); m.emissiveIntensity = o.ei ?? 1; }
  if (aoH > 0) {
    const b = aoBase.toFixed(4), h = aoH.toFixed(4);
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vAoY;')
        .replace('#include <project_vertex>', `#include <project_vertex>
  vec4 aoP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    aoP = instanceMatrix * aoP;
  #endif
  vAoY = (modelMatrix * aoP).y;`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAoY;')
        .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(${b}, ${b} + ${h}, vAoY));`);
    };
    m.customProgramCacheKey = () => 'alapko-ao-' + b + '-' + h;
  }
  MAT.set(key, m);
  return m;
}

/* ----------------------------------------------------------------- helpers */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
const _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);

// Builder bound to one scene build. `root` gets shifted so `center` lands on the origin.
class Kit {
  constructor(center, aoH) {
    this.root = new THREE.Group();
    this.root.position.set(-center[0], -center[1], -center[2]);
    this.aoBase = -center[1];
    this.aoH = aoH;
  }
  m(color, o = {}) { return getMat(color, o, this.aoBase, this.aoH); }
  mesh(g, mat, x = 0, y = 0, z = 0, parent = this.root) {
    const me = new THREE.Mesh(g, mat);
    me.position.set(x, y, z);
    parent.add(me);
    return me;
  }
  box(mat, w, h, d, x, y, z, ry = 0, parent = this.root) {
    const me = this.mesh(boxGeo(), mat, x, y, z, parent);
    me.scale.set(w, h, d);
    me.rotation.y = ry;
    return me;
  }
  cyl(mat, r, h, x, y, z, seg = 12, parent = this.root) {
    const me = this.mesh(cylGeo(seg), mat, x, y, z, parent);
    me.scale.set(r * 2, h, r * 2);
    return me;
  }
  // items: { p:[x,y,z], s:[sx,sy,sz], r:[rx,ry,rz] } or { mat: Matrix4 }, optional c (colour)
  inst(g, mat, items, parent = this.root) {
    const im = new THREE.InstancedMesh(g, mat, items.length);
    const col = new THREE.Color();
    items.forEach((it, i) => {
      if (it.mat) _m.copy(it.mat);
      else {
        _q.setFromEuler(_e.set(...(it.r || [0, 0, 0])));
        _m.compose(_v.set(...it.p), _q, _s.set(...(it.s || [1, 1, 1])));
      }
      im.setMatrixAt(i, _m);
      if (it.c !== undefined) im.setColorAt(i, col.set(it.c));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    parent.add(im);
    return im;
  }
}

// Matrix for a unit box/cylinder (length along Y) stretched from a to b.
function barMat(a, b, t, t2 = t) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(_up, dir.normalize());
  return new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(t, len, t2));
}

// Variant table: yaw offset (deg), elevation offset (deg), light warmth 0..1.
const VARIANTS = [
  { yaw: 0, elev: 0, warm: 0.55 },
  { yaw: -38, elev: 6, warm: 0.85 },
  { yaw: 34, elev: -4, warm: 0.2 },
  { yaw: -20, elev: 14, warm: 0.7 },
  { yaw: 40, elev: 3, warm: 1.0 },
  { yaw: 15, elev: -7, warm: 0.0 },
];
const variantOf = (v) => VARIANTS[(((v | 0) % 6) + 6) % 6];

function addLights(scene, v, size, baseYaw, env) {
  const V = variantOf(v), w = V.warm;
  const sky = env && env.skyColor ? new THREE.Color(env.skyColor) : new THREE.Color('#bcd0f5').lerp(new THREE.Color('#ffe2c2'), w);
  const sunC = env && env.sunColor ? new THREE.Color(env.sunColor) : new THREE.Color('#e6eeff').lerp(new THREE.Color('#ffbd78'), w);
  const gnd = env && env.groundColor ? new THREE.Color(env.groundColor) : new THREE.Color('#3b3128');
  scene.add(new THREE.HemisphereLight(sky, gnd, 1.35));
  // sun: matched to the landscape photo when env.sunSide is given, else v1's camera-left key
  const off = env && typeof env.sunSide === 'number' ? THREE.MathUtils.clamp(env.sunSide, -1, 1) * 62 : V.yaw * 0.6 - 50;
  const a = (baseYaw + off) * D2R;
  const sun = new THREE.DirectionalLight(sunC, 3.1);
  sun.position.set(Math.sin(a) * size * 3, size * 3.4, Math.cos(a) * size * 3);
  scene.add(sun);
  const b = (baseYaw + V.yaw + 140) * D2R;
  const rim = new THREE.DirectionalLight(new THREE.Color('#9fc2ff').lerp(new THREE.Color('#ffd6a8'), w * 0.5), 0.9);
  rim.position.set(Math.sin(b) * size * 3, size * 1.2, Math.cos(b) * size * 3);
  scene.add(rim);
}

// Camera orbiting the origin. fill: fraction of frame height the `size` sphere spans.
function makeCamera(size, v, { yaw = 30, elev = 20, fov = 38, fill = 0.72, lift = 0 } = {}) {
  const V = variantOf(v);
  const y = (yaw + V.yaw) * D2R;
  const e = THREE.MathUtils.clamp(elev + V.elev, 2, 75) * D2R;
  const cam = new THREE.PerspectiveCamera(fov, 16 / 9, size * 0.05, size * 30);
  const dist = size / (fill * Math.tan(fov * D2R / 2));
  cam.position.set(Math.sin(y) * Math.cos(e) * dist, Math.sin(e) * dist + lift, Math.cos(y) * Math.cos(e) * dist);
  const target = new THREE.Vector3(0, lift, 0);
  cam.lookAt(target);
  cam.userData.target = target;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

function finish(k, v, size, camOpts, env) {
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(k.root);
  addLights(scene, v, size, camOpts.yaw ?? 30, env);
  const camera = makeCamera(size, v, camOpts);
  scene.updateMatrixWorld(true);
  return { scene, camera, size };
}

// I-beam (length along X) as a group of three boxes.
function iBeam(k, mat, len, h, w, parent) {
  const g = new THREE.Group();
  const tf = h * 0.14, tw = w * 0.16;
  k.box(mat, len, tf, w, 0, h / 2 - tf / 2, 0, 0, g);
  k.box(mat, len, tf, w, 0, -h / 2 + tf / 2, 0, 0, g);
  k.box(mat, len, h - tf * 2, tw, 0, 0, 0, 0, g);
  (parent || k.root).add(g);
  return g;
}

/* =================================================================== HOUSE */
function buildHouse(v = 0, env = null) {
  const bare = !!(env && env.bare);
  const k = new Kit([0.4, 3.0, 0.8], 1.2);
  const render = k.m('#ece6db', { r: 0.9 });
  const timber = k.m('#b0743f', { r: 0.75 });
  const batten = k.m('#8c5730', { r: 0.8 });
  const dark = k.m('#2a2d33', { r: 0.6 });
  const concrete = k.m('#8f9193', { r: 0.95 });
  const glassWarm = k.m('#2a3240', { r: 0.15, m: 0.1, e: '#ffc27a', ei: 0.85 });
  const glassCool = k.m('#4f7fae', { r: 0.1, m: 0.2, e: '#5d8fc4', ei: 0.35 });
  const lawn = k.m('#5c7f43', { r: 1 });
  const paving = k.m('#cfc7b8', { r: 0.95 });
  const deck = k.m('#9a6a42', { r: 0.8 });
  const pool = k.m('#3aa6d0', { r: 0.1, e: '#2a9fd0', ei: 0.55 });
  const leaf = k.m('#4f8a3d', { r: 0.9, flat: true });
  const leaf2 = k.m('#6a9a3a', { r: 0.9, flat: true });
  const trunk = k.m('#5b3e28');

  // site
  if (!bare) k.box(lawn, 15, 0.3, 11.5, 0.5, -0.15, 0.9);
  k.box(paving, 3.2, 0.06, 1.6, 4.6, 0.03, 4.0); // driveway pad under cantilever
  k.box(deck, 8.4, 0.14, 1.4, -1.0, 0.07, 3.7);
  k.box(paving, 5.4, 0.08, 2.6, -2.2, 0.04, 5.6); // pool coping
  k.box(pool, 4.6, 0.04, 1.8, -2.2, 0.1, 5.6);

  // ground floor: white render volume x[-5,3], z[-3,3]
  k.box(render, 8, 3, 6, -1, 1.5, 0);
  k.box(dark, 6.6, 2.62, 0.1, -1.4, 1.39, 3.0); // glazing frame
  for (let i = 0; i < 3; i++) k.box(glassWarm, 2.05, 2.4, 0.06, -3.55 + i * 2.15, 1.3, 3.06);
  k.box(dark, 0.08, 2.5, 4.2, -5.02, 1.45, 0.2); // side frame
  k.box(glassCool, 0.06, 2.3, 4.0, -5.06, 1.35, 0.2);
  k.box(dark, 1.2, 2.4, 0.08, 2.35, 1.2, 3.04); // entrance door
  k.box(timber, 1.0, 2.3, 0.05, 2.35, 1.15, 3.09);
  // slab between floors, roof terrace parapet
  k.box(dark, 11.4, 0.22, 6.4, 0.6, 3.11, 0);
  k.box(dark, 2.2, 0.5, 0.06, -4.0, 3.47, 3.12);
  k.box(dark, 0.06, 0.5, 6.3, -5.12, 3.47, 0);
  // stair core
  k.box(concrete, 1.4, 7.0, 1.6, -2.2, 3.5, -2.2);

  // upper floor: timber volume x[-3,6] (cantilevers 3 m past the ground floor)
  const uy = 4.6;
  k.box(timber, 9, 2.8, 5.2, 1.5, uy, 0);
  k.box(dark, 5.8, 1.85, 0.08, 2.0, uy, 2.62);
  k.box(glassWarm, 5.6, 1.65, 0.06, 2.0, uy, 2.66);
  for (const mx of [0.15, 1.95, 3.75]) k.box(dark, 0.07, 1.7, 0.1, mx, uy, 2.68);
  k.box(dark, 0.08, 1.85, 3.2, 6.02, uy, 0.4);
  k.box(glassCool, 0.06, 1.65, 3.0, 6.06, uy, 0.4);
  const bat = [];
  for (let x = -2.85; x <= 5.9; x += 0.3) {
    if (x > -1.0 && x < 5.0) { // around ribbon window: only above/below
      bat.push({ p: [x, 3.39, 2.63], s: [0.07, 0.38, 0.06] });
      bat.push({ p: [x, 5.79, 2.63], s: [0.07, 0.42, 0.06] });
    } else bat.push({ p: [x, uy, 2.63], s: [0.07, 2.8, 0.06] });
  }
  for (let z = -2.45; z <= 2.5; z += 0.3) {
    if (z > -1.3 && z < 2.1) {
      bat.push({ p: [6.03, 3.39, z], s: [0.06, 0.38, 0.07] });
      bat.push({ p: [6.03, 5.79, z], s: [0.06, 0.42, 0.07] });
    } else bat.push({ p: [6.03, uy, z], s: [0.06, 2.8, 0.07] });
  }
  k.inst(boxGeo(), batten, bat);
  // flat roofs with overhang + soffit downlight
  k.box(dark, 9.8, 0.28, 6.0, 1.5, 6.14, 0);
  k.box(k.m('#a9a59d', { r: 1 }), 9.5, 0.08, 5.7, 1.5, 6.32, 0); // gravel roof
  k.box(k.m('#fff1d6', { e: '#ffd79a', ei: 1.2 }), 2.6, 0.03, 0.12, 4.5, 2.99, 1.6);
  // trees and shrubs
  const tree = (x, z, s, mat) => {
    k.cyl(trunk, 0.12 * s, 1.6 * s, x, 0.8 * s, z, 6);
    const c = k.mesh(geo('ico1', () => new THREE.IcosahedronGeometry(1, 1)), mat, x, 2.2 * s, z);
    c.scale.set(1.1 * s, 1.3 * s, 1.1 * s);
  };
  tree(-6.0, 3.6, 1.25, leaf);
  tree(5.8, -3.2, 1.5, leaf2);
  tree(-6.3, -2.6, 0.9, leaf2);
  const shrub = geo('ico0', () => new THREE.IcosahedronGeometry(1, 0));
  k.inst(shrub, leaf, [
    { p: [0.8, 0.3, 3.95], s: [0.45, 0.35, 0.4] }, { p: [1.6, 0.25, 4.1], s: [0.35, 0.3, 0.32] },
    { p: [-5.6, 0.3, 1.2], s: [0.4, 0.35, 0.45] }, { p: [6.6, 0.3, 2.4], s: [0.45, 0.4, 0.45] },
  ]);
  return finish(k, v, 7.4, { yaw: 28, elev: 16, fov: 38, fill: 0.98 }, env);
}

/* =================================================================== CRANE */
function buildCrane(v = 0, env = null) {
  const bare = !!(env && env.bare);
  const k = new Kit([-0.5, 11.5, 0], 2.0);
  const amber = k.m('#f2a900', { r: 0.55, m: 0.15 });
  const amberDk = k.m('#c98200', { r: 0.6, m: 0.15 });
  const conc = k.m('#b3b1ab', { r: 0.95 });
  const concDk = k.m('#8d8b86', { r: 0.95 });
  const steel = k.m('#4f7fb8', { r: 0.45, m: 0.35 });
  const cable = k.m('#2b2e33', { r: 0.6 });
  const rust = k.m('#9a5634', { r: 0.9 });
  const glass = k.m('#2b3a4c', { r: 0.1, e: '#7fb4ff', ei: 0.5 });
  const ground = k.m('#6a6156', { r: 1 });
  const ply = k.m('#d6ad62', { r: 0.8 });

  if (!bare) k.box(ground, 20, 0.3, 12, -1.5, -0.15, 0);

  // half-built concrete frame: x[-5,5], z[-4,4]
  const xs = [-4.6, -1.55, 1.55, 4.6], zs = [-3.6, 0, 3.6];
  const cols = [];
  for (let f = 0; f < 3; f++) {
    for (const x of xs) for (const z of zs) {
      if (f === 2 && x > 2) continue; // top storey only partly up
      cols.push({ p: [x, f * 3.2 + 1.6, z], s: [0.5, 3.2, 0.5] });
    }
  }
  k.inst(boxGeo(), concDk, cols);
  k.box(conc, 10.6, 0.4, 8.6, 0, 0.2, 0);
  k.box(conc, 10.6, 0.32, 8.6, 0, 3.36, 0);
  k.box(conc, 10.6, 0.32, 8.6, 0, 6.56, 0);
  k.box(conc, 6.4, 0.32, 8.6, -2.1, 9.76, 0); // partial top slab
  k.box(ply, 3.0, 0.08, 8.6, 2.6, 9.66, 0); // formwork deck waiting for concrete
  // starter bars on the unfinished columns
  const starters = [];
  for (const x of [4.6]) for (const z of zs)
    for (const dx of [-0.15, 0.15]) for (const dz of [-0.15, 0.15])
      starters.push({ p: [x + dx, 6.72 + 0.7, z + dz], s: [0.06, 1.4, 0.06] });
  k.inst(boxGeo(), rust, starters);
  // amber edge protection on the floors
  const rails = [];
  for (const y of [4.4, 7.6]) {
    rails.push({ p: [0, y, 4.25], s: [10.6, 0.1, 0.1] }, { p: [5.25, y, 0], s: [0.1, 0.1, 8.6] });
    for (let x = -5; x <= 5.1; x += 1.25) rails.push({ p: [x, y - 0.5, 4.25], s: [0.08, 1.0, 0.08] });
  }
  k.inst(boxGeo(), amber, rails);

  // tower crane: mast at (-7.5, -1)
  const mx = -7.5, mz = -1.2, mw = 1.5, mh = 21, seg = 1.75;
  const lat = [];
  const hw = mw / 2;
  const corners = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
  for (const [cx, cz] of corners) lat.push({ mat: barMat([mx + cx, 0, mz + cz], [mx + cx, mh, mz + cz], 0.24) });
  for (let y = 0; y < mh - 0.01; y += seg) {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      lat.push({ mat: barMat([mx + ax, y + seg, mz + az], [mx + bx, y + seg, mz + bz], 0.12) });
      const flip = (Math.round(y / seg) + i) % 2;
      lat.push({ mat: barMat([mx + (flip ? ax : bx), y, mz + (flip ? az : bz)], [mx + (flip ? bx : ax), y + seg, mz + (flip ? bz : az)], 0.11) });
    }
  }
  // base ballast
  k.box(concDk, 3.2, 0.9, 3.2, mx, 0.45, mz);
  // slewing ring + cab
  const top = mh;
  k.box(amberDk, 2.0, 0.7, 2.0, mx, top + 0.35, mz);
  k.box(amber, 1.4, 1.3, 1.5, mx + 0.4, top - 0.45, mz + 1.55);
  k.box(glass, 1.42, 0.7, 1.3, mx + 0.4, top - 0.35, mz + 1.62);
  // jib: rectangular lattice along +x
  const jy = top + 0.7, jh = 1.2, jw = 1.1, jx0 = mx, jx1 = 12.5;
  const jz = [mz - jw / 2, mz + jw / 2];
  lat.push({ mat: barMat([jx0, jy, jz[0]], [jx1, jy, jz[0]], 0.18) });
  lat.push({ mat: barMat([jx0, jy, jz[1]], [jx1, jy, jz[1]], 0.18) });
  lat.push({ mat: barMat([jx0, jy + jh, mz], [jx1, jy + jh * 0.3, mz], 0.18) });
  const jseg = 1.5;
  for (let x = jx0, i = 0; x < jx1 - 0.01; x += jseg, i++) {
    const x2 = Math.min(x + jseg, jx1);
    const t1 = jy + jh - (jh * 0.7) * (x - jx0) / (jx1 - jx0);
    const t2 = jy + jh - (jh * 0.7) * (x2 - jx0) / (jx1 - jx0);
    for (const z of jz) lat.push({ mat: barMat([i % 2 ? x : x2, jy, z], [i % 2 ? x2 : x, i % 2 ? t2 : t1, mz], 0.1) });
    lat.push({ mat: barMat([x2, jy, jz[0]], [x2, jy, jz[1]], 0.08) });
  }
  // counter-jib to -x
  const cx1 = mx - 7;
  lat.push({ mat: barMat([mx, jy, jz[0]], [cx1, jy, jz[0]], 0.2) });
  lat.push({ mat: barMat([mx, jy, jz[1]], [cx1, jy, jz[1]], 0.2) });
  for (let x = mx - 1.4; x > cx1; x -= 1.4) lat.push({ mat: barMat([x, jy, jz[0]], [x, jy, jz[1]], 0.1) });
  // cat head (A-frame) above the mast
  const apex = [mx, top + 5.5, mz];
  for (const [cx, cz] of corners) lat.push({ mat: barMat([mx + cx * 0.8, top + 0.7, mz + cz * 0.8], apex, 0.16) });
  k.inst(boxGeo(), amber, lat);
  k.box(amberDk, 7.2, 0.12, 1.3, mx - 3.5, jy - 0.02, mz); // walkway of counter-jib
  // counterweights
  k.inst(boxGeo(), conc, [
    { p: [cx1 + 0.8, jy - 0.5, mz], s: [1.4, 1.2, 1.7] },
    { p: [cx1 + 2.25, jy - 0.5, mz], s: [1.4, 1.2, 1.7] },
  ]);
  k.box(cable, 1.4, 0.9, 1.0, mx - 2.3, jy + 0.5, mz); // hoist machinery
  // tie cables
  const ties = [
    { mat: barMat(apex, [jx1 - 4, jy + jh * 0.4, mz], 0.05) },
    { mat: barMat(apex, [mx + 7, jy + jh * 0.85, mz], 0.05) },
    { mat: barMat(apex, [cx1 + 0.3, jy, mz], 0.05) },
  ];
  // trolley + hoist rope + load
  const tx = 2.8, loadY = 12.2;
  k.box(cable, 1.1, 0.35, 1.3, tx, jy - 0.2, mz);
  ties.push({ mat: barMat([tx - 0.15, jy - 0.3, mz], [tx - 0.15, loadY + 2.1, mz], 0.05) });
  ties.push({ mat: barMat([tx + 0.15, jy - 0.3, mz], [tx + 0.15, loadY + 2.1, mz], 0.05) });
  k.box(amber, 0.5, 0.6, 0.35, tx, loadY + 1.9, mz); // hook block
  ties.push({ mat: barMat([tx, loadY + 1.6, mz], [tx - 2.3, loadY + 0.4, mz], 0.05) });
  ties.push({ mat: barMat([tx, loadY + 1.6, mz], [tx + 2.3, loadY + 0.4, mz], 0.05) });
  k.inst(boxGeo(), cable, ties);
  for (let i = 0; i < 3; i++) {
    const b = iBeam(k, steel, 6.0, 0.6, 0.42);
    b.position.set(tx, loadY + 0.1 - (i === 2 ? 0.6 : 0), mz - 0.27 + (i === 2 ? 0.27 : i * 0.54));
  }
  return finish(k, v, 14.5, { yaw: 24, elev: 10, fov: 40, fill: 0.86 }, env);
}

/* ==================================================================== WALL */
function buildWall(v = 0, env = null) {
  const bare = !!(env && env.bare);
  const k = new Kit([0.3, 0.55, 0.3], 0.35);
  const white = k.m('#ffffff', { r: 0.85 });
  const mortar = k.m('#bdb6a8', { r: 1 });
  const footing = k.m('#9a9890', { r: 0.95 });
  const ground = k.m('#6f6252', { r: 1 });
  const pallet = k.m('#c49a5c', { r: 0.85 });
  const palletDk = k.m('#9a7444', { r: 0.85 });
  const tub = k.m('#26282c', { r: 0.6 });
  const steel = k.m('#c7cfd8', { r: 0.3, m: 0.6 });
  const handle = k.m('#a8622e', { r: 0.6 });
  const amber = k.m('#f2a900', { r: 0.5 });
  const R = rng(7);
  const brickCol = () => new THREE.Color().setHSL(0.03 + R() * 0.025, 0.55 + R() * 0.15, 0.4 + R() * 0.09);

  if (!bare) k.box(ground, 4.3, 0.06, 2.3, 0.3, -0.03, 0.35);
  k.box(footing, 3.1, 0.12, 0.42, -0.25, 0.06, 0);

  // wall in running bond, racked back at the right end
  const bw = 0.25, bh = 0.065, bd = 0.12, px = 0.26, py = 0.077;
  const x0 = -1.65, courses = 16, full = 11;
  const bricks = [];
  for (let c = 0; c < courses; c++) {
    const off = (c % 2) * px * 0.5;
    const n = Math.round((full * px - 0.5 * px * Math.max(0, c - 5) - off) / px);
    const y = 0.12 + py * c + bh / 2 + 0.006;
    let xEnd = x0;
    for (let i = 0; i < n; i++) {
      const x = x0 + off + i * px + bw / 2;
      bricks.push({ p: [x, y, 0], s: [bw, bh, bd], c: brickCol() });
      xEnd = x + bw / 2;
    }
    if (off) bricks.push({ p: [x0 + off / 2 - 0.003, y, 0], s: [off - 0.012, bh, bd], c: brickCol() });
    k.box(mortar, xEnd - x0, py, bd - 0.016, (x0 + xEnd) / 2, 0.12 + py * c + py / 2, 0);
  }
  k.inst(boxGeo(), white, bricks);

  // trowel resting on top of the wall
  const blade = geo('trowel', () => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.07); s.lineTo(0.2, -0.045); s.quadraticCurveTo(0.29, 0, 0.2, 0.045); s.lineTo(0, 0.07);
    s.quadraticCurveTo(-0.02, 0, 0, -0.07);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    return g;
  });
  const tr = new THREE.Group();
  const topY = 0.12 + py * courses + 0.006;
  tr.position.set(-0.75, topY + 0.004, 0.02);
  tr.rotation.y = 0.5;
  tr.scale.setScalar(1.5);
  k.mesh(blade, steel, -0.1, 0, 0, tr);
  k.box(steel, 0.015, 0.06, 0.015, -0.08, 0.03, 0, 0, tr);
  const h = k.cyl(handle, 0.022, 0.16, -0.17, 0.065, 0, 8, tr);
  h.rotation.z = Math.PI / 2 - 0.15;
  k.root.add(tr);
  // mortar on the course being laid
  k.box(mortar, 0.7, 0.025, 0.1, -1.15, topY + 0.006, 0);

  // mortar tub
  const tubG = geo('tub', () => new THREE.CylinderGeometry(0.34, 0.27, 0.3, 18, 1, true));
  k.mesh(tubG, k.m('#26282c', { r: 0.6, side: 1 }), -0.75, 0.15, 0.85);
  k.cyl(tub, 0.27, 0.02, -0.75, 0.01, 0.85, 18);
  const lip = k.mesh(geo('tubLip', () => new THREE.TorusGeometry(0.34, 0.022, 4, 18)), tub, -0.75, 0.3, 0.85);
  lip.rotation.x = Math.PI / 2;
  const mortarTop = k.mesh(geo('mortarTop', () => new THREE.SphereGeometry(0.32, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2)), mortar, -0.75, 0.22, 0.85);
  mortarTop.scale.set(1, 0.22, 1);

  // pallet of bricks
  const P = [1.85, 0, 0.45];
  const slats = [];
  for (let i = 0; i < 7; i++) slats.push({ p: [P[0] - 0.48 + i * 0.16, 0.13, P[2]], s: [0.1, 0.022, 1.0] });
  for (const z of [-0.45, 0, 0.45]) slats.push({ p: [P[0], 0.07, P[2] + z], s: [1.0, 0.1, 0.1] });
  for (let i = 0; i < 3; i++) slats.push({ p: [P[0], 0.012, P[2] - 0.4 + i * 0.4], s: [1.0, 0.022, 0.1] });
  k.inst(boxGeo(), pallet, slats.slice(0, 7));
  k.inst(boxGeo(), palletDk, slats.slice(7));
  const stack = [];
  for (let L = 0; L < 8; L++) {
    const y = 0.141 + L * 0.068 + 0.033;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 7; j++) {
      if (L === 7 && i + j * 0.6 > 3.2) continue;
      if (L === 6 && i === 3 && j > 4) continue;
      stack.push({ p: [P[0] - 0.375 + i * 0.25, y, P[2] - 0.42 + j * 0.14], s: [0.245, 0.065, 0.12], c: brickCol() });
    }
  }
  k.inst(boxGeo(), white, stack);
  // spirit level leaning against the wall
  const lvl = k.box(amber, 0.9, 0.06, 0.03, 0.35, 0.42, 0.11);
  lvl.rotation.z = 1.15;
  // a few loose bricks
  k.inst(boxGeo(), white, [
    { p: [0.9, 0.035, 0.6], s: [0.245, 0.065, 0.12], r: [0, 0.4, 0], c: brickCol() },
    { p: [1.05, 0.035, 0.88], s: [0.245, 0.065, 0.12], r: [0, -0.3, 0], c: brickCol() },
  ]);
  return finish(k, v, 2.2, { yaw: 30, elev: 18, fov: 38, fill: 1.2 }, env);
}

/* ================================================================== BLOCKS */
function buildBlocks(v = 0, env = null) {
  const bare = !!(env && env.bare);
  const k = new Kit([0, 1.6, 0], 0.8);
  const white = k.m('#ffffff', { r: 0.95 });
  const steel = k.m('#4f7fb8', { r: 0.45, m: 0.35 });
  const amber = k.m('#f2a900', { r: 0.5, m: 0.1 });
  const plinth = k.m('#43464c', { r: 0.9 });
  const R = rng(11);
  const grey = () => new THREE.Color().setHSL(0.58 - R() * 0.5, 0.04 + R() * 0.04, 0.44 + R() * 0.16);

  if (!bare) k.cyl(plinth, 3.4, 0.16, 0, -0.08, 0, 40);
  // jenga-like pyramid: each layer turns ~90deg (+ jitter) and has fewer blocks
  const blocks = [];
  const bh = 0.46, counts = [6, 5, 5, 4, 3, 2, 1];
  counts.forEach((n, L) => {
    const a = (L % 2 ? Math.PI / 2 : 0) + (R() - 0.5) * 0.35 + L * 0.06;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * 0.6 + (R() - 0.5) * 0.06;
      const along = (R() - 0.5) * 0.25;
      const amberHit = (L === 2 && i === 1) || (L === 4 && i === 2);
      blocks.push({
        p: [ca * along - sa * o, bh / 2 + L * bh, -sa * along - ca * o],
        s: [1.9 - L * 0.08, bh - 0.025, 0.55], r: [0, a + (R() - 0.5) * 0.08, 0],
        c: amberHit ? '#f2a900' : grey(),
      });
    }
  });
  // loose blocks around the base
  const ring = [[2.6, 0.5, 0.2], [2.2, 1.7, 1.1], [-2.5, 1.3, -0.4], [-2.6, -0.8, 0.9], [0.6, -2.6, 0.5], [-1.2, 2.5, 1.6], [2.3, -1.6, -0.7]];
  for (const [x, z, r] of ring) blocks.push({ p: [x, bh / 2, z], s: [1.0, bh - 0.02, 0.5], r: [0, r, 0], c: grey() });
  blocks.push({ p: [2.35, bh * 1.5, 0.75], s: [1.0, bh - 0.02, 0.5], r: [0, 0.9, 0], c: grey() });
  k.inst(boxGeo(), white, blocks);

  // steel beams: two leaning in an X over the pile, one piercing it, one amber on top
  const b1 = iBeam(k, steel, 5.6, 0.36, 0.26);
  b1.position.set(-0.6, 1.75, 0.55); b1.rotation.set(0, 0.35, 0.55);
  const b2 = iBeam(k, steel, 5.6, 0.36, 0.26);
  b2.position.set(0.6, 1.75, 0.65); b2.rotation.set(0, -0.35, -0.55);
  const b3 = iBeam(k, steel, 5.8, 0.32, 0.24);
  b3.position.set(0.2, bh * 2.5, -0.1); b3.rotation.set(0, 1.25, 0.05);
  const b4 = iBeam(k, amber, 3.0, 0.28, 0.22);
  b4.position.set(0, bh * 7 + 0.14, 0); b4.rotation.set(0, 0.5, 0);
  return finish(k, v, 3.5, { yaw: 30, elev: 16, fov: 38, fill: 0.95 }, env);
}

/* =================================================================== TILES */
function buildTiles(v = 0, env = null) {
  const k = new Kit([0.1, 0.2, 0.1], 0.06);
  const white = k.m('#ffffff', { r: 0.4 });
  const screed = k.m('#8e8a83', { r: 1 });
  const glue = k.m('#c9c6bf', { r: 1 });
  const amber = k.m('#f2a900', { r: 0.45, m: 0.15 });
  const steel = k.m('#c3ccd6', { r: 0.3, m: 0.6 });
  const dark = k.m('#2a2d33', { r: 0.6 });
  const red = k.m('#c8452f', { r: 0.5 });
  const bucket = k.m('#e9e6df', { r: 0.6 });
  const R = rng(5);
  const cream = () => new THREE.Color('#ead9bf').offsetHSL(0, 0, (R() - 0.5) * 0.05);
  const terra = () => new THREE.Color('#bd6440').offsetHSL((R() - 0.5) * 0.02, 0, (R() - 0.5) * 0.06);

  const N = 6, t = 0.6, gap = 0.014, x0 = -1.8, z0 = -1.8;
  k.box(screed, 3.9, 0.08, 3.9, 0, -0.04, 0);
  const tiles = [], ridges = [];
  const lifted = new Set(['2,3', '4,1', '1,4']);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = x0 + t / 2 + i * t, z = z0 + t / 2 + j * t;
    const laid = i + j * 0.9 < 6.6 || j === 0;
    const c = (i + j) % 2 ? terra() : cream();
    if (!laid) {
      if (i + j * 0.9 < 7.6) { // fresh adhesive where the next tiles go
        k.box(glue, t - 0.02, 0.012, t - 0.02, x, 0.006, z);
        for (let r = 0; r < 6; r++) ridges.push({ p: [x, 0.016, z - 0.25 + r * 0.1], s: [t - 0.04, 0.012, 0.03] });
      }
      continue;
    }
    if (lifted.has(i + ',' + j)) {
      // tile hinged up on one edge
      const ang = i === 2 ? 0.95 : i === 4 ? 0.5 : 0.3;
      const hx = x - t / 2;
      tiles.push({ p: [hx + Math.cos(ang) * t / 2, 0.02 + Math.sin(ang) * t / 2, z], s: [t - gap, 0.022, t - gap], r: [0, 0, ang], c });
      k.box(glue, t - 0.02, 0.012, t - 0.02, x, 0.006, z);
      continue;
    }
    tiles.push({ p: [x, 0.011, z], s: [t - gap, 0.022, t - gap], c });
  }
  // stack of new tiles
  for (let s = 0; s < 9; s++) tiles.push({ p: [0.45, 0.024 + s * 0.023, 1.45 + s * 0.004], s: [t - gap, 0.022, t - gap], r: [0, 0.18, 0], c: s % 2 ? terra() : cream() });
  // tile on the cutter
  tiles.push({ p: [1.45, 0.165, 0.75], s: [0.58, 0.022, 0.58], r: [0, 0.6, 0], c: cream() });
  k.inst(boxGeo(), white, tiles);
  if (ridges.length) k.inst(boxGeo(), glue, ridges);

  // tile cutter (rotated group)
  const cut = new THREE.Group();
  cut.position.set(1.45, 0, 0.75); cut.rotation.y = 0.6;
  k.box(amber, 1.05, 0.08, 0.36, 0, 0.1, 0, 0, cut);
  k.box(dark, 1.1, 0.06, 0.4, 0, 0.03, 0, 0, cut);
  k.box(dark, 0.06, 0.3, 0.1, -0.5, 0.25, -0.22, 0, cut);
  k.box(dark, 0.06, 0.3, 0.1, 0.5, 0.25, -0.22, 0, cut);
  for (const dz of [-0.25, -0.19]) {
    const rail = k.cyl(steel, 0.016, 1.04, 0, 0.37, dz, 8, cut);
    rail.rotation.z = Math.PI / 2;
  }
  k.box(dark, 0.14, 0.1, 0.14, 0.15, 0.37, -0.22, 0, cut);
  const lever = k.box(red, 0.05, 0.42, 0.05, 0.08, 0.6, -0.22, 0, cut);
  lever.rotation.z = 0.45;
  k.root.add(cut);
  // notched trowel + adhesive bucket
  const tr = new THREE.Group();
  tr.position.set(0.85, 0.03, 0.15); tr.rotation.y = -0.7;
  k.box(steel, 0.28, 0.008, 0.12, 0, 0, 0, 0, tr);
  const th = k.cyl(red, 0.02, 0.14, -0.2, 0.05, 0, 8, tr);
  th.rotation.z = Math.PI / 2 - 0.3;
  k.root.add(tr);
  const bG = geo('bucket', () => new THREE.CylinderGeometry(0.19, 0.16, 0.36, 16));
  k.mesh(bG, bucket, -1.6, 0.18, 1.95);
  k.cyl(glue, 0.175, 0.01, -1.6, 0.361, 1.95, 16);
  k.box(amber, 0.36, 0.08, 0.005, -1.6, 0.2, 2.141);
  return finish(k, v, 2.6, { yaw: 25, elev: 32, fov: 38, fill: 1.2 }, env);
}

/* =================================================================== REBAR */
function buildRebar(v = 0, env = null) {
  const k = new Kit([0, 0.7, 0], 0.25);
  const top = k.m('#4a3a2e', { r: 1 });
  const clay = k.m('#77604c', { r: 1 });
  const lean = k.m('#c4c1ba', { r: 0.95 });
  const ply = k.m('#d9ae5f', { r: 0.8 });
  const stud = k.m('#9c7240', { r: 0.85 });
  const rust = k.m('#e07a36', { r: 0.6, m: 0.2 });
  const conc = k.m('#bdbab3', { r: 0.95 });
  const amber = k.m('#f2a900', { r: 0.5 });
  const white = k.m('#ece8e0', { r: 0.7 });

  const L = 6, W = 3.8, H = 0.8, tw = 0.9;
  const side = (W - tw) / 2;
  for (const s of [-1, 1]) {
    const zc = s * (tw / 2 + side / 2);
    k.box(clay, L, H - 0.15, side, 0, (H - 0.15) / 2, zc);
    k.box(top, L, 0.15, side, 0, H - 0.075, zc);
  }
  k.box(clay, L, 0.15, tw, 0, 0.075, 0);
  k.box(lean, L, 0.06, tw, 0, 0.18, 0);

  // formwork boards above ground on both sides of the trench
  const fz = tw / 2 - 0.02, fh = 0.45;
  // back side fully shuttered, front side only partly (still being set up)
  k.box(ply, L - 0.2, fh, 0.03, 0, H + fh / 2, -fz);
  k.box(ply, 2.4, fh, 0.03, -1.7, H + fh / 2, fz);
  const studs = [], braces = [];
  for (let x = -2.7; x <= 2.71; x += 0.6) for (const s of [-1, 1]) {
    if (s > 0 && x > -0.4) continue;
    studs.push({ p: [x, H + fh / 2 - 0.05, s * (fz + 0.05)], s: [0.06, fh + 0.1, 0.06] });
    braces.push({ mat: barMat([x, H + fh - 0.05, s * (fz + 0.08)], [x, H, s * (fz + 0.6)], 0.05) });
    studs.push({ p: [x, H + 0.08, s * (fz + 0.62)], s: [0.05, 0.25, 0.05] });
  }
  k.inst(boxGeo(), stud, studs);
  k.inst(boxGeo(), stud, braces);
  k.box(stud, L - 0.2, 0.05, 0.05, 0, H + fh + 0.02, -(fz + 0.05));
  k.box(stud, 2.4, 0.05, 0.05, -1.7, H + fh + 0.02, fz + 0.05);
  const loose = k.box(ply, 1.2, 0.03, 0.6, 1.3, H + 0.03, 1.0); loose.rotation.y = 0.2;

  // rebar cage: stirrups + longitudinal bars + starter bars
  const cw = 0.5, y0 = 0.28, y1 = 0.98, bt = 0.038;
  const bars = [];
  for (let x = -2.8; x <= 2.81; x += 0.2) {
    bars.push({ p: [x, y0, 0], s: [bt, bt, cw] }, { p: [x, y1, 0], s: [bt, bt, cw] });
    bars.push({ p: [x, (y0 + y1) / 2, -cw / 2], s: [bt, y1 - y0, bt] }, { p: [x, (y0 + y1) / 2, cw / 2], s: [bt, y1 - y0, bt] });
  }
  for (const y of [y0 + bt, y1 - bt, (y0 + y1) / 2]) for (const z of [-cw / 2 + bt, cw / 2 - bt])
    bars.push({ p: [0, y, z], s: [L - 0.1, bt * 1.2, bt * 1.2] });
  for (let x = -2.4; x <= 2.41; x += 0.8) for (const z of [-cw / 2 + bt, cw / 2 - bt]) {
    bars.push({ p: [x, y0 + 0.95, z], s: [bt * 1.2, 1.9, bt * 1.2] });
    bars.push({ p: [x + 0.12, y0 + bt, z], s: [0.25, bt * 1.2, bt * 1.2] });
  }
  // spare bars on the ground
  for (let i = 0; i < 7; i++) bars.push({ p: [0.3 + i * 0.01, H + 0.03 + (i % 3) * 0.035, -1.25 - i * 0.045], s: [4.2, bt * 1.1, bt * 1.1], r: [0, 0.04, 0] });
  k.inst(boxGeo(), rust, bars);
  const spacers = [];
  for (let x = -2.4; x <= 2.41; x += 1.2) for (const z of [-0.18, 0.18]) spacers.push({ p: [x, 0.25, z], s: [0.08, 0.08, 0.08] });
  k.inst(boxGeo(), conc, spacers);

  // barrier board at the end + string-line pegs
  const bx = 2.2, bz = -1.3;
  k.box(white, 1.4, 0.18, 0.04, bx, H + 0.75, bz);
  const stripes = [];
  for (let i = 0; i < 4; i++) stripes.push({ p: [bx - 0.52 + i * 0.35, H + 0.75, bz + 0.025], s: [0.14, 0.18, 0.01], r: [0, 0, 0.6] });
  k.inst(boxGeo(), k.m('#d8402c', { r: 0.6 }), stripes);
  k.inst(boxGeo(), amber, [
    { mat: barMat([bx - 0.6, H, bz - 0.25], [bx - 0.6, H + 0.85, bz], 0.05) },
    { mat: barMat([bx - 0.6, H, bz + 0.25], [bx - 0.6, H + 0.85, bz], 0.05) },
    { mat: barMat([bx + 0.6, H, bz - 0.25], [bx + 0.6, H + 0.85, bz], 0.05) },
    { mat: barMat([bx + 0.6, H, bz + 0.25], [bx + 0.6, H + 0.85, bz], 0.05) },
    { p: [2.9, H + 0.2, 1.4], s: [0.05, 0.4, 0.05] },
    { p: [-2.9, H + 0.2, 1.4], s: [0.05, 0.4, 0.05] },
    { p: [0, H + 0.3, 1.4], s: [5.8, 0.015, 0.015] },
  ]);
  return finish(k, v, 3.3, { yaw: 30, elev: 40, fov: 38, fill: 1.05 }, env);
}

// v2 composition (CONTRACT-V2 D2). land: manifest landscape ids per layer; place: normalized
// viewport anchor of the object at 16:9 (x centre, y of its base, height as a fraction of the
// viewport height). Extra fields are optional; build() stays the v1 entry point.
export const SCENES = {
  house: { label: 'Családi ház', build: buildHouse, land: { far: 'land-hills-dawn', near: 'land-meadow' }, place: { x: 0.64, base: 0.74, h: 0.40 } },
  crane: { label: 'Toronydaru', build: buildCrane, land: { far: 'land-forest-edge', near: 'land-field' }, place: { x: 0.70, base: 0.76, h: 0.62 } },
  wall: { label: 'Falazás', build: buildWall, land: { far: 'land-lakeside', near: 'land-grass-close' }, place: { x: 0.62, base: 0.78, h: 0.30 } },
  blocks: { label: 'Építőelemek', build: buildBlocks, land: { far: 'land-valley-mist', near: 'land-forest-floor' }, place: { x: 0.66, base: 0.76, h: 0.36 } },
  tiles: { label: 'Burkolás', build: buildTiles, land: null, place: { x: 0.5, base: 0.8, h: 0.5 } },
  rebar: { label: 'Alapozás', build: buildRebar, land: null, place: { x: 0.5, base: 0.8, h: 0.5 } },
};
