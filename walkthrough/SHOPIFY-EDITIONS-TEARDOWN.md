# shopify.com/editions/spring2026: frontend teardown

## Stack
| Layer | What |
|---|---|
| App | React Router v7 (Remix lineage), SSR plus hydration (`__reactRouterContext`, route manifest) |
| 3D | Three.js **r183**, a single `WebGLRenderer` canvas behind the page |
| Choreography | **Theatre.js** (`__TheatreJS_CoreBundle`, `__S26_THEATRE_CLIENT_ENABLED__`). Each chapter ships its own Theatre state JSON from the Shopify CDN (`hero-prod-….json`, `agentic-prod-….json`, `sidekick-…`, `retail-…`, `payments-…`, …), so camera paths and uniforms are authored in Theatre's studio UI and replayed against scroll |
| Scroll | Lenis (`window.lenis`) drives native scroll smoothing. The document is ~42,000 px (~36 viewports) |
| Quality tiering | `@pmndrs/detect-gpu` benchmarks fetched at boot, used to pick the particle count and effects per GPU |
| Lighting | `park.hdr` environment map |

## Visual techniques
- **Point-cloud world.** The hero "forest" is a raw binary buffer (`forest-1024-v3-moretrees-512_3.bin`), i.e. pre-baked particle positions and colours. It is drawn as `THREE.Points` with a custom shader (`gl_PointSize = size`, soft sprite discs, additive-ish blending), so the scene reads as glittering dust that suggests shapes rather than solid meshes.
- **Particles → image.** "Spatial video" assets are KTX2 sprite sheets (`heroforest_1_14f_643x358_etc1s.ktx2` = 14 frames, `SpatialVideo3_50f_…` = 50 frames). Particles sample those frames for colour, so a cloud resolves into a moving picture as the camera arrives.
- **Typography in space.** Words wrap around 3D ribbons and cylinders ("…everywhere" arcs around the camera) and move with the camera.
- **Chapter transitions.** Scroll velocity drives directional streaks and blur toward the vanishing point (radial motion smear plus colour separation), so moving between chapters feels like warp travel. The scene is dark, colours glow, and type is crisp white over the top.
- **InstancedMesh** for repeated props, `ShaderMaterial` + `discard` for the soft round points and cut-outs.
- **UI.** A minimal white HUD and a pill chapter selector at the bottom ("Agentic ▾"). The 3D scene carries the page.

## What we adopt for the Northbeam walkthrough (v2)
1. The house renders as a **point cloud** sampled from its own meshes (`MeshSurfaceSampler`), coloured by the source material, drifting slightly.
2. Approaching a stop, the room and board **materialise**: particles converge onto their surfaces while the solid mesh dissolves in from noise with a glowing edge. Leaving the stop reverses it.
3. The board artwork is sampled as particles too, so the info "condenses" out of dust.
4. A dark, modern grade: bloom, vignette and grain, plus a velocity-driven radial streak while walking.
5. A smoother camera: constant walking pace by arc length, critically damped look rotation, and longer holds.

We hand-code the timeline instead of using Theatre.js, and sample particles at runtime instead of shipping baked `.bin` clouds.
