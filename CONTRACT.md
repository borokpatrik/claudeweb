# Walkthrough: module contract

A scroll-driven first-person walk through a house for **Northbeam Builders** (construction company, same brand as `../index.html`). As you scroll, the camera walks from outside, through the front door, through three rooms, and stops to face whiteboards and posters on the walls that hold the site's content. There is no sound.

Plain ES modules, no build step. Three.js is loaded through an import map in `index.html`:
```
"three": "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js",
"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/"
```
Every module does `import * as THREE from 'three'`.

## Files and owners
| File | Owner | Exports |
|---|---|---|
| `index.html`, `ui.js`, `style.css` | UI agent | `createUI(sections)` |
| `house.js` | 3D scene agent | `buildHouse(scene)` |
| `boards.js` | Content agent | `createBoards(anchors)` |
| `camera.js` | Animation agent | `createCameraRig(camera)` |
| `main.js` | Integrator (lead) | n/a; wires the modules together |

Do not edit files you don't own.

## World layout (metres, Y up, ground at y=0, walking direction is −Z)
```
              z=-12  back wall ─────────────────────────
                     │  ROOM C "Studio"                │   boards: projects (x=-2.5), contact (x=+2.5) on back wall, facing +Z
              z=-6   ├──── wall with doorway x∈[-1,1] ─┤
                     │  ROOM B "Living"                │   boards: process (left wall x=-6, z=-3, facing +X)
                     │                                 │           services (right wall x=+6, z=-3, facing −X)
              z=0    ├──── wall with doorway x∈[-1,1] ─┤
                     │  ROOM A "Hall"                  │   board: about (left wall x=-6, z=3, facing +X)
              z=6    └──── front wall, door x∈[-0.6,0.6], h=2.2 ┘
                           porch / path / lawn out to z=+20
           x=-6                                      x=+6
```
- Walls are 3.0 m high and 0.2 m thick, centred on the lines above. The interior doorways are 2.4 m high.
- Board centres sit at **y = 1.6**. The default board size is **2.4 w × 1.5 h**; the about board may be 2.0 × 1.4. Boards sit 0.12 m off the wall surface, toward the room.
- The camera eye height is 1.65 m.

## Interfaces

### `house.js`
```js
export function buildHouse(scene) -> { anchors, update(t) }
```
- Adds the house, floor, ceilings (they may be omitted or kept low-key so the camera sees them), a pitched roof visible from outside, ground/lawn, path, a few simple furniture pieces made from primitives, lights, fog, sky/background colour.
- `anchors`: `{ about, services, process, projects, contact }`. Each is `{ position: THREE.Vector3, rotationY: number, width, height }`, where position is the board centre (already offset off the wall) and rotationY makes a plane's +Z face the room.
- `update(t)`: per-frame hook (seconds elapsed) for small ambient animation, or a no-op.
- It sets nothing on the renderer. `main.js` sets `renderer.toneMapping = ACESFilmicToneMapping`, `outputColorSpace = SRGBColorSpace` and shadows enabled (`PCFSoftShadowMap`). Meshes may set `castShadow`/`receiveShadow`.

### `boards.js`
```js
export function createBoards(anchors) -> THREE.Group
```
- One board per anchor id. Each board is drawn on a 2D `<canvas>` → `THREE.CanvasTexture` (colorSpace SRGB, anisotropy 8), mapped onto a plane of the anchor's size, with a thin frame/tray mesh around it.
- Use a different look per board, e.g. a whiteboard with marker handwriting, a pinned blueprint, a framed poster, a cork board with cards, a chalkboard. Canvas resolution should be ≥ 1024 px wide so text is crisp.
- Content (Northbeam Builders, placeholder copy you write):
  - `about`: who we are, est. 2004, general contractor
  - `services`: new builds, extensions & lofts, renovation (short lines each)
  - `process`: 5 steps: groundwork, framing, roof, openings, handover
  - `projects`: three recent projects with a tiny sketch each
  - `contact`: "Got a plot? Let's talk.", placeholder email/phone, hours

### `camera.js`
```js
export function createCameraRig(camera) -> { update(progress, dt), stops }
```
- `progress` ∈ [0,1] (already smoothed by main.js). `dt` is in seconds.
- Walk: start outside at about (0, 1.65, 18) looking at the front door, go through the door, then visit the boards in order **about → process → services → projects → contact**, finishing in room C facing the back wall.
- At each board, the camera holds still, squarely facing it at a distance where the whole board fills about 70% of the view width at fov 55 (about 2.2–2.6 m away). These holds are flat sections of progress, so a reader has scroll room to read.
- Paths must stay inside rooms and pass through doorway openings (x∈[-1,1] at z=0 and z=-6; x∈[-0.6,0.6] at z=6). Use `CatmullRomCurve3` for position and interpolate look direction with smooth easing; never snap.
- Optional subtle head-bob while moving (amplitude ≤ 0.02 m), with none at holds.
- `stops`: `[{ id: 'outside'|'about'|..., t: number }]`, where t is the progress value at the centre of each hold, in order. Include `'outside'` at t=0.

### `ui.js` + `index.html` + `style.css`
```js
export function createUI(sections) -> { setProgress(p), setActive(id), ready() }
```
- `sections`: `[{ id, label }]`, in the same order as `stops`.
- `index.html` contains: import map, `<link rel=stylesheet href=style.css>`, a fixed full-screen `<canvas id="gl">`, a HUD overlay (logo top-left, "Get a quote" CTA top-right, a vertical room/section rail on the left with the active one highlighted, a progress bar or counter, a "Scroll to walk in" hint that fades after progress > 0.02), a loader that `ready()` hides, and a scroll track `<div id="track">` whose height (≈ 1000vh) gives the walk its length. It ends with `<script type="module" src="main.js"></script>`.
- Clicking a rail item scrolls the window so progress equals that stop's t. The UI emits this as `window.dispatchEvent(new CustomEvent('walk:goto', { detail: { id } }))` and main.js handles the scroll.
- Visual language: matches `../index.html` (Archivo + JetBrains Mono, charcoal `#1c1c1a`, paper `#f8f6f2`, amber `#f2a900`). The HUD must stay legible over a 3D scene.
- Responsive down to a 375 px width, and respects `prefers-reduced-motion` in the UI transitions.

### `main.js` (integrator)
It creates the renderer/scene/camera(fov 55), then calls `buildHouse` → `createBoards(anchors)` → `createCameraRig` → `createUI(stops→sections)`. Each frame it reads `progress = scrollY / (scrollHeight − innerHeight)`, lerps a smoothed value, and calls `rig.update`, `house.update` and `ui.setProgress`. The active id is the nearest stop.
