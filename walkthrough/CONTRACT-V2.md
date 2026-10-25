# Walkthrough v2: particle house that materialises

This builds on `CONTRACT.md` (v1), which still holds for the world layout, anchors, board ids and stop ids. Read v1 first. Background research is in `SHOPIFY-EDITIONS-TEARDOWN.md`.

**The experience.** A dark, modern scene. The house is a glowing **point cloud** sampled from its own geometry. As the camera reaches each stop, the surrounding room and its board **materialise**: particles converge onto the surfaces while the solid mesh dissolves in through animated noise with a hot amber edge. When the camera walks on, it dissolves back into drifting particles. Walking feels calm: an even pace, soft turns, and a light motion streak while moving.

Stack: plain ES modules, three@0.169.0 via the existing import map (`three`, `three/addons/`). Must hold 60 fps on a laptop iGPU at 1440×900. Respect `prefers-reduced-motion` (skip drift and streak, keep cross-fades).

## Files and owners
| File | Owner | Change |
|---|---|---|
| `house.js` | Scene agent | restyle + zones (modify) |
| `particles.js` | Particle agent | **new** |
| `camera.js` | Camera agent | smoothing rewrite + `getMix` (modify) |
| `post.js` | Look agent | **new** |
| `style.css`, `ui.js`, `index.html` | Look agent | dark restyle (modify; keep all ids and the `createUI` API) |
| `boards.js` | nobody | unchanged |
| `main.js` | Integrator (lead) | wiring |

Never edit files you don't own.

## Zones
Zone ids: `exterior` (lawn, path, facade outer faces, roof, trees, porch), `hall` (z∈[0,6]), `living` (z∈[-6,0]), `studio` (z∈[-12,-6]). Interior walls on a boundary belong to the room on their +Z side (the wall at z=0 → `hall`, z=-6 → `living`). The front wall → `hall` for its inner face; put the whole front wall in `exterior` if splitting faces is awkward.

Board → zone: `about`→hall, `process`/`services`→living, `projects`/`contact`→studio.

## Interfaces

### `house.js` (modify)
```js
export function buildHouse(scene) -> { anchors, update(t), zones }
```
- `anchors`: unchanged values and shape.
- `zones`: `{ exterior: THREE.Mesh[], hall: Mesh[], living: Mesh[], studio: Mesh[] }`. Every visible house mesh is in exactly one zone, and lights are not. Merge geometry **per zone per material**, and give each zone its **own material instances** (clone), so a uniform injected into one zone never affects another.
- Every mesh has `userData.zone = '<id>'` and `userData.particleColor` (THREE.Color: the colour its particles should have, i.e. the base colour, brightened if dark).
- Restyle toward a modern, minimal architectural look on a dark night stage. Calm materials: warm white plaster, pale oak, concrete, charcoal steel frames, amber accents, glass with an emissive glow. `scene.background` and fog become a deep blue-black (≈ `#0a0c10`), with warm interior light pools. Keep the triangle budget small and shadows to ≤ 2 lights.
- Solids must start **invisible** (`mesh.visible = false` is fine). particles.js controls visibility through dissolve.

### `particles.js` (new)
```js
export function createMaterializer({ zones, boards, renderer }) -> {
  object,                       // THREE.Group to add to the scene (all Points)
  update(t, dt, camera, mix),   // per frame
}
```
- `boards` is the Group from `createBoards` (children `board-<id>`, `userData.id`; each board's front plane material has `.map` as a CanvasTexture).
- `mix`: `{ exterior, hall, living, studio, about, process, services, projects, contact }`, each 0..1 (0 = pure particles, 1 = fully solid).
- **Sampling.** Use `MeshSurfaceSampler` (`three/addons/math/MeshSurfaceSampler.js`) per mesh, with counts proportional to surface area. Total about 220k points on desktop, scaled down when `renderer.capabilities` or `devicePixelRatio`/screen size suggest a weak GPU (and ~90k for narrow viewports). Each point stores its surface position, colour (`userData.particleColor`, with ±10% jitter), zone index and a random seed. Board planes are sampled with colour taken from their canvas texture pixels (read the canvas with getImageData and weight sample density toward dark/ink pixels, so the text and drawings resolve), with a board index.
- **Point shader** (`ShaderMaterial`, `transparent`, `depthWrite: false`, `AdditiveBlending`):
  - Soft round sprite; size attenuated by distance and clamped.
  - Slow curl-like drift (cheap sin/cos noise) of a few cm around the surface position.
  - A twinkle.
  - Per-point "scatter" offset (up to ~0.6 m along a random direction plus upward lift) that goes to 0 as that point's zone/board mix → 1, so the particles converge onto the surface.
  - Particle alpha fades out as the mix → 1, after the solid is in.
  - Pass mixes as uniform arrays: `uZoneMix[4]`, `uBoardMix[5]`.
- **Dissolve on solids.** Patch every zone mesh material and every board mesh material with `onBeforeCompile`:
  - Inject a `uMix` uniform and an object-space 3D noise value n.
  - `discard` where `n > uMix * 1.15 - 0.075`.
  - Add an emissive amber edge band (`#f2a900`, intensity ~3, so it blooms) where n is within ~0.06 of the threshold.
  - Set `mesh.visible = uMix > 0.001`.
  - Keep the shadow behaviour sane: set `customDepthMaterial`, or simply turn `castShadow` off while 0 < mix < 1.
- **Background dust.** An ambient field of sparse slow particles around the property, so the night air has depth.
- `update` writes the uniforms from `mix`. No per-frame allocations.

### `camera.js` (modify)
```js
export function createCameraRig(camera) -> { update(progress, dt), stops, getMix(progress), getVelocity() }
```
- **Same route, same stop ids/order, same hold-facing rules** as v1 (it passes the v1 sanity tests: doorways, wall clearance, scrub-safe).
- **Even pace.** A single arc-length–parameterised path for all moves, with move durations proportional to distance (constant walking speed of about 1.2 m per 1% of progress, tune it). Ease in/out only at the start and end of each move (≤ 15% of the move). Holds are a bit longer than v1 (≈ 9% each).
- **Soft turns.**
  - Yaw/pitch follow the target through critically damped springs (`dt`-based, half-life ~0.35 s), clamped so the look can never lag more than ~25° behind the target.
  - Look-ahead distance ~3 m.
  - The big "process → services" about-face becomes a wide arc through the middle of the room, not a spin on the spot.
  - Never more than ~6° of look change per 1% of progress.
- Because the springs use `dt`, position stays a pure function of progress and rotation converges to a pure function at rest. A fast scrub must still settle exactly on board-facing holds.
- Head bob: keep it, but softer (≤ 0.012 m), plus a tiny roll sway (≤ 0.3°).
- `getMix(progress)` → the mix object from particles.js. Shape the curves:
  - **exterior:** 0 at progress 0 (the opening shot is the particle house), rising to 1 while walking up the path, done before the door; falls back to 0 once the camera is inside the hall and walking.
  - **each room:** 0 → 1 over the last ~60% of the move into its first board hold. It stays 1 while the camera is anywhere in that room's holds, and goes 1 → 0 over the first ~50% of the move leaving the room.
  - **each board:** follows its own hold, but lags its room slightly (it starts after the room is ~40% in), so the info condenses last.
  - **end:** at the final contact hold, studio and contact = 1.
  - Use smoothstep shapes.
- `getVelocity()` → camera speed in m/s (smoothed), used by post.js for the streak.

### `post.js` (new)
```js
export function createPost(renderer, scene, camera) -> { render(dt, velocity), setSize(w, h) }
```
- `EffectComposer` → `RenderPass` → `UnrealBloomPass` (strength ~0.9, radius ~0.6, threshold ~0.75, so the particles and amber edges glow) → a custom `ShaderPass` → `OutputPass`. The custom pass does:
  - a radial motion streak toward the screen centre, strength from velocity (0 at rest, subtle at walking pace);
  - slight chromatic separation scaled with the streak;
  - a vignette;
  - fine animated film grain.
- Run bloom at half resolution. Cap the pixel ratio at 1.5 for the composer. Honour reduced motion (no streak and no grain animation).

### Look-agent UI restyle (`style.css`, `ui.js`, `index.html`)
- Same ids, same API. Make the HUD feel like a premium product launch on a dark stage: translucent dark glass, crisp white type with amber accents, refined spacing. Use the motion skills for the HUD's micro-interactions (rail item activation, progress, loader exit, hint) with springy, interruptible transitions.
- Add a centred chapter "title card" element `#chapter` (`<div id="chapter"><span class="kicker"></span><h2></h2></div>`). It briefly appears when a new stop becomes active (kicker "02 / 06", title = the section label) and fades out after ~1.6 s or when the next stop activates. Expose it through a new optional method on the existing API: `ui.announce(id)`. main.js calls it when the active stop changes. Keep it away from the board area (place it lower-third, small).
- The loader becomes dark, with a line like "Surveying the site…" and a fine particle-ish progress line.

## `main.js` (integrator) frame loop
```
smooth progress → rig.update(p, dt) → mix = rig.getMix(p)
materializer.update(t, dt, camera, mix) → house.update(t)
post.render(dt, rig.getVelocity()) → ui.setProgress / setActive / announce
```
