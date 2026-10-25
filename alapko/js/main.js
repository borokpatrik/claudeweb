import { SCENES } from './scenes.js';
import { createEngine } from './engine.js';
import { initSections } from './sections.js';
import { initGallery } from './gallery.js';
import { fillRenders } from './renders.js';

// Content first: the page must work even if WebGL fails.
initSections();
initGallery(document.getElementById('galeria'), SCENES);
fillRenders(document, SCENES);

try {
  createEngine(document.getElementById('gl'), SCENES).start();
} catch (e) {
  console.warn('3D disabled:', e); // shortcut: no particle fallback art, just the dark page, fine for a demo
}
