# crustac.fr/en/home — frontend teardown

## Stack
| Layer | What they use |
|---|---|
| CMS | WordPress, custom theme `wp-theme-crustac` (page template `page-accueil.php`), WP Rocket (lazy/preload), Yoast SEO |
| JS | jQuery + Slick carousel + jquery.autoellipsis + 3 small in-house libs (`ms_preload`, `ms_onscroll`, `ms_rollstring`, dated 2015) + one `functions.js` (~27 KB) |
| CSS | One big `style.css` (~345 KB, unminified), no framework, no CSS variables |
| Fonts | **Mirador** (Bold / Book / Book Italic, commercial serif) for headings, **Montserrat** Medium/SemiBold for UI & body (self-hosted) |
| Media | Two looping MP4s (`video_waves2/3.mp4`) masked into circles; PNG product shots |
| 3rd party | Axeptio (cookie banner), GTM/GA4, Brevo/Sendinblue, WonderPush (web push), Cloudflare Turnstile, YouTube iframe API |

No React/Vue/GSAP/Lenis, no canvas/WebGL. Everything is DOM + CSS transitions + inline SVG.

## Design tokens (most-used values in style.css)
| Token | Value | Use |
|---|---|---|
| Navy | `#023646` | text, dark section bg, chevrons (used 42×) |
| Pink/raspberry | `#E20953` | the "rope" line, CTAs, accent (39×) |
| Pale blues | `#DFEDF3`, `#EAF3F7`, `#F5F9FB` | backgrounds, light chevrons |
| Navy alpha | `rgba(2,54,70,.08–.3)` | borders, shadows |
| Range colors | e.g. `#DD5700` | per-product-range label, injected inline per tile |
| Eyebrow | Montserrat 600, 12–14px, uppercase, letter-spacing 3px |
| Heading | Mirador, large, navy |

## Page structure
`header#site-header-custom` (logo centred, FR/EN left, hamburger right) → `main` with 7 sections, each `.onscroll.fitscreen` (100vh):

1. `#section-intro`: full-bleed photo/video, "SCROLL" cue, the rope starts here
2. `#section-about`: circle with a looping water video inside, line-drawn shrimp hanging off the rope, navy + pale chevron "waves"
3. `#section-how`: the rope with a wiggle, text block
4. `#section-sites`: production sites
5. `#section-gammes.dark`: a huge navy circle fills the screen, the rope loops into an infinity knot, Slick carousel of 3 ranges (centre mode, infinite)
6. `#section-news`: news carousel
7. `#section-contact`, then footer

A fixed left pager (`01 / 07`) and a "NEXT" link per section.

## The mechanics (what makes it feel the way it does)

1. **Scroll-drawn rope (`preparePaths` / `updatePaths`).** Every `.sketch svg path` gets `stroke-dasharray = stroke-dashoffset = getTotalLength()` (fully hidden). On scroll, each path's offset is set to `length × (1 − progress)`, where progress is how far its parent section has travelled through the viewport. Attributes `path-parent` / `path-mode` on the `.sketch` change which element and axis drive it. The parent stays `opacity:0` until the dash is set, so the line never flashes.
2. **Reveal on scroll (`MS_OnScroll`).** Elements are registered; once `elTop + vh/6 < scrollY + vh`, the class `seen` is added (never removed). All the motion is CSS: `.seen .x { transform/opacity/clip }` with transitions. The same lib does background-position parallax.
3. **Preload gate (`MS_Preload`).** It reads every `background-image` in a section, loads them with `new Image()`, then swaps `.preload` → `.loaded`, so the intro only animates once its image is ready.
4. **Number roll (`MS_Rollstring`).** It counts from 0 to the element's numeric text on a 10 ms `setInterval` (150 steps).
5. **Carousel.** Slick, infinite with cloned slides. Each range's colour is injected via a per-tile `<style>` block.
6. **Horizontal history page.** On `/history`, the wheel is hijacked to snap between "slices" (`goToSlice`, easeInOutSine). That isn't used on the home page.

## Recreation
`index.html` rebuilds these mechanics in about 400 lines of vanilla JS and CSS: IntersectionObserver instead of scroll polling, CSS custom properties, a `requestAnimationFrame` counter, and a native scroll-snap carousel. The brand, copy, drawings and imagery are all placeholders; none of the site's assets, text or fonts are reused.
