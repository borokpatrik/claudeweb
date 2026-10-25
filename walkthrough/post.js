// Post-processing for the Northbeam walkthrough (v2).
// createPost(renderer, scene, camera) -> { render(dt, velocity), setSize(w, h) }
//
// Chain: RenderPass -> UnrealBloomPass (mip chain at half the CSS viewport)
//        -> "walk" ShaderPass (radial streak + chromatic split + vignette + grain) -> OutputPass
// Everything before OutputPass is linear HDR; OutputPass applies the renderer's tone mapping + sRGB.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const MAX_PIXEL_RATIO = 1.5;

const BLOOM = { strength: 0.9, radius: 0.6, threshold: 0.75 };

const WalkShader = {
  uniforms: {
    tDiffuse: { value: null },
    uStreak: { value: 0 },       // 0..1, already smoothed
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.42 },  // how much the corners darken
    uGrain: { value: 0.06 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uStreak;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;

    // cheap, stable hash (no sin) -> [0,1)
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    const int SAMPLES = 7;

    void main() {
      vec2 px = vUv * uResolution;
      vec3 col;

      if (uStreak > 0.0005) {
        // Pull samples from the pixel toward the screen centre. The offset grows with the
        // distance from the centre, so the middle stays sharp and the edges smear like travel.
        vec2 toC = vec2(0.5) - vUv;
        float len = uStreak * 0.042;             // max reach as a fraction of the distance to centre
        float ca = uStreak * 0.22;               // chromatic spread, scaled with the streak
        float jitter = hash12(px + fract(uTime) * 61.0); // dither the taps; grain hides the rest
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < SAMPLES; i++) {
          float t = (float(i) + jitter) / float(SAMPLES);
          float w = 1.0 - t * 0.75;              // nearer taps weigh more
          vec2 o = toC * len * t;
          acc.r += texture2D(tDiffuse, vUv + o * (1.0 + ca) - toC * ca * 0.012).r * w;
          acc.g += texture2D(tDiffuse, vUv + o).g * w;
          acc.b += texture2D(tDiffuse, vUv + o * (1.0 - ca) + toC * ca * 0.012).b * w;
          wsum += w;
        }
        col = acc / wsum;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }

      // Vignette (aspect-corrected, soft).
      vec2 d = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
      float v = smoothstep(1.05, 0.28, length(d));
      col *= mix(1.0 - uVignette, 1.0, v);

      // Fine film grain. Scaled by a lifted luminance so it reads evenly in the darks
      // (which the tone map + sRGB curve would otherwise blow up) without greying the blacks.
      float n = hash12(floor(px) + floor(uTime * 24.0) * vec2(17.0, 29.0)) - 0.5;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += n * uGrain * (0.012 + l * 0.55);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = reduceMQ.matches;
  reduceMQ.addEventListener?.('change', e => { reduce = e.matches; });

  const size = renderer.getSize(new THREE.Vector2());
  const ratio = () => Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

  // At ratio 1 there are no extra pixels to hide edge aliasing, so pay for MSAA there only.
  const rt = new THREE.WebGLRenderTarget(size.x * ratio(), size.y * ratio(), {
    type: THREE.HalfFloatType,
    samples: ratio() <= 1 ? 4 : 0,
  });
  let pr = ratio();
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  // UnrealBloomPass halves whatever size it is given for its first mip. Feed it CSS pixels
  // (not device pixels) so the bright pass + blur chain always runs at half the viewport,
  // whatever the DPR. The composite back into the full-res buffer is size independent.
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => bloomSetSize(w / pr, h / pr);
  composer.addPass(bloom);

  const walk = new ShaderPass(WalkShader);
  composer.addPass(walk);
  composer.addPass(new OutputPass());

  const u = walk.uniforms;
  let streak = 0;
  let time = 0;

  function setSize(w, h) {
    pr = ratio();
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    u.uResolution.value.set(w * pr, h * pr);
  }

  // Velocity (m/s) -> streak 0..1. Saturating curve: ~0.26 at 1.2 m/s, ~0.46 at 2.5 m/s.
  const target = v => (Number.isFinite(v) && v > 0.05 ? 1 - Math.exp(-Math.min(v, 12) / 4) : 0);

  function render(dt = 1 / 60, velocity = 0) {
    dt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    const goal = reduce ? 0 : target(velocity);
    // Exponential smoothing; builds a little slower than it releases so it never pops in.
    const k = 1 - Math.exp(-dt * (goal > streak ? 3.0 : 4.5));
    streak += (goal - streak) * k;
    if (streak < 1e-4 && goal === 0) streak = 0;
    u.uStreak.value = streak;

    if (!reduce) time += dt; // reduced motion: grain stays as a still texture
    u.uTime.value = time;

    composer.render(dt);
  }

  setSize(size.x, size.y);

  return { render, setSize, composer, bloom };
}
