// camera.js: scroll-driven first-person camera rig (Animation agent), v2.
// createCameraRig(camera) -> { update(progress, dt), stops, getMix(progress), getVelocity() }
//
// Position is a pure function of progress: a timeline of "hold" segments
// (stationary, square to a board) and "move" segments (centripetal CatmullRom
// curves walked by arc length at an even pace, easing only in the first/last 15%).
// The look target (yaw/pitch) is also a pure function of progress, precomputed into
// a table and rate-limited so it turns at a steady speed. The camera's actual
// yaw/pitch follow that target through critically damped springs (dt-based), with
// a lag clamp, so at rest they converge exactly onto the target (board-facing at holds).
import * as THREE from 'three';

const EYE = 1.65;
const MIN_D = 1.6;            // never closer than this to a board
const RAMP = 0.15;            // ease-in/out fraction at each end of a move
const LOOK_AHEAD = 3.0;       // metres along the path the walker looks toward
const LOOK_OUT = 0.35;        // look leaves the previous board over the first 35% of a move
const LOOK_IN = 0.4;          // ...and settles on the next board over the last 40%
const OUTSIDE_W = 0.03;       // opening hold (stop t = 0)
const HOLD_W = 0.09;          // each board hold
const TURN_COST = 0.06;       // metres of walking "effort" per degree of net turn: the walker slows a little in moves that turn a lot (the about-face)
const RATE_CAP = 6;           // target look change, degrees per 1% progress (raised only where a hold-to-hold turn needs more)
const HALF_LIFE = 0.35;       // spring half-life, seconds
const OMEGA = 1.6783 / HALF_LIFE; // critically damped: (1 + wt) e^-wt = 0.5 at t = half-life
const MAX_LAG = THREE.MathUtils.degToRad(25);
const BOB_AMP = 0.012;        // metres
const ROLL_AMP = THREE.MathUtils.degToRad(0.3);
const STRIDE = 0.8;           // metres per bob cycle (roll sways once per two)
// bob + roll are the classic motion-sickness triggers; drop them for reduced-motion users
const REDUCE_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const VEL_TAU = 0.15;         // seconds, velocity smoothing
const TABLE_N = 5000;         // look-table resolution over progress 0..1
const REF_ASPECT = 16 / 9;    // progress allocation (and stops) use this aspect
const REF_FOV = 55;

// Board anchors from CONTRACT.md (centre already 0.12 m off the wall).
const BOARDS = {
  about:    { pos: new THREE.Vector3(-5.78, 1.6, 3),      normal: new THREE.Vector3(1, 0, 0),  width: 2.0, maxD: 5.0 },
  process:  { pos: new THREE.Vector3(-5.78, 1.6, -3),     normal: new THREE.Vector3(1, 0, 0),  width: 2.4, maxD: 5.0 },
  services: { pos: new THREE.Vector3(5.78, 1.6, -3),      normal: new THREE.Vector3(-1, 0, 0), width: 2.4, maxD: 5.0 },
  // back-wall boards: cap keeps the eye >= ~1 m clear of the z=-6 wall
  projects: { pos: new THREE.Vector3(-2.5, 1.6, -11.78),  normal: new THREE.Vector3(0, 0, 1),  width: 2.4, maxD: 4.6 },
  contact:  { pos: new THREE.Vector3(2.5, 1.6, -11.78),   normal: new THREE.Vector3(0, 0, 1),  width: 2.4, maxD: 4.6 },
};
const START = new THREE.Vector3(0, EYE, 18);
const DOOR_TARGET = new THREE.Vector3(0, 1.45, 6);

const TIMELINE = [
  { type: 'hold', id: 'outside', w: OUTSIDE_W },
  { type: 'move', from: 'outside', to: 'about' },
  { type: 'hold', id: 'about', w: HOLD_W },
  { type: 'move', from: 'about', to: 'process' },
  { type: 'hold', id: 'process', w: HOLD_W },
  { type: 'move', from: 'process', to: 'services' },  // wide arc through the room, turning right via -Z
  { type: 'hold', id: 'services', w: HOLD_W },
  { type: 'move', from: 'services', to: 'projects' },
  { type: 'hold', id: 'projects', w: HOLD_W },
  { type: 'move', from: 'projects', to: 'contact', ahead: 0.35 }, // sideways slide: eyes stay mostly on the wall
  { type: 'hold', id: 'contact', w: HOLD_W },
];

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const sstep = (a, b, x) => (b > a ? smoothstep((x - a) / (b - a)) : (x >= b ? 1 : 0));
const wrapPi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const lerpAngle = (a, b, t) => a + wrapPi(b - a) * t;
// Camera looks down -Z at yaw 0; rotation order YXZ: dir = (-sin y cos p, sin p, -cos y cos p).
const yawOf = (d) => Math.atan2(-d.x, -d.z);
const pitchOf = (d) => Math.atan2(d.y, Math.hypot(d.x, d.z));

// Even pace with raised-cosine ease at the ends: distance fraction for time fraction t.
function profilePos(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const r = RAMP, A = 1 - r;
  const F = (x) => (x < r ? x / 2 - (r / (2 * Math.PI)) * Math.sin((Math.PI * x) / r) : r / 2 + (x - r));
  return t <= 1 - r ? F(t) / A : (A - F(1 - t)) / A;
}
// Normalised speed (0 at the ends, 1 when cruising).
function profileVel(t) {
  if (t <= 0 || t >= 1) return 0;
  const x = Math.min(t, 1 - t);
  return x < RAMP ? (1 - Math.cos((Math.PI * x) / RAMP)) / 2 : 1;
}

function holdDistance(board, aspect, fov) {
  const tanH = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  // Landscape: board fills ~58% of the view width (clears the HUD rail). Portrait/narrow: ~90%.
  const fill = THREE.MathUtils.lerp(0.9, 0.58, smoothstep((aspect - 0.75) / 0.5));
  const d = board.width / (fill * 2 * tanH * aspect);
  return THREE.MathUtils.clamp(d, MIN_D, board.maxD);
}

function buildPath(aspect, fov) {
  const pos = { outside: START.clone() };
  const dir = { outside: DOOR_TARGET.clone().sub(START).normalize() };
  for (const [id, b] of Object.entries(BOARDS)) {
    const p = b.pos.clone().addScaledVector(b.normal, holdDistance(b, aspect, fov));
    p.y = EYE;
    pos[id] = p;
    dir[id] = b.pos.clone().sub(p).normalize();
  }
  const v = (x, z) => new THREE.Vector3(x, EYE, z);
  const { about: A, process: P, services: S, projects: J, contact: C } = pos;
  const waypoints = [
    // up the path, through the front door (x=0, z=6), veer left to the about board
    [START, v(0, 12), v(0, 7.4), v(0, 6), v(0, 4.6), v(A.x * 0.5, 3.4), A],
    // through the z=0 doorway, curl left to the process board
    [A, v(A.x * 0.35, 1.9), v(0, 0.8), v(0, -0.8), v(P.x * 0.5, -2.2), P],
    // about-face as a wide U through the room (bulging toward -Z), not a spin on the spot
    [P, v(P.x * 0.8, -4.3), v(0, -4.85), v(S.x * 0.8, -4.3), S],
    // through the z=-6 doorway toward the projects board
    [S, v(S.x * 0.4, -4.4), v(0, -5.3), v(0, -6.7), v(J.x * 0.45, (J.z - 6.7) / 2 - 0.3), J],
    // slide right along the back wall
    [J, v(0, (J.z + C.z) / 2 + 0.3), C],
  ];
  const curves = waypoints.map((pts) => {
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    c.arcLengthDivisions = 600;
    return c;
  });
  const lengths = curves.map((c) => c.getLength());
  return { pos, dir, curves, lengths };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
// Unregularised look for a move at local time lt: leave the previous board, look ~3 m
// ahead along the path, settle on the next board.
function naturalLook(path, seg, lt) {
  const curve = path.curves[seg.moveIndex], len = path.lengths[seg.moveIndex];
  const s = profilePos(lt);
  curve.getPointAt(s, _a);
  curve.getPointAt(Math.min(1, s + LOOK_AHEAD / len), _b).sub(_a);
  _b.y = 0;
  const from = path.dir[seg.from], to = path.dir[seg.to];
  const aheadYaw = _b.lengthSq() > 0.09 ? yawOf(_b) : yawOf(to);
  const walkPitch = THREE.MathUtils.degToRad(-2.5);
  const wo = smoothstep(lt / LOOK_OUT) * (seg.ahead ?? 1);
  const wi = smoothstep((lt - (1 - LOOK_IN)) / LOOK_IN);
  const yaw = lerpAngle(lerpAngle(yawOf(from), aheadYaw, wo), yawOf(to), wi);
  const pitch = THREE.MathUtils.lerp(THREE.MathUtils.lerp(pitchOf(from), walkPitch, wo), pitchOf(to), wi);
  return [yaw, pitch];
}

export function createCameraRig(camera) {
  // Progress allocation is fixed at the reference aspect, so stops never move on resize.
  const ref = buildPath(REF_ASPECT, REF_FOV);
  const holdTotal = TIMELINE.reduce((s, seg) => s + (seg.type === 'hold' ? seg.w : 0), 0);
  // Net turn per move (hold-to-hold yaw change, via the walking direction).
  const netTurnDeg = [];
  {
    let mi = 0;
    for (const seg of TIMELINE) {
      if (seg.type !== 'move') continue;
      let y = yawOf(ref.dir[seg.from]), turn = 0;
      const tmpSeg = { ...seg, moveIndex: mi++ };
      for (let k = 1; k <= 200; k++) {
        const ny = naturalLook(ref, tmpSeg, k / 200)[0];
        const d = wrapPi(ny - y); turn += d; y += d;
      }
      netTurnDeg.push(Math.abs(THREE.MathUtils.radToDeg(turn)));
    }
  }
  const effort = ref.lengths.map((l, i) => l + TURN_COST * netTurnDeg[i]);
  const effortTotal = effort.reduce((s, e) => s + e, 0);
  const segments = [];
  {
    let t = 0, mi = 0;
    for (const seg of TIMELINE) {
      const w = seg.type === 'hold' ? seg.w : ((1 - holdTotal) * effort[mi]) / effortTotal;
      segments.push({ ...seg, t0: t, t1: t + w, w, moveIndex: seg.type === 'move' ? mi++ : -1 });
      t += w;
    }
    segments[segments.length - 1].t1 = 1;
    segments[segments.length - 1].w = 1 - segments[segments.length - 1].t0;
  }
  const moves = segments.filter((s) => s.type === 'move');
  const stops = segments
    .filter((s) => s.type === 'hold')
    .map((s) => ({ id: s.id, t: s.id === 'outside' ? 0 : (s.t0 + s.t1) / 2 }));

  const segAt = (p) => { for (const s of segments) if (p <= s.t1) return s; return segments[segments.length - 1]; };

  // ---- per-aspect path + look tables -------------------------------------------------
  let path = null, pathKey = '', cumLen = [], refSpeed = 1;
  const yawT = new Float64Array(TABLE_N + 1);
  const pitchT = new Float64Array(TABLE_N + 1);
  const tmpT = new Float64Array(TABLE_N + 1);
  let rateCapUsed = RATE_CAP;

  function smoothMove(arr, ia, ib, H) {
    for (let i = ia; i <= ib; i++) tmpT[i] = arr[i];
    for (let i = ia + 1; i < ib; i++) {
      const h = Math.min(H, i - ia, ib - i);
      let s = 0;
      for (let k = -h; k <= h; k++) s += tmpT[i + k];
      arr[i] = s / (2 * h + 1);
    }
  }

  // Re-pin each hold's samples to the unwrapped board yaw after regularisation.
  function pinHolds() {
    const N = TABLE_N;
    for (let i = 0; i <= N; i++) {
      const seg = segAt(i / N);
      if (seg.type !== 'hold') continue;
      const y = yawOf(path.dir[seg.id]);
      const prev = i > 0 ? yawT[i - 1] : y;
      yawT[i] = prev + wrapPi(y - prev);
    }
  }

  function buildTablesPinned() {
    const N = TABLE_N;
    // 1) natural unwrapped yaw / pitch
    for (let i = 0; i <= N; i++) {
      const p = i / N, seg = segAt(p);
      let y, pt;
      if (seg.type === 'hold') { y = yawOf(path.dir[seg.id]); pt = pitchOf(path.dir[seg.id]); }
      else [y, pt] = naturalLook(path, seg, clamp01((p - seg.t0) / seg.w));
      yawT[i] = i > 0 ? yawT[i - 1] + wrapPi(y - yawT[i - 1]) : y;
      pitchT[i] = pt;
    }
    // 2) rate limit each move between its pinned hold endpoints
    let L = THREE.MathUtils.degToRad(RATE_CAP) * 100;
    const span = moves.map((m) => [Math.max(0, Math.floor(m.t0 * N)), Math.min(N, Math.ceil(m.t1 * N))]);
    for (const [ia, ib] of span) L = Math.max(L, (1.06 * Math.abs(yawT[ib] - yawT[ia])) / ((ib - ia) / N));
    rateCapUsed = THREE.MathUtils.radToDeg(L) / 100;
    const Lh = L / N;
    for (const [ia, ib] of span) {
      const endVal = yawT[ib];
      for (let i = ia + 1; i < ib; i++) yawT[i] = THREE.MathUtils.clamp(yawT[i], yawT[i - 1] - Lh, yawT[i - 1] + Lh);
      for (let i = ib - 1; i > ia; i--) yawT[i] = THREE.MathUtils.clamp(yawT[i], yawT[i + 1] - Lh, yawT[i + 1] + Lh);
      yawT[ib] = endVal;
      smoothMove(yawT, ia, ib, 25);
      smoothMove(pitchT, ia, ib, 25);
    }
    // 3) shift later samples so the table stays continuous (moves keep the unwrapped turn)
    pinHolds();
  }

  // Exterior mix breakpoints (progress where the walker passes a given z in move 1).
  let extRise1 = 0.1, extFall0 = 0.12, extFall1 = 0.14;
  function computeMixBreaks() {
    const m1 = moves[0];
    const pAtZ = (zThr) => {
      for (let k = 0; k <= 800; k++) {
        const lt = k / 800;
        path.curves[0].getPointAt(profilePos(lt), _a);
        if (_a.z <= zThr) return m1.t0 + lt * m1.w;
      }
      return m1.t1;
    };
    extRise1 = pAtZ(8.6);
    extFall0 = pAtZ(5.3);
    extFall1 = extFall0 + 0.5 * (m1.t1 - extFall0);
  }

  const ensurePath = () => {
    const aspect = camera.aspect > 0 && isFinite(camera.aspect) ? camera.aspect : REF_ASPECT;
    const fov = camera.fov > 0 && isFinite(camera.fov) ? camera.fov : REF_FOV;
    const key = aspect.toFixed(3) + '|' + fov.toFixed(2);
    if (key !== pathKey) {
      path = buildPath(aspect, fov);
      pathKey = key;
      cumLen = [];
      let acc = 0;
      for (const l of path.lengths) { cumLen.push(acc); acc += l; }
      refSpeed = acc / moves.reduce((s, m) => s + m.w, 0);
      buildTablesPinned();
      computeMixBreaks();
    }
    return path;
  };

  const sampleTable = (arr, p) => {
    const x = clamp01(p) * TABLE_N, i = Math.min(TABLE_N - 1, Math.floor(x)), f = x - i;
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  };

  // ---- per-frame state ------------------------------------------------------------------
  const pos = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  let inited = false;
  let yaw = 0, pitch = 0, yawV = 0, pitchV = 0, lastTY = 0, lastTP = 0;
  let speed = 0;

  function springStep(x, v, target, dt) {
    const e = x - target, k = v + OMEGA * e, ex = Math.exp(-OMEGA * dt);
    return [target + (e + k * dt) * ex, (v - OMEGA * k * dt) * ex];
  }

  function pathPose(p, out) {
    const seg = segAt(p);
    if (seg.type === 'hold') { out.copy(path.pos[seg.id]); return { seg, lt: 0, s: 0 }; }
    const lt = clamp01((p - seg.t0) / seg.w);
    const s = profilePos(lt);
    path.curves[seg.moveIndex].getPointAt(s, out);
    return { seg, lt, s };
  }

  function update(progress, dt) {
    const p = clamp01(Number.isFinite(progress) ? progress : 0);
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    ensurePath();

    const { seg, lt, s } = pathPose(p, pos);
    let bob = 0, roll = 0;
    if (seg.type === 'move' && !REDUCE_MOTION) {
      const len = path.lengths[seg.moveIndex];
      const speedScale = Math.min(1, len / seg.w / refSpeed);
      const dist = cumLen[seg.moveIndex] + s * len;
      const amp = profileVel(lt) * speedScale;
      bob = BOB_AMP * amp * Math.sin((dist * 2 * Math.PI) / STRIDE);
      roll = ROLL_AMP * amp * Math.sin((dist * Math.PI) / STRIDE);
    }

    const ty = sampleTable(yawT, p), tp = sampleTable(pitchT, p);
    if (!inited) {
      yaw = ty; pitch = tp; yawV = pitchV = 0; lastTY = ty; lastTP = tp;
      prevPos.copy(pos); speed = 0; inited = true;
    } else if (dt > 0) {
      [yaw, yawV] = springStep(yaw, yawV, ty, dt);
      [pitch, pitchV] = springStep(pitch, pitchV, tp, dt);
      // lag clamp: never more than MAX_LAG behind the target; ride along at its speed
      const dy = yaw - ty;
      if (Math.abs(dy) > MAX_LAG) { yaw = ty + Math.sign(dy) * MAX_LAG; yawV = (ty - lastTY) / dt; }
      const dp = pitch - tp;
      if (Math.abs(dp) > MAX_LAG) { pitch = tp + Math.sign(dp) * MAX_LAG; pitchV = (tp - lastTP) / dt; }
      // smoothed walking speed (path position, bob excluded)
      const raw = Math.min(40, pos.distanceTo(prevPos) / dt);
      speed += (raw - speed) * (1 - Math.exp(-dt / VEL_TAU));
    }
    prevPos.copy(pos);
    lastTY = ty; lastTP = tp;
    // Snap the last sub-micro-radian so a settled hold is exactly board-facing.
    if (Math.abs(yaw - ty) < 1e-7 && Math.abs(yawV) < 1e-6) { yaw = ty; yawV = 0; }
    if (Math.abs(pitch - tp) < 1e-7 && Math.abs(pitchV) < 1e-6) { pitch = tp; pitchV = 0; }

    camera.position.copy(pos);
    camera.position.y += bob;
    camera.rotation.set(pitch, yaw, roll, 'YXZ');
  }

  // ---- materialise mix ------------------------------------------------------------------
  const mix = { exterior: 0, hall: 0, living: 0, studio: 0, about: 0, process: 0, services: 0, projects: 0, contact: 0 };
  const [m1, m2, m3, m4, m5] = moves;
  const roomIn = (m) => [m.t0 + 0.4 * m.w, m.t1];          // last 60% of the move in
  const roomOut = (m) => [m.t0, m.t0 + 0.5 * m.w];         // first 50% of the move out
  const boardIn = (m) => [m.t0 + 0.64 * m.w, m.t1];        // starts once the room is ~40% in
  const boardOut = (m) => [m.t0, m.t0 + 0.4 * m.w];        // condenses away before the room does
  const up = (r, p) => sstep(r[0], r[1], p);
  const down = (r, p) => 1 - sstep(r[0], r[1], p);

  function getMix(progress) {
    ensurePath();
    const p = clamp01(Number.isFinite(progress) ? progress : 0);
    mix.exterior = p <= 0 ? 0 : sstep(OUTSIDE_W, extRise1, p) * (1 - sstep(extFall0, extFall1, p));
    mix.hall = up(roomIn(m1), p) * down(roomOut(m2), p);
    mix.living = up(roomIn(m2), p) * down(roomOut(m4), p);
    mix.studio = up(roomIn(m4), p);
    mix.about = up(boardIn(m1), p) * down(boardOut(m2), p);
    mix.process = up(boardIn(m2), p) * down(boardOut(m3), p);
    mix.services = up(boardIn(m3), p) * down(boardOut(m4), p);
    mix.projects = up(boardIn(m4), p) * down(boardOut(m5), p);
    mix.contact = up(boardIn(m5), p);
    return mix;
  }

  const getVelocity = () => speed;

  // Debug/diagnostics (not part of the contract): progress table and the turn cap in use.
  const _debug = { segments, netTurnDeg, get rateCap() { ensurePath(); return rateCapUsed; }, targetAt(p) { ensurePath(); return [sampleTable(yawT, p), sampleTable(pitchT, p)]; } };

  return { update, stops, getMix, getVelocity, _debug };
}
