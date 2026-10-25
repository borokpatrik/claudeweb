import * as THREE from 'three';
import { buildHouse } from './house.js';
import { createBoards } from './boards.js';
import { createCameraRig } from './camera.js';
import { createMaterializer } from './particles.js';
import { createPost } from './post.js';
import { createUI } from './ui.js';

const LABELS = {
  outside: 'Approach', about: 'Who we are', process: 'How we build',
  services: 'What we do', projects: 'Recent work', contact: 'Contact',
};

// setup threw (e.g. no WebGL): replace the loader with a way out (nbFail lives in index.html)
addEventListener('error', () => window.nbFail?.());

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 200);

const house = buildHouse(scene);
const boards = createBoards(house.anchors);
scene.add(boards);
const materializer = createMaterializer({ zones: house.zones, boards, renderer });
scene.add(materializer.object);
const rig = createCameraRig(camera);
const post = createPost(renderer, scene, camera);
const ui = createUI(rig.stops.map(s => ({ id: s.id, label: LABELS[s.id] ?? s.id })));

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  post.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// Scroll → progress. The track gives the document its length; the canvas is fixed.
const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);
const readProgress = () => Math.min(1, Math.max(0, scrollY / maxScroll()));

addEventListener('walk:goto', e => {
  const stop = rig.stops.find(s => s.id === e.detail.id);
  if (stop) scrollTo({ top: stop.t * maxScroll(), behavior: 'smooth' });
});

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let smooth = readProgress();
let activeId = null;
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  const target = readProgress();
  // frame-rate independent lerp (Lenis-style inertia); low rate = calm walking pace
  smooth = reduceMotion ? target : smooth + (target - smooth) * (1 - Math.exp(-dt * 3.5));
  if (Math.abs(target - smooth) < 1e-5) smooth = target;

  rig.update(smooth, dt);
  materializer.update(t, dt, camera, rig.getMix(smooth));
  house.update(t);
  post.render(dt, reduceMotion ? 0 : rig.getVelocity());
  ui.setProgress(smooth);

  let nearest = rig.stops[0];
  for (const s of rig.stops) if (Math.abs(s.t - smooth) < Math.abs(nearest.t - smooth)) nearest = s;
  if (nearest.id !== activeId) {
    ui.setActive(activeId = nearest.id);
    ui.announce?.(activeId);
  }
});

// first frame is on screen → drop the loader
requestAnimationFrame(() => requestAnimationFrame(() => ui.ready()));
