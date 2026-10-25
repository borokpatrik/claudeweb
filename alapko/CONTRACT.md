# Alapkő: site spec and module contract

A new one-page site for a fictional Hungarian construction company, **Alapkő Építőipari Kft.** All copy is in Hungarian, and all copy and brand are original placeholders.

Layout and feel follow the Shopify Editions Spring '26 teardown (`../walkthrough/SHOPIFY-EDITIONS-TEARDOWN.md`): a dark stage, big crisp type, a minimal header, a pill-shaped section indicator, and a glowing particle world behind the content.

**Every section is exactly one screen tall** (`min-height: 100svh`). Scrolling is native: no scroll-jacking, no pinning that holds the page, and no smooth-scroll/"jelly" library.

## Folder
```
alapko/
  index.html          (Sections agent)
  css/style.css       (Sections agent)
  assets/             (Sections agent: logo.svg, icons; Gallery agent may add files)
  js/main.js          (Lead: wiring only)
  js/engine.js        (Engine agent)
  js/scenes.js        (Scenes agent)
  js/sections.js      (Sections agent)
  js/gallery.js       (Gallery agent)
  js/renders.js       (Gallery agent)
```
Never edit files you don't own.

Import map (in index.html), exact versions:
```
"three": "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js",
"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/",
"gsap": "https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js",
"gsap/ScrollTrigger": "https://cdn.jsdelivr.net/npm/gsap@3.12.5/ScrollTrigger.js"
```
Fonts come from Google Fonts. Brand: deep night `#0b0c0f`, warm white `#f3efe8`, safety amber `#f2a900`, plus one cool accent `#7fb4ff`.

## Page structure (ids and attributes are binding)
| # | id | Type | Content |
|---|---|---|---|
| 1 | `hero` | 3D `data-scene="house"` | Big headline, sub-line, CTA "Ajánlatkérés" → `#kapcsolat` |
| 2 | `rolunk` | non-3D | About: who we are, numbers (count-up), SVG scroll-draw illustration |
| 3 | `munkak` | 3D `data-scene="crane"` | "Előző munkáink" intro + a **floating block** `[data-repel]` holding three cards linking to the 3 work sections |
| 4 | `burkolas` | non-3D | Tiling: short text, 3 photos, SVG tile-grid scroll-draw |
| 5 | `falazas` | 3D `data-scene="wall"` | Masonry: short text + a **floating block** `[data-repel]` with 3 photos |
| 6 | `alapozas` | non-3D | Foundation: short text, 3 photos, SVG foundation cross-section scroll-draw |
| 7 | `galeria` | non-3D | Gallery: 2–3 rows of images scrolling sideways in opposite directions (marquee) |
| 8 | `kapcsolat` | 3D `data-scene="blocks"` | Contact form inside a **floating block** `[data-repel]` (name, email, phone, message; no backend: on submit, show a thank-you state and open `mailto:info@example.hu`) |

- Header: logo, nav links (Kezdőlap, Rólunk, **Előző munkák ▾** dropdown → Burkolás / Falazás / Alapozás, Galéria, Kapcsolat) and a CTA pill. The dropdown works with keyboard, touch and hover.
- 3D sections have **transparent** backgrounds (the fixed canvas shows through). Non-3D sections have **opaque** backgrounds, so they cover the canvas.
- Photos: `<img data-render="<sceneId>:<variant>">` placeholders. The Gallery agent's `renders.js` fills their `src` with rendered stills (see below). Variants are integers 0–5 that change the camera angle and lighting.

## Interfaces

### `scenes.js` (Scenes agent)
```js
export const SCENES = {
  house:  { label, build() },   // modern two-storey house, hero
  crane:  { label, build() },   // tower crane over a half-built frame (not a house)
  wall:   { label, build() },   // brick wall being laid, trowel, mortar tub, pallet of bricks
  blocks: { label, build() },   // abstract: stacked concrete blocks / beams in a sculptural pile
  tiles:  { label, build() },   // floor of tiles with a few lifted, tile cutter (used for stills)
  rebar:  { label, build() },   // foundation trench with rebar cage and formwork (used for stills)
}
// build(variant = 0) -> { scene: THREE.Scene, camera: THREE.PerspectiveCamera, size: number }
```
- Built procedurally from primitives in code (no external models), with nice materials and lights: MeshStandardMaterial, a hemisphere + directional light, colourful but tasteful.
- `scene.background = null` (transparent). The camera frames the subject centred and filling ~70% of the frame at aspect 16:9. `size` is the approximate radius of the subject in world units.
- `variant` changes the camera angle and light colour slightly (0 = hero framing).
- Keep each scene under ~30k triangles.

### `engine.js` (Engine agent)
```js
export function createEngine(canvas, SCENES) -> { show(id), start() }
```
It owns the fixed full-screen `<canvas id="gl">`, the WebGL renderer and the render loop.

1. **Bake.** For a scene id, call `SCENES[id].build(0)`. Render it offscreen at **low resolution** (the "pixelate" step; about 220 px wide on desktop, 140 on mobile) into a render target, reading colour and depth (e.g. a second pass with a depth-encoding override material, or `DepthTexture`). Every non-transparent pixel becomes one particle at its depth-reconstructed 3D position, with that pixel's colour. Bake from 2–3 yaw angles and merge, so the cloud has volume when it rotates. Bake lazily and cache.
2. **Particles.** Draw them as **square** points (a pixel look), sized to roughly one baked cell on screen, with a subtle glow/additive mix, slight per-particle shimmer, and density that reads clearly on the dark background.
3. **Morph.** `show(id)` morphs the current cloud into the target cloud: per-particle staggered flight with an ease, ~1.2 s. Pad the smaller cloud by duplicating points. `show(null)` disperses or fades the particles (used while a non-3D section covers the screen).
4. **Motion:**
   - Mouse moves the camera gently: parallax orbit, ±8° yaw and ±5° pitch, damped.
   - Every so often, when idle (~6 s with no input), the cloud does a slow auto-rotation.
   - **Scroll velocity rotates the cloud around Y in the scroll direction**, damped, with a spring back toward rest.
   - Touch devices: no mouse; use gentle idle motion.
5. **Repel.** Each frame, read the bounding rects of `[data-repel]` elements inside the active section (at most 2). In the vertex shader, push particles whose projected screen position falls inside or near a rect outward from its centre: faint, soft falloff, a few px up to ~30 px. As the floating block rises into view, it parts the particles it passes through.
6. **Activation.** The engine watches `section[data-scene]` with an IntersectionObserver (≥ 50% visible) and calls `show(id)` itself. It also calls `show(null)` when a non-3D section is ≥ 50% visible. So `main.js` only calls `start()`.
7. **Performance:** at most ~90k particles drawn, pixel ratio ≤ 1.5, pausing when the tab is hidden, `prefers-reduced-motion` (no auto-rotate or shimmer; morph becomes a quick cross-fade).

### `renders.js` + `gallery.js` (Gallery agent)
```js
// renders.js
export async function fillRenders(root = document, SCENES)   // fills every img[data-render]
export async function renderStill(SCENES, id, variant, w, h) -> string (object URL or data URL)
// gallery.js
export function initGallery(section, SCENES)                 // builds the marquee rows in #galeria
```
- One shared offscreen `WebGLRenderer` (preserveDrawingBuffer). Render stills at 800×600, JPEG quality 0.85, with a dark studio background colour (not transparent), so they read as "photos". Render lazily and in idle time, so first paint isn't blocked, and cache by key.
- Gallery: 2–3 rows built from all six scenes × variants. Rows scroll sideways forever in alternating directions (CSS transform animation), speeding up with scroll velocity and slowing back down. Hover pauses a row. Rounded cards with a caption ("Burkolás · Budaörs" style placeholder captions). Respect reduced motion (rows static and horizontally scrollable).

### `sections.js` + `index.html` + `style.css` + `assets/` (Sections agent)
```js
export function initSections()   // all non-3D animation + header/dropdown/form behaviour
```
- Shopify-Editions-like layout: dark, generous whitespace, big display type (e.g. "Inter Tight", "Space Grotesk" or similar from Google Fonts), a small mono label per section ("02 / 08"), and a fixed bottom-centre pill showing the current section name (updated by an IntersectionObserver), with a click opening a quick section menu.
- **Non-3D sections: be wild with easing.**
  - **Entrances:** split-line headline reveals, staggered cards, clip-path wipes, elastic/back/expo eases, number count-ups, marquee words, parallax photos.
  - **SVG scroll-draws** (stroke-dashoffset tied to scroll progress via GSAP ScrollTrigger `scrub`, no pinning):
    - `#rolunk`: a house elevation that draws itself;
    - `#burkolas`: a tile grid laying itself;
    - `#alapozas`: a foundation cross-section (soil layers, footing, rebar) that draws itself.
  - **Never hold up scrolling:** no pin, no scroll locking, and nothing that delays content longer than ~0.8 s once in view.
- 3D sections: transparent background, headline/text on the left or bottom-left, the floating `[data-repel]` block (glassy dark card, `aspect-ratio` ~733/522 for media blocks) that rises with a smooth translateY as the section enters (scrubbed), so it visibly pushes through the particles.
- Contact form: client-side validation with accessible errors, success state, `mailto:` fallback. Labels in Hungarian.
- Responsive to 375 px, no horizontal scroll, visible keyboard focus, `prefers-reduced-motion` respected (reveals become simple fades and SVGs are drawn fully).
- Create `assets/logo.svg` (original mark) and any section SVGs (inline is fine).

### `main.js` (Lead)
```js
import { SCENES } from './scenes.js'; createEngine(canvas, SCENES).start();
initSections(); initGallery(document.getElementById('galeria'), SCENES); fillRenders(document, SCENES);
```
