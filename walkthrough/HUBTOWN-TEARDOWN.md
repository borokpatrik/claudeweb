# hubtown.co.in: frontend teardown

## Stack
| Layer | What |
|---|---|
| Framework | Nuxt 3 (Vue 3), statically built, a single ~2.3 MB main chunk plus lazy chunks |
| 3D | Three.js r179 (`window.__THREE__ === "179"`), one full-screen WebGL canvas |
| Scroll | Lenis smooth scroll on an inner wrapper `div.js-page-scroll` (~33,000 px tall, ≈28 viewports). `body` is exactly 100vh, so `window.scrollY` stays 0 |
| Animation | GSAP + ScrollTrigger (scroll timeline drives the camera and scene transitions), GSAP SplitText for headline reveals |
| Styling | Tailwind utility classes |

## WebGL pipeline (from the bundle and network)
- **Assets:** `scene_1..4.glb`, `map.glb`, `map-districts.glb`, `map-cube.glb`, all **Draco**-compressed (draco wasm decoder self-hosted in `/draco/`).
- **Textures:** **KTX2/Basis** GPU-compressed (`/basis/basis_transcoder.wasm`). They include matcaps, noise and voronoi, normal maps for terrain/water, and the hero cube's grid/edges/hex/AO/thickness maps.
- **Heightfields:** `scene3/4-houdini-height.exr`, i.e. terrain baked in Houdini and displaced in a shader.
- **Materials:** heavy custom `ShaderMaterial` use (≈200 `gl_FragColor`, 60+ `uTime` uniforms), so most surfaces are hand-written shaders (the glowing glass cube with thickness-map refraction, the water with a normal map, particle `Points`).
- **Lighting and look:** HDR environment via `RGBELoader` → `PMREMGenerator`, ACES Filmic tone mapping, `FogExp2` for the depth fade into darkness, `EffectComposer` + `UnrealBloomPass` for the glow, and a `Reflector` for the mirrored water.
- **Instancing:** `InstancedMesh` for repeated geometry (rocks, buildings, map districts).

## Interaction model
1. Lenis smooths the scroll; ScrollTrigger maps scroll progress → a GSAP timeline.
2. The timeline animates camera position/target and shader uniforms, and swaps "chapters" (Future → Innovation → Collaboration → …, listed in the left rail).
3. HTML overlay copy (headline, CTA) fades in and out per chapter on top of the canvas.

## How our walkthrough maps to it
We keep the same architecture (one fixed canvas, a long scroll track, scroll progress → camera timeline, an HTML HUD on top) but swap in lighter parts. There are no glTF/KTX2 assets, because the house is built from primitives in code. Board content is drawn to `CanvasTexture`s, and plain native scroll with lerp smoothing stands in for Lenis + GSAP.
