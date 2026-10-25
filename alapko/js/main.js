import { SCENES } from './scenes.js';
import { createEngine } from './engine.js';
import { initSections } from './sections.js';
import { initSvgAnims } from './svg-anim.js';
import { initGallery } from './gallery.js';
import { initReviews } from './reviews.js';
import { initModals } from './modal.js';

// Content first: the page must work even if WebGL fails.
initSections();
initSvgAnims();
initGallery(document.getElementById('galeria'));
initReviews(document.getElementById('velemenyek'));
initModals();

try {
  createEngine(document.getElementById('gl'), SCENES).start();
} catch (e) {
  console.warn('3D disabled:', e); // shortcut: no particle fallback art, just the dark page, fine for a demo
}
