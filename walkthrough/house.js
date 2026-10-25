// house.js: Northbeam Builders walkthrough, v2. The house on a dark night stage, built from primitives.
// Contract (v2): export function buildHouse(scene) -> { anchors, update(t), zones }
//  - Geometry is merged per zone per material; every zone owns cloned material instances.
//  - Every mesh carries userData.zone and userData.particleColor, and starts invisible
//    (particles.js dissolves the solids in).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WALL_H = 3.0;
const WALL_T = 0.2;
const IN = 5.9; // interior face of the side walls (|x|)
const OUT = 6.1; // exterior face of the structural walls
const CLAD = 0.05; // facade skin outside the structural walls (exterior zone)
const NIGHT = '#0a0c10';

// ---------------------------------------------------------------- helpers
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Pale oak planks along the canvas' vertical axis (world Z). Canvas = 1.6 m square, 8 planks.
function planksTexture() {
  const S = 1024, n = 8, pw = S / n;
  const c = makeCanvas(S, S), g = c.getContext('2d');
  const r = rng(11);
  const piece = (x, y, h, hue, sat, lig) => {
    g.save();
    g.beginPath();
    g.rect(x, y, pw, h);
    g.clip();
    g.fillStyle = `hsl(${hue},${sat}%,${lig}%)`;
    g.fillRect(x, y, pw, h);
    for (let k = 0; k < 12; k++) {
      const gx = x + r() * pw;
      g.strokeStyle = `hsla(${hue - 4},${sat + 6}%,${lig - 10 - r() * 6}%,${0.08 + r() * 0.12})`;
      g.lineWidth = 0.6 + r() * 1.4;
      g.beginPath();
      g.moveTo(gx, y);
      const amp = 2 + r() * 4, f = 0.004 + r() * 0.01, ph = r() * 6;
      for (let yy = y; yy <= y + h; yy += 16) g.lineTo(gx + Math.sin(yy * f + ph) * amp, yy);
      g.stroke();
    }
    g.strokeStyle = 'rgba(70,50,30,0.35)';
    g.lineWidth = 1.5;
    g.strokeRect(x + 0.75, y + 0.75, pw - 1.5, h - 1.5);
    g.restore();
  };
  for (let i = 0; i < n; i++) {
    const j1 = r() * S;
    const cuts = [j1, j1 + S * (0.4 + r() * 0.25)];
    const lens = [cuts[1] - cuts[0], S - (cuts[1] - cuts[0])];
    for (let k = 0; k < 2; k++) {
      const y0 = cuts[k] % S, h = lens[k];
      const hue = 33 + r() * 5, sat = 30 + r() * 8, lig = 64 + r() * 7;
      piece(i * pw, y0, h, hue, sat, lig);
      piece(i * pw, y0 - S, h, hue, sat, lig); // wrap so the texture tiles
    }
  }
  return toTexture(c);
}

// Large-format pale stone tiles, 2x2 per canvas (canvas = 1.2 m).
function tilesTexture() {
  const S = 512, c = makeCanvas(S, S), g = c.getContext('2d');
  const r = rng(5);
  g.fillStyle = '#a8a196';
  g.fillRect(0, 0, S, S);
  const t = S / 2, grout = 2;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      g.fillStyle = `hsl(36,12%,${80 + r() * 3}%)`;
      g.fillRect(i * t + grout / 2, j * t + grout / 2, t - grout, t - grout);
      for (let k = 0; k < 700; k++) {
        g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '120,110,95'},${r() * 0.05})`;
        g.fillRect(i * t + r() * t, j * t + r() * t, 2, 2);
      }
    }
  }
  return toTexture(c);
}

// Polished concrete with mottling and a saw-cut joint at the canvas edges (canvas = 3 m).
function concreteTexture() {
  const S = 512, c = makeCanvas(S, S), g = c.getContext('2d');
  const r = rng(23);
  g.fillStyle = '#b3afa8';
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 60; k++) {
    const x = r() * S, y = r() * S, rad = 20 + r() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.5;
    grd.addColorStop(0, dark ? 'rgba(90,85,78,0.10)' : 'rgba(235,232,226,0.12)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      g.save();
      g.translate(ox, oy);
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      g.restore();
    }
  }
  for (let k = 0; k < 2500; k++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '70,66,60' : '245,243,238'},${0.08 + r() * 0.12})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  g.fillStyle = 'rgba(60,56,50,0.45)';
  g.fillRect(0, 0, S, 2);
  g.fillRect(0, 0, 2, S);
  return toTexture(c);
}

// Particle colour: the material's base colour (blended toward its emissive for glowing
// materials), lifted so dark materials still read as light on the night stage.
function particleColorOf(mat, override) {
  const c = override ? new THREE.Color(override) : mat.color.clone();
  if (!override && mat.emissive && mat.emissiveIntensity > 0.5 && mat.emissive.getHex() !== 0) {
    c.lerp(mat.emissive, 0.6);
  }
  const hsl = {};
  c.getHSL(hsl);
  if (hsl.l < 0.42) c.setHSL(hsl.h, Math.min(hsl.s, 0.35), 0.42 + hsl.l * 0.15);
  return c;
}

// ---------------------------------------------------------------- build
export function buildHouse(scene) {
  const root = new THREE.Group();
  root.name = 'house';
  scene.add(root);

  // Night stage
  scene.background = new THREE.Color(NIGHT);
  scene.fog = new THREE.Fog(NIGHT, 22, 70);

  // ---------- material palette (templates; each zone gets its own clones)
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
  const floorTex = { hall: tilesTexture(), living: planksTexture(), studio: concreteTexture() };
  floorTex.hall.repeat.set(1 / 1.2, 1 / 1.2); // UVs are world metres (see floor())
  floorTex.living.repeat.set(1 / 1.6, 1 / 1.6);
  floorTex.studio.repeat.set(1 / 3, 1 / 3);
  const M = {
    plaster: std('#e8e2d7', { roughness: 0.95 }), // warm white interior walls
    ceiling: std('#e2dcd1', { roughness: 0.97 }),
    facade: std('#8d8a84', { roughness: 0.9 }), // board-formed concrete skin + gables
    concrete: std('#8a8781', { roughness: 0.88 }), // porch, step, path slabs
    roof: std('#1d2024', { roughness: 0.6, metalness: 0.35 }), // standing-seam zinc
    steel: std('#23272b', { roughness: 0.45, metalness: 0.55 }), // charcoal steel frames, legs
    oak: std('#c8a57a', { roughness: 0.6 }), // pale oak joinery
    lumber: std('#d8bd8f', { roughness: 0.85 }), // raw site timber in the studio
    fabric: std('#6d6862', { roughness: 1 }),
    rug: std('#a99a82', { roughness: 1 }),
    amber: std('#f2a900', { roughness: 0.5 }),
    ceramic: std('#efeae1', { roughness: 0.35 }),
    leaf: std('#2d4229', { roughness: 1 }),
    trunk: std('#3a2e25', { roughness: 1 }),
    lawn: std('#141b13', { roughness: 1 }),
    floorHall: std('#ffffff', { map: floorTex.hall, roughness: 0.45 }),
    floorLiving: std('#ffffff', { map: floorTex.living, roughness: 0.6 }),
    floorStudio: std('#ffffff', { map: floorTex.studio, roughness: 0.32, metalness: 0.05 }),
    // windows seen from outside: warm interior glow
    glassOut: std('#2a1e12', { emissive: '#ffb466', emissiveIntensity: 1.25, roughness: 0.25 }),
    // windows seen from inside: deep night-blue glass
    glassIn: std('#0c121c', { emissive: '#1d3050', emissiveIntensity: 0.55, roughness: 0.14, metalness: 0.3 }),
    glow: std('#fff1dc', { emissive: '#ffd6a0', emissiveIntensity: 2.4 }), // downlight discs, sconces
    shade: std('#f1e3c8', { emissive: '#ffc983', emissiveIntensity: 0.8, roughness: 0.9, side: THREE.DoubleSide }),
  };
  // particle colours for textured materials (texture average, the base colour is white)
  const PC_OVERRIDE = { floorHall: '#d2ccc0', floorLiving: '#c4a27a', floorStudio: '#a8a49d' };
  // [castShadow, receiveShadow]
  const SHADOW = {
    plaster: [true, true], ceiling: [true, true], facade: [true, true], concrete: [false, true],
    roof: [true, true], steel: [true, true], oak: [true, true], lumber: [true, true],
    fabric: [true, true], rug: [false, true], amber: [true, true], ceramic: [true, true],
    leaf: [true, true], trunk: [true, true], lawn: [false, true],
    floorHall: [false, true], floorLiving: [false, true], floorStudio: [false, true],
    glassOut: [false, false], glassIn: [false, false], glow: [false, false], shade: [false, false],
  };

  // ---------- geometry buckets: `${zone}|${material}` -> geometries (merged at the end)
  const buckets = {};
  let Z = 'exterior'; // current zone for the helpers below
  const _m = new THREE.Matrix4();
  const _e = new THREE.Euler();
  const push = (key, geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    if (rx || ry || rz) geo.applyMatrix4(_m.makeRotationFromEuler(_e.set(rx, ry, rz)));
    geo.translate(x, y, z);
    (buckets[`${Z}|${key}`] ||= []).push(geo);
  };
  const box = (key, w, h, d, x, y, z, rx, ry, rz) => push(key, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  const cyl = (key, rt, rb, h, seg, x, y, z, open = false) =>
    push(key, new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), x, y, z);

  // ---------- walls with openings (box segments, no CSG)
  // Wall along X centred on depth z, thickness t, spanning [x0, x1]. openings {a0,a1,y0,y1} in x.
  function wallX(key, z, t, x0, x1, openings) {
    const ops = [...openings].sort((a, b) => a.a0 - b.a0);
    let cur = x0;
    for (const o of ops) {
      if (o.a0 > cur) box(key, o.a0 - cur, WALL_H, t, (cur + o.a0) / 2, WALL_H / 2, z);
      const w = o.a1 - o.a0, cx = (o.a0 + o.a1) / 2;
      if (o.y0 > 0) box(key, w, o.y0, t, cx, o.y0 / 2, z);
      box(key, w, WALL_H - o.y1, t, cx, (WALL_H + o.y1) / 2, z);
      cur = o.a1;
    }
    if (cur < x1) box(key, x1 - cur, WALL_H, t, (cur + x1) / 2, WALL_H / 2, z);
  }
  // Wall along Z centred on x, thickness t, spanning [z0, z1]. openings in z.
  function wallZ(key, x, t, z0, z1, openings) {
    const ops = [...openings].sort((a, b) => a.a0 - b.a0);
    let cur = z0;
    for (const o of ops) {
      if (o.a0 > cur) box(key, t, WALL_H, o.a0 - cur, x, WALL_H / 2, (cur + o.a0) / 2);
      const d = o.a1 - o.a0, cz = (o.a0 + o.a1) / 2;
      if (o.y0 > 0) box(key, t, o.y0, d, x, o.y0 / 2, cz);
      box(key, t, WALL_H - o.y1, d, x, (WALL_H + o.y1) / 2, cz);
      cur = o.a1;
    }
    if (cur < z1) box(key, t, WALL_H, z1 - cur, x, WALL_H / 2, (cur + z1) / 2);
  }
  // Glazing + slim steel frame inside an opening, at depth z (X walls) or x (Z walls).
  // `sill` adds an oak sill on the room side (dir = room direction along the wall normal).
  function windowX(glass, z, x0, x1, y0, y1, depth, sillDir = 0) {
    const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    box(glass, w, h, 0.02, cx, cy, z);
    box('steel', w, 0.05, depth, cx, y1 - 0.025, z);
    box('steel', w, 0.05, depth, cx, y0 + 0.025, z);
    box('steel', 0.05, h, depth, x0 + 0.025, cy, z);
    box('steel', 0.05, h, depth, x1 - 0.025, cy, z);
    if (w > 1.2) box('steel', 0.035, h, depth * 0.6, cx, cy, z);
    if (sillDir) box('oak', w + 0.1, 0.03, 0.2, cx, y0 - 0.015, z + sillDir * 0.08);
  }
  function windowZ(glass, x, z0, z1, y0, y1, depth, sillDir = 0) {
    const d = z1 - z0, h = y1 - y0, cz = (z0 + z1) / 2, cy = (y0 + y1) / 2;
    box(glass, 0.02, h, d, x, cy, cz);
    box('steel', depth, 0.05, d, x, y1 - 0.025, cz);
    box('steel', depth, 0.05, d, x, y0 + 0.025, cz);
    box('steel', depth, h, 0.05, x, cy, z0 + 0.025);
    box('steel', depth, h, 0.05, x, cy, z1 - 0.025);
    if (d > 1.2) box('steel', depth * 0.6, h, 0.035, x, cy, cz);
    if (sillDir) box('oak', 0.2, 0.03, d + 0.1, x + sillDir * 0.08, y0 - 0.015, cz);
  }

  // Openings (shared by the structural walls and the facade skin)
  const WIN = { y0: 0.9, y1: 2.3 };
  const DOOR = { a0: -0.6, a1: 0.6, y0: 0, y1: 2.2 };
  const FRONT_WINS = [{ a0: -4.4, a1: -2.2, ...WIN }, { a0: 2.2, a1: 4.4, ...WIN }];
  const BACK_WIN = { a0: -0.5, a1: 0.5, y0: 0.5, y1: 2.7 };
  const STUDIO_WIN = { a0: -9.6, a1: -7.4, y0: 1.1, y1: 2.4 };
  const HALL_WIN = { a0: 2.2, a1: 3.8, ...WIN };
  const IDOOR = { a0: -1, a1: 1, y0: 0, y1: 2.4 };
  const CZ = OUT + CLAD / 2; // facade skin centre line (|x| or z)

  // ================================================================ EXTERIOR
  Z = 'exterior';
  // Facade skin: board-formed concrete just outside the structural walls, same openings.
  wallX('facade', CZ, CLAD, -OUT - CLAD, OUT + CLAD, [DOOR, ...FRONT_WINS]);
  wallX('facade', -12 - WALL_T / 2 - CLAD / 2, CLAD, -OUT - CLAD, OUT + CLAD, [BACK_WIN]);
  wallZ('facade', -CZ, CLAD, -12.1, 6.1, [STUDIO_WIN]);
  wallZ('facade', CZ, CLAD, -12.1, 6.1, [STUDIO_WIN, HALL_WIN]);
  // Glowing glazing + steel frames flush with the skin
  FRONT_WINS.forEach((o) => windowX('glassOut', CZ, o.a0, o.a1, o.y0, o.y1, 0.1));
  windowX('glassOut', -12 - WALL_T / 2 - CLAD / 2, BACK_WIN.a0, BACK_WIN.a1, BACK_WIN.y0, BACK_WIN.y1, 0.1);
  windowZ('glassOut', -CZ, STUDIO_WIN.a0, STUDIO_WIN.a1, STUDIO_WIN.y0, STUDIO_WIN.y1, 0.1);
  windowZ('glassOut', CZ, STUDIO_WIN.a0, STUDIO_WIN.a1, STUDIO_WIN.y0, STUDIO_WIN.y1, 0.1);
  windowZ('glassOut', CZ, HALL_WIN.a0, HALL_WIN.a1, HALL_WIN.y0, HALL_WIN.y1, 0.1);
  // Front door frame (steel) on the facade
  box('steel', 0.06, 2.2, 0.12, -0.57, 1.1, CZ);
  box('steel', 0.06, 2.2, 0.12, 0.57, 1.1, CZ);
  box('steel', 1.2, 0.06, 0.12, 0, 2.17, CZ);
  // Steel plinth band
  const PZ = OUT + CLAD + 0.015;
  box('steel', 0.03, 0.18, 2 * PZ, -PZ, 0.07, -3);
  box('steel', 0.03, 0.18, 2 * PZ, PZ, 0.07, -3);
  box('steel', 2 * PZ, 0.18, 0.03, 0, 0.07, -12 - WALL_T / 2 - CLAD - 0.015);
  box('steel', PZ - 0.6, 0.18, 0.03, -(PZ + 0.6) / 2, 0.07, PZ);
  box('steel', PZ - 0.6, 0.18, 0.03, (PZ + 0.6) / 2, 0.07, PZ);

  // Roof: gable, ridge along Z, thin standing-seam zinc + ridge cap
  const run = 6.5, rise = 2.4, ang = Math.atan2(rise, run), slope = Math.hypot(run, rise) + 0.05;
  box('roof', slope, 0.14, 19.0, -run / 2, 4.1, -3, 0, 0, ang);
  box('roof', slope, 0.14, 19.0, run / 2, 4.1, -3, 0, 0, -ang);
  box('steel', 0.24, 0.08, 19.0, 0, 5.32, -3);
  // Gable ends in the facade concrete, flush with the skin
  {
    const s = new THREE.Shape();
    const hw = OUT + CLAD;
    s.moveTo(-hw, WALL_H);
    s.lineTo(hw, WALL_H);
    s.lineTo(0, 4.1 + (run / 2) * Math.tan(ang));
    s.closePath();
    const depth = WALL_T + CLAD;
    for (const z0 of [IN, -12 - WALL_T / 2 - CLAD]) {
      push('facade', new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }), 0, 0, z0);
    }
  }

  // Ground: a lawn disc that melts into the fog, with the house footprint cut out
  {
    const R = 22, CZL = -1; // centre z
    const s = new THREE.Shape();
    s.absarc(0, -CZL, R, 0, Math.PI * 2, false); // shape y = -world z
    const hole = new THREE.Path();
    const hx = OUT + CLAD, z0 = -12 - WALL_T / 2 - CLAD, z1 = OUT + CLAD;
    hole.moveTo(-hx, -z1);
    hole.lineTo(-hx, -z0);
    hole.lineTo(hx, -z0);
    hole.lineTo(hx, -z1);
    hole.closePath();
    s.holes.push(hole);
    const g = new THREE.ShapeGeometry(s, 40);
    g.rotateX(-Math.PI / 2);
    push('lawn', g, 0, -0.01, 0);
  }
  // Porch, step, stepping-slab path
  box('concrete', 3.0, 0.1, 1.6, 0, 0.05, 6.95);
  box('concrete', 2.0, 0.05, 0.5, 0, 0.025, 8.0);
  for (let z = 8.7; z <= 20.5; z += 0.8) box('concrete', 1.5, 0.04, 0.6, 0, 0.0, z);
  // Floating steel canopy with an amber-warm LED line underneath, wall sconces
  box('steel', 2.6, 0.08, 1.3, 0, 2.55, 6.8);
  box('glow', 2.3, 0.012, 0.03, 0, 2.505, 7.35);
  box('glow', 0.07, 0.24, 0.05, -0.95, 1.95, OUT + CLAD + 0.025);
  box('glow', 0.07, 0.24, 0.05, 0.95, 1.95, OUT + CLAD + 0.025);
  // Clipped hedges under the front windows, a few trees
  box('leaf', 4.0, 0.55, 0.7, -3.8, 0.275, 6.6);
  box('leaf', 4.0, 0.55, 0.7, 3.8, 0.275, 6.6);
  for (const [x, z, s] of [[-10, 9, 1.2], [-13, -4, 1.4], [11, 12, 1.1], [13, -8, 1.5], [-9, -18, 1.3], [7, -19, 1.2], [-15, 12, 1.0], [17, 3, 1.3]]) {
    cyl('trunk', 0.1 * s, 0.14 * s, 2.2 * s, 7, x, 1.1 * s, z);
    const c = new THREE.SphereGeometry(1.4 * s, 10, 7);
    c.scale(1, 1.25, 1);
    push('leaf', c, x, 2.9 * s, z);
  }

  // ================================================================ ROOMS
  // Structural walls: plaster. Side walls are split per room; boundary walls go to their +Z room.
  // Skirting, trims and inner glazing travel with the wall they're fixed to.
  const SK_H = 0.1, SK_T = 0.02;
  const skirtX = (zFace, dir, x0, x1) =>
    box('steel', x1 - x0, SK_H, SK_T, (x0 + x1) / 2, SK_H / 2, zFace + dir * SK_T / 2);
  const skirtZ = (xFace, dir, z0, z1) =>
    box('steel', SK_T, SK_H, z1 - z0, xFace + dir * SK_T / 2, SK_H / 2, (z0 + z1) / 2);
  const doorTrim = (z) => {
    box('steel', 0.04, 2.4, 0.22, -0.98, 1.2, z);
    box('steel', 0.04, 2.4, 0.22, 0.98, 1.2, z);
    box('steel', 2.0, 0.04, 0.22, 0, 2.38, z);
    box('oak', 2.0, 0.012, 0.2, 0, 0.006, z);
  };
  const ceiling = (z0, z1) => {
    const g = new THREE.PlaneGeometry(IN * 2, z1 - z0);
    g.rotateX(Math.PI / 2); // faces down
    push('ceiling', g, 0, 2.98, (z0 + z1) / 2);
  };
  const floor = (key, z0, z1) => {
    const g = new THREE.PlaneGeometry(IN * 2, z1 - z0);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.003, (z0 + z1) / 2);
    // world-metre UVs so the texture scale is independent of the room size
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
    push(key, g, 0, 0, 0);
  };
  const downlight = (x, z) => cyl('glow', 0.07, 0.07, 0.012, 14, x, 2.974, z);

  // ---------------------------------------------------------------- HALL z∈[0,6]
  Z = 'hall';
  wallX('plaster', 6, WALL_T, -IN, IN, [DOOR, ...FRONT_WINS]); // front wall (inner face)
  wallX('plaster', 0, WALL_T, -IN, IN, [IDOOR]); // boundary wall z=0
  wallZ('plaster', -6, WALL_T, 0, 6.1, []);
  wallZ('plaster', 6, WALL_T, 0, 6.1, [HALL_WIN]);
  FRONT_WINS.forEach((o) => windowX('glassIn', 6, o.a0, o.a1, o.y0, o.y1, 0.2, -1));
  windowZ('glassIn', 6, HALL_WIN.a0, HALL_WIN.a1, HALL_WIN.y0, HALL_WIN.y1, 0.2, -1);
  // inner door frame, threshold, open amber door leaf (swung inward against the right reveal)
  box('steel', 0.05, 2.2, 0.2, -0.575, 1.1, 6);
  box('steel', 0.05, 2.2, 0.2, 0.575, 1.1, 6);
  box('steel', 1.2, 0.05, 0.2, 0, 2.175, 6);
  box('steel', 1.2, 0.02, 0.24, 0, 0.01, 6);
  box('amber', 0.045, 2.14, 1.12, 0.63, 1.08, 5.32);
  box('steel', 0.03, 0.03, 0.16, 0.67, 1.0, 4.86);
  doorTrim(0);
  skirtX(5.9, -1, -IN, -0.6); skirtX(5.9, -1, 0.6, IN);
  skirtX(0.1, 1, -IN, -1); skirtX(0.1, 1, 1, IN);
  skirtX(-0.1, -1, -IN, -1); skirtX(-0.1, -1, 1, IN);
  skirtZ(-IN, 1, 0.1, 5.9); skirtZ(IN, -1, 0.1, 5.9);
  floor('floorHall', 0.1, 5.9);
  ceiling(0, 5.9);
  downlight(-3.0, 3.0); downlight(-1.6, 1.4); downlight(-1.6, 4.6);
  // round oak dining table + 3 chairs by the window, bench, plant
  cyl('oak', 0.6, 0.6, 0.04, 28, 3.6, 0.75, 3.0);
  cyl('steel', 0.05, 0.05, 0.7, 10, 3.6, 0.38, 3.0);
  cyl('steel', 0.28, 0.3, 0.03, 20, 3.6, 0.015, 3.0);
  const chair = (cx, cz, a) => {
    const P = (ox, oz) => [cx + ox * Math.cos(a) + oz * Math.sin(a), cz - ox * Math.sin(a) + oz * Math.cos(a)];
    let [x, z] = P(0, 0);
    box('oak', 0.45, 0.04, 0.45, x, 0.46, z, 0, a, 0);
    [x, z] = P(0, -0.21);
    box('oak', 0.45, 0.38, 0.035, x, 0.7, z, 0, a, 0);
    for (const [ox, oz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
      [x, z] = P(ox, oz);
      box('steel', 0.03, 0.44, 0.03, x, 0.22, z, 0, a, 0);
    }
  };
  chair(3.6, 2.15, 0);
  chair(3.6, 3.85, Math.PI);
  chair(2.75, 3.0, Math.PI / 2);
  box('oak', 1.4, 0.06, 0.4, -4.4, 0.45, 5.68); // bench
  box('steel', 0.04, 0.42, 0.38, -5.0, 0.21, 5.68);
  box('steel', 0.04, 0.42, 0.38, -3.8, 0.21, 5.68);
  cyl('ceramic', 0.22, 0.17, 0.45, 16, 5.25, 0.225, 5.25); // plant
  {
    const f = new THREE.SphereGeometry(0.42, 10, 7);
    f.scale(1, 1.3, 1);
    push('leaf', f, 5.25, 0.9, 5.25);
  }
  // pendant over the table (static): ceiling rose, cord, steel shade, glowing diffuser
  cyl('steel', 0.06, 0.06, 0.03, 14, 3.6, 2.965, 3.0);
  cyl('steel', 0.006, 0.006, 0.84, 5, 3.6, 2.53, 3.0);
  cyl('steel', 0.1, 0.28, 0.26, 20, 3.6, 1.98, 3.0);
  cyl('glow', 0.255, 0.255, 0.01, 20, 3.6, 1.846, 3.0);

  // ---------------------------------------------------------------- LIVING z∈[-6,0]
  Z = 'living';
  wallX('plaster', -6, WALL_T, -IN, IN, [IDOOR]); // boundary wall z=-6
  wallZ('plaster', -6, WALL_T, -6, 0, []);
  wallZ('plaster', 6, WALL_T, -6, 0, []);
  doorTrim(-6);
  skirtX(-5.9, 1, -IN, -1); skirtX(-5.9, 1, 1, IN);
  skirtX(-6.1, -1, -IN, -1); skirtX(-6.1, -1, 1, IN);
  skirtZ(-IN, 1, -5.9, -0.1); skirtZ(IN, -1, -5.9, -0.1);
  floor('floorLiving', -5.9, -0.1);
  ceiling(-6, 0);
  downlight(-3.0, -3.0); downlight(3.0, -3.0); downlight(-3.5, -4.9);
  // sofa against the z=-6 wall, coffee table on a rug, sideboard, floor lamp
  box('rug', 2.8, 0.012, 2.0, -3.5, 0.009, -4.6);
  box('fabric', 2.4, 0.36, 0.95, -3.5, 0.26, -5.42);
  box('fabric', 2.4, 0.5, 0.2, -3.5, 0.69, -5.78);
  box('fabric', 0.2, 0.62, 0.95, -4.6, 0.39, -5.42);
  box('fabric', 0.2, 0.62, 0.95, -2.4, 0.39, -5.42);
  box('fabric', 1.0, 0.12, 0.72, -4.0, 0.5, -5.3);
  box('fabric', 1.0, 0.12, 0.72, -3.0, 0.5, -5.3);
  box('amber', 0.4, 0.36, 0.12, -4.25, 0.72, -5.55, -0.25, 0.15, 0);
  for (const [x, z] of [[-4.62, -5.84], [-2.38, -5.84], [-4.62, -4.99], [-2.38, -4.99]]) box('steel', 0.05, 0.08, 0.05, x, 0.04, z);
  box('oak', 1.1, 0.05, 0.6, -3.5, 0.4, -4.1);
  for (const [x, z] of [[-4.0, -4.35], [-3.0, -4.35], [-4.0, -3.85], [-3.0, -3.85]]) box('steel', 0.035, 0.38, 0.035, x, 0.19, z);
  box('oak', 3.0, 0.6, 0.45, 3.7, 0.38, -0.335); // oak sideboard on a steel plinth
  box('steel', 2.9, 0.08, 0.4, 3.7, 0.04, -0.335);
  box('steel', 3.04, 0.03, 0.47, 3.7, 0.695, -0.335);
  cyl('ceramic', 0.08, 0.06, 0.26, 14, 4.6, 0.84, -0.33);
  box('amber', 0.06, 0.24, 0.18, 2.6, 0.83, -0.33);
  box('ceramic', 0.06, 0.22, 0.18, 2.68, 0.82, -0.33);
  box('steel', 0.06, 0.26, 0.18, 2.76, 0.84, -0.33);
  cyl('steel', 0.18, 0.18, 0.03, 18, 5.3, 0.015, -5.3); // floor lamp
  cyl('steel', 0.015, 0.015, 1.5, 6, 5.3, 0.78, -5.3);
  cyl('shade', 0.17, 0.22, 0.3, 18, 5.3, 1.62, -5.3, true);

  // ---------------------------------------------------------------- STUDIO z∈[-12,-6]
  Z = 'studio';
  wallX('plaster', -12, WALL_T, -IN, IN, [BACK_WIN]); // back wall
  wallZ('plaster', -6, WALL_T, -12.1, -6, [STUDIO_WIN]);
  wallZ('plaster', 6, WALL_T, -12.1, -6, [STUDIO_WIN]);
  windowX('glassIn', -12, BACK_WIN.a0, BACK_WIN.a1, BACK_WIN.y0, BACK_WIN.y1, 0.2, 1);
  windowZ('glassIn', -6, STUDIO_WIN.a0, STUDIO_WIN.a1, STUDIO_WIN.y0, STUDIO_WIN.y1, 0.2, 1);
  windowZ('glassIn', 6, STUDIO_WIN.a0, STUDIO_WIN.a1, STUDIO_WIN.y0, STUDIO_WIN.y1, 0.2, -1);
  skirtX(-11.9, 1, -IN, IN);
  skirtZ(-IN, 1, -11.9, -6.1); skirtZ(IN, -1, -11.9, -6.1);
  floor('floorStudio', -11.9, -6.1);
  ceiling(-12, -6);
  downlight(0, -8.0); downlight(-3.0, -10.4); downlight(3.0, -10.4);
  // workbench under the left window, sawhorses with a plank, timber stack
  box('oak', 0.8, 0.06, 2.2, -5.45, 0.9, -8.5);
  box('oak', 0.75, 0.03, 2.1, -5.45, 0.25, -8.5);
  for (const [x, z] of [[-5.8, -9.55], [-5.1, -9.55], [-5.8, -7.45], [-5.1, -7.45]]) box('steel', 0.06, 0.87, 0.06, x, 0.435, z);
  box('amber', 0.22, 0.2, 0.45, -5.4, 1.03, -9.1); // toolbox
  box('steel', 0.18, 0.1, 0.12, -5.12, 0.98, -8.3); // vise
  push('amber', new THREE.SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), -5.4, 0.93, -7.85); // hard hat
  const sawhorse = (x, z) => {
    box('lumber', 0.09, 0.09, 0.9, x, 0.72, z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('lumber', 0.05, 0.76, 0.05, x + sx * 0.12, 0.36, z + sz * 0.36, 0, 0, sx * 0.3);
    box('lumber', 0.3, 0.04, 0.03, x, 0.3, z - 0.36);
    box('lumber', 0.3, 0.04, 0.03, x, 0.3, z + 0.36);
  };
  sawhorse(2.8, -7.3);
  sawhorse(4.6, -7.3);
  box('lumber', 2.6, 0.045, 0.3, 3.7, 0.79, -7.3);
  {
    const sx = 5.2, sz = -9.0, L = 2.4;
    box('steel', 1.1, 0.08, 0.08, sx, 0.04, sz - 0.9); // bearers
    box('steel', 1.1, 0.08, 0.08, sx, 0.04, sz + 0.9);
    let y = 0.08;
    for (let layer = 0; layer < 4; layer++) {
      const n = layer === 3 ? 3 : 5;
      for (let i = 0; i < n; i++) box('lumber', 0.18, 0.045, L - (layer % 2) * 0.1, sx - 0.4 + i * 0.2, y + 0.0225, sz);
      y += 0.045;
      if (layer < 3) {
        box('oak', 1.02, 0.025, 0.05, sx, y + 0.0125, sz - 0.9);
        box('oak', 1.02, 0.025, 0.05, sx, y + 0.0125, sz + 0.9);
        y += 0.025;
      }
    }
  }

  // ---------- merge: one mesh per zone per material, each zone with cloned materials
  const zones = { exterior: [], hall: [], living: [], studio: [] };
  const PC = {};
  for (const [key, mat] of Object.entries(M)) PC[key] = particleColorOf(mat, PC_OVERRIDE[key]);
  for (const [bucketKey, geos] of Object.entries(buckets)) {
    const [zone, key] = bucketKey.split('|');
    // mergeGeometries needs all-indexed or all-non-indexed (ExtrudeGeometry is non-indexed)
    const list = geos.some((g) => !g.index) ? geos.map((g) => (g.index ? g.toNonIndexed() : g)) : geos;
    const merged = mergeGeometries(list, false);
    new Set([...geos, ...list]).forEach((g) => g.dispose());
    merged.computeBoundingSphere();
    const mat = M[key].clone();
    mat.name = `${zone}-${key}`;
    const mesh = new THREE.Mesh(merged, mat);
    const [cast, receive] = SHADOW[key] || [false, false];
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.name = `house-${zone}-${key}`;
    mesh.visible = false; // particles.js dissolves the solids in
    mesh.userData.zone = zone;
    mesh.userData.particleColor = PC[key].clone();
    zones[zone].push(mesh);
    root.add(mesh);
  }
  Object.values(M).forEach((m) => m.dispose()); // templates are never rendered

  // ---------- lights (not part of any zone). Shadows: moon + studio spot only.
  // Night ambient: cool from above, warm bounce from below (this is what lights the ceilings).
  const hemi = new THREE.HemisphereLight('#5e6880', '#5a4e44', 1.7);
  root.add(hemi);

  const moon = new THREE.DirectionalLight('#9fb6dc', 0.9);
  moon.position.set(-14, 22, 18);
  moon.target.position.set(0, 0, -3);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 80 });
  moon.shadow.bias = -0.0005;
  moon.shadow.normalBias = 0.03;
  root.add(moon, moon.target);

  const WARM = '#ffcf98';
  // Wall-washers: aimed from the ceiling at each board wall, so no light lands on the ceiling.
  const washer = (x, z, tx, tz, intensity, angle = 0.62, color = WARM) => {
    const l = new THREE.SpotLight(color, intensity, 6.5, angle, 0.85, 2);
    l.position.set(x, 2.9, z);
    l.target.position.set(tx, 1.35, tz);
    root.add(l, l.target);
    return l;
  };
  washer(-3.0, 3.0, -IN, 3.0, 26); // about
  washer(-3.0, -3.0, -IN, -3.0, 14); // process: glossy whiteboard, a brighter wash blooms into a hot spot
  washer(3.0, -3.0, IN, -3.0, 30); // services
  // Studio: one shadowed spot washing the whole back wall (projects + contact)
  const studioSpot = new THREE.SpotLight('#ffd8a8', 48, 10, 0.95, 0.75, 2);
  studioSpot.position.set(0, 2.88, -8.0);
  studioSpot.target.position.set(0, 1.2, -11.9);
  studioSpot.castShadow = true;
  studioSpot.shadow.mapSize.set(1024, 1024);
  studioSpot.shadow.bias = -0.0004;
  studioSpot.shadow.normalBias = 0.02;
  studioSpot.shadow.camera.near = 0.3;
  studioSpot.shadow.camera.far = 12;
  root.add(studioSpot, studioSpot.target);

  // Warm pools: pendant over the hall table, the living floor lamp, and one wide downward
  // fill per room. Fills point down from the ceiling, so the ceiling itself only gets the
  // soft hemisphere bounce instead of a hot spot.
  const pendantLight = new THREE.SpotLight('#ffc98a', 9, 4, 1.0, 1, 2);
  pendantLight.position.set(3.6, 1.83, 3.0);
  pendantLight.target.position.set(3.6, 0, 3.0);
  root.add(pendantLight, pendantLight.target);
  const lamp = new THREE.PointLight('#ffc27a', 2.2, 5, 2);
  lamp.position.set(5.3, 1.5, -5.3);
  root.add(lamp);
  const fill = (x, z, intensity) => {
    const l = new THREE.SpotLight('#ffd9b0', intensity, 9, 1.45, 1, 2);
    l.position.set(x, 2.9, z);
    l.target.position.set(x, 0, z);
    root.add(l, l.target);
  };
  fill(0.6, 3.0, 14);
  fill(0, -2.8, 14);
  fill(0, -9.0, 16);
  // Porch: warm light under the canopy for the facade
  const porch = new THREE.PointLight('#ffc98a', 4, 7, 2);
  porch.position.set(0, 2.3, 7.2);
  root.add(porch);

  // ---------- board anchors (board centre, 0.12 m off the wall face, +Z normal into the room)
  const OFF = 0.12;
  const sideX = IN - OFF; // 5.78
  const backZ = -12 + WALL_T / 2 + OFF; // -11.78
  const anchors = {
    about: { position: new THREE.Vector3(-sideX, 1.6, 3), rotationY: Math.PI / 2, width: 2.0, height: 1.4 },
    process: { position: new THREE.Vector3(-sideX, 1.6, -3), rotationY: Math.PI / 2, width: 2.4, height: 1.5 },
    services: { position: new THREE.Vector3(sideX, 1.6, -3), rotationY: -Math.PI / 2, width: 2.4, height: 1.5 },
    projects: { position: new THREE.Vector3(-2.5, 1.6, backZ), rotationY: 0, width: 2.4, height: 1.5 },
    contact: { position: new THREE.Vector3(2.5, 1.6, backZ), rotationY: 0, width: 2.4, height: 1.5 },
  };

  // Geometry is merged and static, so the only ambient motion is a faint breathing of the
  // pendant and floor-lamp pools.
  const pendantBase = pendantLight.intensity, lampBase = lamp.intensity;
  function update(t) {
    const b = 1 + Math.sin(t * 0.6) * 0.03;
    pendantLight.intensity = pendantBase * b;
    lamp.intensity = lampBase * (2 - b);
  }

  return { anchors, update, zones };
}
