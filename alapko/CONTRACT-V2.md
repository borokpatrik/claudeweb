# Alapkő v2: spec, ownership and middleman protocol

Builds on `CONTRACT.md` (v1): same site, same section ids, Hungarian copy, native scroll, no pinning. v1 is preserved on GitHub (`v1-snapshot` tag). Work happens on branch `alapko-v2`. Agents do **not** commit; the lead does.

## Goals
1. **Real photos.** High-quality, free-licence photos (Unsplash or Pexels licence only, never Unsplash+ or paid) replace every rendered still: project photos, gallery and modal images. They are stored locally and credited.
2. **Shopify-style pixel particles.** The particles become much smaller, denser and finer (a pixel grid feel like shopify.com/editions/spring2026), and **every 3D section fills its whole background with an organic landscape** (hills, trees, grass, water, sky haze), not just an object on black.
3. **Photo → depth → particles.** The landscapes, and optionally the subjects, are built from real 2D photos plus a depth map. Each pixel becomes a tiny particle displaced in depth, giving a 2.5D parallax that rotates with mouse/scroll as in v1.
4. **Modals.**
   - Clicking an Előző munkák project (the work cards and the photos in Burkolás/Falazás/Alapozás) opens a project modal with a full description and details: location, year, area/size, duration, scope, materials, a client note, and a small photo strip.
   - Clicking a gallery image opens a lightbox with the image large, a caption, prev/next and keyboard support. **No project details in the gallery.**
5. **Reviews section.** A new 100vh section `#velemenyek`, between `#galeria` and `#kapcsolat`, with a slider of 5–6 premade sample reviews: name, town, project type, 5-star rating, text. Mark them in code as sample content.
6. **More SVG scroll animations** across the non-3D sections and the new reviews section. Never hold up scrolling.

## Ownership (never edit files you don't own)
| Agent | Owns |
|---|---|
| **Middleman** | `CONTRACT-V2.md` (this file; it may append to *Decisions*), `assets/photos/manifest.json` **schema** (the Images agent fills the data) |
| **Images** | `assets/photos/**`, `assets/depth/**`, `assets/CREDITS.md`, `tools/**` (depth tooling) |
| **Engine** | `js/engine.js`, `js/scenes.js` |
| **Content** | `index.html`, `css/style.css`, `js/projects.js` (project data), `js/modal.js`, `js/reviews.js`, `js/gallery.js`; may delete `js/renders.js` once nothing uses it |
| **Motion** | `js/sections.js`, `js/svg-anim.js` (new), and SVG markup it injects into placeholders |
| **Lead** | `js/main.js`, commits |

## Middleman protocol
Related agents never message each other directly. They message the **Middleman** with `SendMessage`, and the Middleman relays, decides, and records each decision under *Decisions* below. The pairs that depend on each other:
- Images ↔ Engine: which photos and depth maps exist, their format, and the landscape set per 3D section.
- Images ↔ Content: photo ids and captions per project, gallery and modal.
- Content ↔ Motion: the `[data-svg="name"]` placeholders in index.html and where they sit, class/id hooks for animations, and the reviews slider DOM.

If a question isn't urgent, keep working with a sensible default and tell the Middleman what you assumed. Don't block on replies longer than needed.

## Shared formats (initial, the Middleman may refine)
**`assets/photos/manifest.json`**
```json
{ "photos": [ {
  "id": "tiles-01", "file": "photos/tiles-01.jpg", "w": 1600, "h": 1067,
  "depth": "depth/tiles-01.png",          // 8-bit grayscale, white = near; null if none
  "kind": "project|gallery|landscape|subject",
  "category": "burkolas|falazas|alapozas|haz|tajkep|egyeb",
  "alt": "magyar alt szöveg", "credit": "Photographer", "source": "https://unsplash.com/photos/…", "license": "Unsplash License"
} ] }
```
- Images: JPEG, long edge ≤ 1920 px, quality ~80, each ≤ 500 KB. Use 8+ landscape photos (meadows, forest edges, rolling hills, lakeside, early-morning haze) with depth maps.
- Depth: generate with Depth Anything V2 (small) via transformers.js in a local tool page (`tools/`), saved as PNG. If that fails, use a documented heuristic (vertical gradient + luminance + blur) and flag those files.

**Landscape assignment.** Each 3D section gets a landscape id (or two layered), recorded under *Decisions*.

## Decisions
_(the Middleman appends here; later entries override earlier ones)_

### D1. Manifest schema (final, binding) — `assets/photos/manifest.json`
Plain JSON (no comments). All paths are **relative to the site root** (`alapko/`, where index.html lives).
```json
{
  "version": 2,
  "photos": [ {
    "id": "burkolas-budaors-1",
    "file": "assets/photos/burkolas-budaors-1.jpg",
    "thumb": "assets/photos/thumbs/burkolas-budaors-1.jpg",
    "w": 1920, "h": 1280,
    "depth": "assets/depth/burkolas-budaors-1.png",
    "depthMethod": "dav2-small",
    "kind": "project",
    "category": "burkolas",
    "project": "burkolas-budaors",
    "layer": null,
    "alt": "Fürdőszoba nagyformátumú falburkolattal",
    "caption": "Fürdő · Budaörs",
    "credit": "Photographer Name",
    "source": "https://unsplash.com/photos/…",
    "license": "Unsplash License"
  } ]
}
```
| field | type | rule |
|---|---|---|
| `id` | string | unique, kebab-case, ASCII. Project photos: `<projectId>-<n>`; gallery: `gal-01…`; landscapes: the fixed ids in D2. |
| `file` | string | JPEG, long edge ≤ 1920, ≤ 500 KB |
| `thumb` | string \| null | JPEG, long edge 640, ≤ 90 KB. **Required** for `project` and `gallery` kinds; null for landscapes. |
| `w`,`h` | int | pixel size of `file` |
| `depth` | string \| null | 8-bit grayscale PNG, **white = near, black = far**, same aspect as `file` (any size ≥ 512 px long edge). **Required** for `landscape`; optional elsewhere. |
| `depthMethod` | `"dav2-small"` \| `"heuristic"` \| null | `heuristic` flags fallback maps |
| `kind` | `"project"` \| `"gallery"` \| `"landscape"` \| `"subject"` | a photo can only have one kind; if a photo is used both as project photo and in the gallery, it stays `project` (the gallery may reuse project photos by id) |
| `category` | `"burkolas"` \| `"falazas"` \| `"alapozas"` \| `"haz"` \| `"tajkep"` \| `"egyeb"` | |
| `project` | string \| null | project id from D4 for `kind: project`, else null |
| `layer` | `"far"` \| `"near"` \| null | landscapes only |
| `alt` | string | Hungarian, descriptive |
| `caption` | string | Hungarian, "Típus · Település" style; used by lightbox and photo figcaptions |
| `credit`,`source`,`license` | string | license is exactly `"Unsplash License"` or `"Pexels License"` |

Counts: 9 projects × 3–4 photos, 12–18 extra `gallery` photos, the 8 landscapes from D2. Everything is also listed in `assets/CREDITS.md`.
Loading: Engine and Content each `fetch('assets/photos/manifest.json')` themselves (browser cache makes this cheap). No shared loader module. If the fetch fails, the page still works (Content shows no image / a dark placeholder; Engine falls back to v1 object-only clouds).

### D2. Landscape assignment per 3D section
Eight fixed landscape ids. The Images agent must deliver exactly these ids (`kind: "landscape"`, `category: "tajkep"`, depth required, landscape orientation ≥ 16:10). Composition rule for all: horizon in the upper 35–45 % of the frame, no people, no buildings, no text.

| section / scene | far layer (`layer:"far"`) | near layer (`layer:"near"`) | procedural object placement |
|---|---|---|---|
| `#hero` / house | `land-hills-dawn`: rolling hills in early-morning haze, soft sky | `land-meadow`: meadow grass / wildflowers, bottom-of-frame foreground | house stands on the meadow, mid-ground, right of centre: anchor x 0.64, base y 0.74, height 0.40 of viewport. Text is left. |
| `#munkak` / crane | `land-forest-edge`: treeline at a forest edge, layered hills behind | `land-field`: open mown field / dry grass, slightly earthy | crane is tall, right third: anchor x 0.70, base y 0.76, height 0.62. Cards block rises through its base. |
| `#falazas` / wall | `land-lakeside`: lake with reeds and a distant shore, still water | `land-grass-close`: close-up grass tufts, shallow depth | wall sits on the shore, right of centre: anchor x 0.62, base y 0.78, height 0.30. Media block is right and partly in front of it (repel parts it). |
| `#kapcsolat` / blocks | `land-valley-mist`: river valley with mist between hill ridges | `land-forest-floor`: mossy forest floor / ferns, foreground | blocks pile behind the form, centre-right: anchor x 0.66, base y 0.76, height 0.36. |

Coordinates are normalized viewport (0,0 = top-left) at aspect 16:9; on portrait/mobile the Engine may move the object to x 0.5 and scale it down.
Layering (Engine guidance, Engine decides details): far layer = a depth-displaced particle sheet filling the whole frustum at the back (sky pixels, depth < ~0.08, become sparse dim haze particles, not a solid wall); near layer = a second sheet in front, only its lower ~45 % (pixels whose depth is > ~0.5) kept so it frames the bottom without covering the object; object cloud sits between them. Morphs between sections morph the whole composed cloud. Mouse/scroll rotation applies to the whole composition, with more parallax on near than far.
Fallback: if a listed id is missing, use any landscape with the same `layer`; if none, v1 object-only cloud.

### D3. `[data-svg]` placeholders (Content puts them in index.html, Motion fills them)
Markup (Content): `<div class="svg-slot svg-slot--<name>" data-svg="<name>" aria-hidden="true"></div>`. Content sets the slot's size in CSS (width + `aspect-ratio`) and its grid placement; the slot must have its size **before** Motion injects anything (no layout shift). Motion injects one `<svg viewBox=… width="100%" height="100%" preserveAspectRatio="xMidYMid meet">` inside, never changes the slot's box, never adds content outside the slot. Decorative only: no meaningful text inside (numbers/labels in the SVG are fine but aria-hidden).
v1's three inline SVGs (`#svg-house`, `#svg-tiles`, `#svg-found`) **stay inline in index.html unchanged** (Content keeps their ids and structure); Motion keeps animating them by id.

| name | section | size (desktop) / mobile | position | animation idea (Motion) |
|---|---|---|---|---|
| `ruler` | `#rolunk` | full `.wrap` content width × aspect 16:1 (≈ 1100×70) / full width, aspect 8:1 | directly under `dl.figures`, spanning the copy column + drawing column | a tape measure unrolls left→right with ticks and cm numbers drawing in, scrubbed |
| `level` | `#burkolas` | 300 × 60 (aspect 5:1) / 240 × 48 | in the copy column, under the body text | spirit level draws, bubble slides from the side and settles in the centre as the section reaches the middle |
| `blueprint` | `#alapozas` | 280 × 200 (aspect 7:5) / hidden below 600 px | in the copy column under the body text (the cross-section SVG stays in the draw area) | floor plan with dimension lines and arrowheads drawing in, scrubbed |
| `frame` | `#galeria` | 220 × 140 (aspect 11:7) / 160 × 100 | right side of `.gallery-head`, aligned to the title baseline | camera viewfinder corners + crosshair drawing, slight focus-pull loop when in view |
| `quote-stars` | `#velemenyek` | 200 × 160 (aspect 5:4) / 140 × 112 | left of / above the section title in the reviews head | a big quotation mark draws, then 5 star outlines draw and fill amber in a stagger; re-plays the stars on `reviews:change` |

All scrubbed or one-shot ≤ 0.8 s, no pinning, reduced-motion → drawn fully, static.

### D4. Project data — `js/projects.js` (Content)
```js
// SAMPLE CONTENT: fictional projects for the demo
export const PROJECTS = [ {
  id: 'burkolas-budaors',          // kebab-case, = manifest `project`
  title: 'Fürdőszoba-felújítás',
  category: 'burkolas',            // 'burkolas' | 'falazas' | 'alapozas'
  location: 'Budaörs',
  year: 2024,                      // number
  area: '14 m²',                   // display string with unit
  duration: '3 hét',               // display string
  scope: ['Bontás', 'Aljzatkiegyenlítés', 'Kenhető vízszigetelés', 'Falburkolás 120×60'],
  materials: ['Porcelán gres 120×60', 'Flexibilis ragasztó C2TE S1', 'Epoxi fugázó'],
  description: 'Két–három bekezdésnyi magyar leírás …',   // plain text, \n\n separates paragraphs
  quote: { text: 'Rövid ügyfélvélemény…', author: 'K. Anna' },   // or null
  photos: ['burkolas-budaors-1', 'burkolas-budaors-2', 'burkolas-budaors-3'],  // manifest ids, 3–4
  cover: 'burkolas-budaors-1'      // one of photos
} ];
export const getProject = (id) => PROJECTS.find(p => p.id === id) || null;
```
The nine project ids (one per v1 photo figure, captions unchanged):
- burkolas: `burkolas-budaors` (Fürdő · Budaörs), `burkolas-szentendre` (Terasz · Szentendre), `burkolas-budapest-xi` (Üzlethelyiség · Budapest XI.)
- falazas: `falazas-erd` (Családi ház · Érd), `falazas-godollo` (Társasház · Gödöllő), `falazas-pomaz` (Kerítésfal · Pomáz)
- alapozas: `alapozas-dunakeszi` (Sávalap · Dunakeszi), `alapozas-budakeszi` (Lemezalap · Budakeszi), `alapozas-vac` (Pontalap · Vác)

Each figure's `<img>` shows the project `cover`. The three `#munkak` work cards open the flagship of their category: `burkolas-budaors`, `falazas-erd`, `alapozas-dunakeszi`; the modal footer has a link "Több … munka →" to the category section (`#burkolas` etc.) which closes the modal and scrolls there.

### D5. Reviews data — `js/reviews.js` (Content)
```js
// SAMPLE CONTENT: premade demo reviews, not real customers
export const REVIEWS = [ {
  id: 'r1',
  name: 'Kovács Péter',
  town: 'Érd',
  project: 'Családi ház falazása',  // project type, display string
  category: 'falazas',              // 'burkolas' | 'falazas' | 'alapozas'
  rating: 5,                        // integer 1–5 (all samples are 5)
  text: '2–4 mondat magyarul…',
  date: '2025-06'                   // YYYY-MM
} ];   // 6 items
export function initReviews(section)  // builds/controls the slider in #velemenyek
```
Reviews DOM (binding for Motion): `section#velemenyek.section.section--flat[data-label="Vélemények"]` (100svh, opaque, between `#galeria` and `#kapcsolat`; section labels become `NN / 09`), containing `.reviews-head` (sec-label, h2, the `quote-stars` slot), `.review-viewport > .review-track > article.review-card[data-index="n"]` (×6, with `.review-stars`, `.review-text`, `.review-name`, `.review-meta`), buttons `[data-review-prev]` / `[data-review-next]`, and `.review-dots > button[data-review-dot="n"]`. Active card has `.is-active`. On every change `reviews.js` dispatches `new CustomEvent('reviews:change', { detail: { index } })` on the section element. Slider: transform-based, swipe + arrow keys when focused, `aria-roledescription="carousel"`, no autoplay under reduced motion (autoplay ≤ 7 s otherwise, paused on hover/focus). Motion owns entrance animation of head/cards only; it does not move `.review-track`.

### D6. Modal hooks — `js/modal.js` (Content)
- **Project modal:** any element with `[data-project="<projectId>"]` opens it. The element must be a real `<button>` or `<a>` (photo figures wrap the image in `<button class="ph ph-btn" data-project="…" aria-haspopup="dialog">`; work cards keep `<a href="#burkolas" data-project="burkolas-budaors">` and the click handler calls `preventDefault()` so no-JS still navigates).
- **Lightbox:** `[data-lightbox="galeria"][data-index="<n>"]` on a `<button>` around each gallery image. `n` is the index into the gallery's ordered list of manifest ids (`GALLERY_IDS`, exported from `js/gallery.js`). Marquee clones repeat the same `data-index` but are `aria-hidden="true"` and `tabindex="-1"`. Lightbox shows image (full `file`), `caption`, credit, `n / total`, prev/next buttons, ←/→/Esc keys, swipe. No project details.
- One delegated `click` listener on `document` in `modal.js`. API: `export function initModals()`, `openProject(id)`, `openLightbox(group, index)`, `closeModal()`.
- Both use `<dialog>` (or role="dialog" aria-modal) with focus trap, focus return to the trigger, Esc closes, backdrop click closes. While open: `html.modal-open` class and body scroll lock (user-initiated, allowed).
- Events on `document`: `modal:open` (`detail: { type: 'project'|'lightbox', id?, index? }`) and `modal:close`. Engine may pause rendering/parallax on them; Motion should pause marquee-style loops.

### D7. Wiring notes for the Lead (`main.js`)
Expected calls: `initSections()`, `initSvgAnims()` (from `js/svg-anim.js`, Motion), `initGallery(document.getElementById('galeria'))` (no SCENES arg needed any more), `initReviews(document.getElementById('velemenyek'))`, `initModals()`, `createEngine(canvas, SCENES).start()` (signature unchanged; Engine fetches the manifest itself). `fillRenders` / `renders.js` go away once Content no longer uses `data-render`.

### D8. Ready events (Content → Motion, for `ScrollTrigger.refresh()`)
- `gallery:ready`: `js/gallery.js` dispatches it on `section#galeria` once the marquee rows are in the DOM and the first row's images have loaded or errored (or after a 1.5 s timeout, whichever comes first).
- `reviews:ready`: `js/reviews.js` dispatches it on `section#velemenyek` once the slider DOM is built.
- Both are `new CustomEvent(name, { bubbles: true })`, so a listener on `document` also catches them, and both fire exactly once. Motion must also handle the case where the event fired before it attached its listener: check `section.dataset.ready === "1"`, which Content sets just before dispatching.
- Motion calls `ScrollTrigger.refresh()` on each event (debounced).

### D9. File naming and covers (binding)
- Every photo's `file` is `assets/photos/<id>.jpg`, its `thumb` is `assets/photos/thumbs/<id>.jpg`, and its `depth` (when present) is `assets/depth/<id>.png`. No exceptions, so Content can write static `src`/`srcset` in the HTML. JS still reconciles them against the manifest.
- Project photos are numbered `<projectId>-1` … `-n` with no gaps. **`<projectId>-1` is the cover**: a landscape-oriented photo that is the best shot of the project. `cover` in projects.js is always `<projectId>-1`.
- Gallery order is the `kind:"gallery"` photos sorted by id. If there are fewer than 9, Content pads the gallery with project photos.

### D10. Delivered photo set (Images status, accepted)
- 57 photos, all under the Pexels License: 31 project photos (3–4 per project, every `-1` cover is landscape), 17 gallery photos (`gal-01`…`gal-17`), the 8 D2 landscapes and no `subject` photos. Depth maps for all of them come from `dav2-small` (none are heuristic). They are 8-bit grayscale PNGs, long edge 960, with the same aspect as the JPEG.
- Landscape aspects vary (most are 1920×1200; `land-hills-dawn` is 1728×1080, `land-valley-mist` is 1920×1103). **Engine must read `w`/`h` from the manifest**, not assume 16:10.
- `land-valley-mist` has a faint viaduct in the far haze. That is accepted.
- Project photos at positions `-2`…`-4` may be portrait. Content's modal strip and lightbox must handle portrait (object-fit or natural aspect, no stretching).

### D11. Engine v2 additions (accepted, non-breaking)
- `createEngine(canvas, SCENES)` still returns `{ show, start }` and now also exposes `stats`. `window.__alapkoEngine` is a debug handle only, and no other module may depend on it.
- `scenes.js`: `build(variant, env)` takes an optional `env`. When `env` is given, the object is lit for its landscape and has no ground plate. `build(variant)` behaves exactly as in v1, so `renders.js` is unaffected. `SCENES[id].land` and `SCENES[id].place` carry the D2 landscape ids and anchors. That data is owned by Engine, and D2 remains the source of truth.
- The engine pauses rendering between `modal:open` and `modal:close`.
- Legibility: the engine dims the left half of the landscape in each 3D section. Content strengthens the `.section--3d::before` scrim where the copy sits, especially for `#kapcsolat` (`land-valley-mist` has a bright mist band behind the left-hand copy).

### D12. Stylesheet cache-busting
`index.html` links `css/style.css?v=N`, currently `v=2`. Both files belong to Content, so **Content bumps N** in the same change whenever it edits style.css. Anyone else who needs a fresh stylesheet asks the Middleman. Testers hard-reload before judging CSS.
