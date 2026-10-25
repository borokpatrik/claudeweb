// boards.js: content boards for the Northbeam Builders walkthrough.
// export createBoards(anchors) -> THREE.Group
import * as THREE from 'three';

const CW = 1600; // canvas width in px
const SANS = '"Archivo", "Arial Black", "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono", Consolas, "Courier New", monospace';
const HAND = '"Caveat", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
const MARKER = '"Permanent Marker", "Caveat", "Segoe Print", "Comic Sans MS", cursive';
const INK = '#1c1c1a';
const PAPER = '#f8f6f2';
const AMBER = '#f2a900';

const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Permanent+Marker&display=swap';
const FONT_SPECS = [
  '900 80px Archivo', '500 48px Archivo',
  '500 30px "JetBrains Mono"',
  '400 60px "Caveat"', '700 60px "Caveat"',
  '400 60px "Permanent Marker"',
];

/* ------------------------------------------------------------------ */
/* small utilities                                                     */
/* ------------------------------------------------------------------ */

function rngFrom(seed) { // mulberry32: stable doodles across redraws
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function font(ctx, weight, size, family) { ctx.font = `${weight} ${size}px ${family}`; }

function fitFont(ctx, text, weight, size, family, maxW, min = 44) {
  let s = size;
  font(ctx, weight, s, family);
  while (s > min && ctx.measureText(text).width > maxW) { s -= 2; font(ctx, weight, s, family); }
  return s;
}

function wrap(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(t).width > maxW) { lines.push(line); line = word; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function smoothStroke(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const l = pts[pts.length - 1];
  ctx.lineTo(l[0], l[1]);
  ctx.stroke();
}

function wobblePts(rng, x1, y1, x2, y2, j = 2.5) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const n = Math.max(2, Math.ceil(len / 45));
  const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
  const pts = [];
  let drift = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    drift = drift * 0.85 + (rng() - 0.5) * j;
    pts.push([x1 + (x2 - x1) * t + nx * drift, y1 + (y2 - y1) * t + ny * drift]);
  }
  return pts;
}

const hline = (ctx, rng, x1, y1, x2, y2, j) => smoothStroke(ctx, wobblePts(rng, x1, y1, x2, y2, j));

function handRect(ctx, rng, x, y, w, h, j = 2.5, o = 7) {
  hline(ctx, rng, x - o * rng(), y, x + w + o * rng(), y, j);
  hline(ctx, rng, x + w, y - o * rng(), x + w, y + h + o * rng(), j);
  hline(ctx, rng, x + w + o * rng(), y + h, x - o * rng(), y + h, j);
  hline(ctx, rng, x, y + h + o * rng(), x, y - o * rng(), j);
}

function arrowHead(ctx, rng, x, y, ang, size) {
  for (const s of [-1, 1]) {
    const a = ang + Math.PI + s * (0.45 + rng() * 0.1);
    hline(ctx, rng, x, y, x + Math.cos(a) * size, y + Math.sin(a) * size, 1.2);
  }
}

function handArrow(ctx, rng, x1, y1, x2, y2, head = 26) {
  hline(ctx, rng, x1, y1, x2, y2, 2);
  arrowHead(ctx, rng, x2, y2, Math.atan2(y2 - y1, x2 - x1), head);
}

function curveArrow(ctx, rng, x1, y1, cx, cy, x2, y2, head = 26) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cx, cy, x2, y2);
  ctx.stroke();
  arrowHead(ctx, rng, x2, y2, Math.atan2(y2 - cy, x2 - cx), head);
}

function markerUnderline(ctx, rng, x, y, w, color, lw) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    ctx.globalAlpha = k ? 0.55 : 0.9;
    ctx.beginPath();
    ctx.moveTo(x - 6 + rng() * 8, y + (rng() - 0.5) * 6 + k * lw * 0.7);
    ctx.quadraticCurveTo(x + w / 2, y + 10 + (rng() - 0.5) * 10 + k * lw * 0.7, x + w + rng() * 14, y - 6 + k * lw * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

function pushpin(ctx, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.55, y + r * 0.8, r * 1.05, r * 0.8, 0.4, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.25, color);
  g.addColorStop(1, shade(color, -0.45));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function shade(hex, amt) { // lighten (+) or darken (-) a #rrggbb colour
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function tape(ctx, rng, x, y, w, h, angle, color = 'rgba(232,221,188,0.88)') {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(-w / 2 + 3, -h / 2 + 5, w, h);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  for (let i = 1; i <= 6; i++) ctx.lineTo(w / 2 + (i % 2 ? -7 : 0) * rng(), -h / 2 + (h * i) / 6);
  ctx.lineTo(-w / 2, h / 2);
  for (let i = 5; i >= 0; i--) ctx.lineTo(-w / 2 + (i % 2 ? 7 : 0) * rng(), -h / 2 + (h * i) / 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function speckle(ctx, rng, w, h, count, colors, alpha = [0.3, 0.8], size = [1, 3]) {
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha[0] + rng() * (alpha[1] - alpha[0]);
    ctx.fillStyle = colors[(rng() * colors.length) | 0];
    const s = size[0] + rng() * (size[1] - size[0]);
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* board drawings                                                      */
/* ------------------------------------------------------------------ */

// ABOUT: framed paper poster, bold Archivo type
function drawAbout(ctx, w, h) {
  const r = rngFrom(11);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, r, w, h, 5000, ['#000'], [0.02, 0.06], [1, 2]);
  ctx.fillStyle = AMBER;
  ctx.fillRect(0, 0, w, 22);

  const L = 110;
  ctx.fillStyle = AMBER;
  ctx.fillRect(L, 118, 28, 28);
  font(ctx, 500, 40, MONO);
  ctx.fillStyle = INK;
  ctx.fillText('EST. 2004 · GENERAL CONTRACTOR', L + 48, 146);

  const head = ['WE BUILD', 'HOUSES PEOPLE', 'STAY IN.'];
  let size = 144;
  font(ctx, 900, size, SANS);
  while (size > 80 && Math.max(...head.map((t) => ctx.measureText(t).width)) > w - 2 * L - 20) {
    size -= 4;
    font(ctx, 900, size, SANS);
  }
  let y = 290 + size * 0.1;
  head.forEach((t, i) => {
    if (i === 2) markerUnderline(ctx, r, L, y + 20, ctx.measureText('STAY IN').width, AMBER, 18);
    ctx.fillStyle = INK;
    ctx.fillText(t, L, y);
    if (i < 2) y += size * 0.96;
  });

  font(ctx, 500, 50, SANS);
  ctx.fillStyle = '#3a3a36';
  const body = 'One crew and one contract, from the first trench to the final key. Twenty years of family homes, built to outlast us.';
  let by = y + 120;
  for (const line of wrap(ctx, body, 1130)) { ctx.fillText(line, L, by); by += 66; }

  // amber rubber stamp
  ctx.save();
  ctx.translate(w - 215, by - 150);
  ctx.rotate(-0.22);
  ctx.strokeStyle = AMBER;
  ctx.fillStyle = AMBER;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(0, 0, 118, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 100, 0, Math.PI * 2); ctx.stroke();
  ctx.textAlign = 'center';
  font(ctx, 900, 64, SANS);
  ctx.fillText('20+', 0, 4);
  font(ctx, 500, 28, MONO);
  ctx.fillText('YEARS', 0, 48);
  ctx.translate(-125, -125); // worn ink: paper-coloured flecks over the stamp
  speckle(ctx, r, 250, 250, 600, [PAPER], [0.5, 1], [2, 5]);
  ctx.restore();
  ctx.textAlign = 'left';

  // footer
  ctx.fillStyle = INK;
  ctx.fillRect(L, h - 140, w - 2 * L, 4);
  font(ctx, 900, 44, SANS);
  ctx.fillText('NORTHBEAM BUILDERS', L, h - 72);
  font(ctx, 500, 34, MONO);
  ctx.textAlign = 'right';
  ctx.fillText('ABOUT / 01', w - L, h - 74);
  ctx.textAlign = 'left';
}

// PROCESS: whiteboard, marker handwriting, 5-step flow
function drawProcess(ctx, w, h) {
  const r = rngFrom(23);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#fdfefe');
  g.addColorStop(1, '#eceff1');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const sheen = ctx.createLinearGradient(0, 0, w, h * 0.6);
  sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  sheen.addColorStop(0.65, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);

  // ghosts of last week's half-erased notes
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(110,125,140,0.07)';
  ctx.lineWidth = 34;
  for (let i = 0; i < 6; i++) {
    const x = r() * w, y = 200 + r() * (h - 260);
    hline(ctx, r, x, y, x + 200 + r() * 300, y + (r() - 0.5) * 80, 12);
  }

  const BLUE = '#1f4fbf', RED = '#c8312b', GREEN = '#2a7a3b', BLACK = '#24272b';
  font(ctx, 400, 84, MARKER);
  ctx.fillStyle = BLUE;
  ctx.fillText('How a house goes up', 90, 150);
  markerUnderline(ctx, r, 90, 178, ctx.measureText('How a house goes up').width, RED, 8);

  const steps = [
    ['Groundwork', 'dig, drain, pour'],
    ['Framing', 'walls go up'],
    ['Roof', 'weathertight'],
    ['Openings', 'windows & doors'],
    ['Handover', 'keys to you'],
  ];
  const BW = 380, BH = 190;
  const pos = [[90, 250], [610, 250], [1130, 250], [1130, 610], [610, 610]];
  const numCol = [BLUE, RED, GREEN, BLUE, RED];

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  steps.forEach(([label, note], i) => {
    const [x, y] = pos[i];
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 6;
    handRect(ctx, r, x, y, BW, BH, 3);
    ctx.strokeStyle = numCol[i];
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(x + 50, y + 50, 30 + r() * 4, 28 + r() * 4, r(), 0, Math.PI * 1.9);
    ctx.stroke();
    ctx.fillStyle = numCol[i];
    font(ctx, 400, 40, MARKER);
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), x + 50, y + 64);
    ctx.textAlign = 'left';
    ctx.fillStyle = BLACK;
    fitFont(ctx, label, 400, 50, MARKER, BW - 60);
    ctx.fillText(label, x + 30, y + 128);
    font(ctx, 700, 48, HAND);
    ctx.fillStyle = '#4a5560';
    ctx.fillText(note, x + 32, y + 172);
  });

  ctx.strokeStyle = RED;
  ctx.lineWidth = 6;
  handArrow(ctx, r, 90 + BW + 18, 345, 610 - 18, 345);
  handArrow(ctx, r, 610 + BW + 18, 345, 1130 - 18, 345);
  curveArrow(ctx, r, 1320 + 30, 250 + BH + 18, 1385, 525, 1320 + 30, 610 - 18);
  handArrow(ctx, r, 1130 - 18, 705, 610 + BW + 18, 705);

  // free corner: note + doodled tick
  ctx.fillStyle = GREEN;
  font(ctx, 700, 56, HAND);
  ctx.fillText('One site lead,', 110, 690);
  ctx.fillText('start to finish.', 110, 750);
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 7;
  hline(ctx, r, 400, 650, 425, 680, 1);
  hline(ctx, r, 425, 680, 470, 610, 1);

  // sticky note held by a magnet
  ctx.save();
  ctx.translate(1290, 32);
  ctx.rotate(0.05);
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#ffe27a';
  ctx.fillRect(0, 0, 250, 170);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  ctx.fillRect(0, 0, 250, 26);
  ctx.fillStyle = BLACK;
  font(ctx, 700, 48, HAND);
  ctx.fillText('Site photos', 26, 88);
  ctx.fillText('every Friday', 26, 140);
  ctx.restore();
  // magnet
  const mx = 1415, my = 40;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(mx + 6, my + 9, 28, 24, 0, 0, Math.PI * 2); ctx.fill();
  const mg = ctx.createRadialGradient(mx - 9, my - 10, 3, mx, my, 27);
  mg.addColorStop(0, '#ff9b8f');
  mg.addColorStop(0.4, RED);
  mg.addColorStop(1, '#7a1612');
  ctx.fillStyle = mg;
  ctx.beginPath(); ctx.arc(mx, my, 26, 0, Math.PI * 2); ctx.fill();
}

// SERVICES: pinned blueprint
function drawServices(ctx, w, h) {
  const r = rngFrom(37);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#2360ab');
  g.addColorStop(1, '#16437f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 18; i++) { // blotchy paper
    const x = r() * w, y = r() * h, rad = 80 + r() * 260;
    const b = ctx.createRadialGradient(x, y, 0, x, y, rad);
    b.addColorStop(0, `rgba(255,255,255,${0.02 + r() * 0.03})`);
    b.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = b;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 40) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
  for (let y = 0; y <= h; y += 40) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 200) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 0; y <= h; y += 200) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
  // fold crease
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(w / 2 - 2, 0, 2, h);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(w / 2, 0, 2, h);

  const WHITE = '#f3f7ff';
  ctx.strokeStyle = WHITE;
  ctx.fillStyle = WHITE;
  ctx.lineWidth = 3;
  ctx.strokeRect(36, 36, w - 72, h - 72);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(50, 50, w - 100, h - 100);

  font(ctx, 500, 34, MONO);
  ctx.globalAlpha = 0.8;
  ctx.fillText('SHEET A-01  /  SERVICES', 90, 124);
  ctx.globalAlpha = 1;
  font(ctx, 900, 96, SANS);
  ctx.fillText('WHAT WE BUILD', 90, 222);

  // title block
  const tx = 1150, ty = 72, tw = 370, th = 160;
  ctx.lineWidth = 2;
  ctx.strokeRect(tx, ty, tw, th);
  ctx.beginPath();
  ctx.moveTo(tx, ty + 60); ctx.lineTo(tx + tw, ty + 60);
  ctx.moveTo(tx, ty + 110); ctx.lineTo(tx + tw, ty + 110);
  ctx.moveTo(tx + tw / 2, ty + 60); ctx.lineTo(tx + tw / 2, ty + th);
  ctx.stroke();
  font(ctx, 700, 30, MONO);
  ctx.fillText('NORTHBEAM', tx + 18, ty + 42);
  font(ctx, 500, 26, MONO);
  ctx.fillText('SCALE 1:50', tx + 16, ty + 95);
  ctx.fillText('REV C', tx + tw / 2 + 16, ty + 95);
  ctx.fillText('DRAWN NB', tx + 16, ty + 145);
  ctx.fillText('2004-', tx + tw / 2 + 16, ty + 145);

  const rows = [
    ['NEW BUILDS', 'Ground-up homes, bare plot to keys.', drawBpHouse],
    ['EXTENSIONS & LOFTS', 'More room out back, or up in the roof.', drawBpExtension],
    ['RENOVATION', 'Strip-outs, rewires and full refits.', drawBpPlan],
  ];
  rows.forEach(([label, body, sketch], i) => {
    const y0 = 278 + i * 210;
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.6;
    ctx.strokeRect(90, y0, 300, 180);
    ctx.restore();
    ctx.strokeStyle = WHITE;
    ctx.fillStyle = WHITE;
    ctx.lineWidth = 3;
    sketch(ctx, 90, y0, 300, 180);
    fitFont(ctx, label, 900, 60, SANS, 900);
    ctx.fillText(label, 440, y0 + 78);
    fitFont(ctx, body, 500, 46, MONO, 1000);
    ctx.globalAlpha = 0.92;
    ctx.fillText(body, 440, y0 + 146);
    ctx.globalAlpha = 1;
    // callout bubble
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(1470, y0 + 64, 30, 0, Math.PI * 2); ctx.stroke();
    font(ctx, 700, 32, MONO);
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), 1470, y0 + 75);
    ctx.textAlign = 'left';
    if (i < 2) {
      ctx.globalAlpha = 0.3;
      ctx.fillRect(90, y0 + 196, w - 180, 1.5);
      ctx.globalAlpha = 1;
    }
  });

  const pins = [[64, 64], [w - 64, 64], [64, h - 64], [w - 64, h - 64]];
  pins.forEach(([x, y]) => pushpin(ctx, x, y, 17, '#d63a2f'));
}

function dimLine(ctx, x1, x2, y, label) {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y); ctx.lineTo(x2, y);
  for (const x of [x1, x2]) { ctx.moveTo(x - 6, y + 6); ctx.lineTo(x + 6, y - 6); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); }
  ctx.stroke();
  font(ctx, 500, 20, MONO);
  ctx.textAlign = 'center';
  ctx.fillText(label, (x1 + x2) / 2, y - 8);
  ctx.restore();
}

function drawBpHouse(ctx, x, y, w, h) {
  const gy = y + h - 40;
  ctx.beginPath();
  ctx.moveTo(x + 20, gy); ctx.lineTo(x + w - 20, gy);
  ctx.rect(x + 80, gy - 80, 140, 80);
  ctx.moveTo(x + 66, gy - 80); ctx.lineTo(x + 150, gy - 132); ctx.lineTo(x + 234, gy - 80);
  ctx.rect(x + 138, gy - 46, 24, 46);
  ctx.rect(x + 96, gy - 64, 28, 24);
  ctx.rect(x + 176, gy - 64, 28, 24);
  ctx.stroke();
  dimLine(ctx, x + 80, x + 220, y + h - 14, '9.6 m');
}

function drawBpExtension(ctx, x, y, w, h) {
  const gy = y + h - 40;
  ctx.save();
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.rect(x + 30, gy - 90, 120, 90);
  ctx.moveTo(x + 22, gy - 90); ctx.lineTo(x + 90, gy - 138); ctx.lineTo(x + 158, gy - 90);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.rect(x + 150, gy - 64, 120, 64);
  ctx.rect(x + 70, gy - 128, 40, 22); // dormer
  ctx.moveTo(x + 20, gy); ctx.lineTo(x + w - 20, gy);
  ctx.stroke();
  ctx.save(); // hatch the new work
  ctx.beginPath(); ctx.rect(x + 150, gy - 64, 120, 64); ctx.clip();
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = -64; i < 140; i += 14) { ctx.moveTo(x + 150 + i, gy); ctx.lineTo(x + 150 + i + 64, gy - 64); }
  ctx.stroke();
  ctx.restore();
  dimLine(ctx, x + 150, x + 270, y + h - 14, '+4.2 m');
}

function drawBpPlan(ctx, x, y, w, h) {
  ctx.save();
  ctx.lineWidth = 6;
  ctx.strokeRect(x + 40, y + 25, 220, 130);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 150, y + 25); ctx.lineTo(x + 150, y + 85);
  ctx.moveTo(x + 150, y + 85); ctx.arc(x + 150, y + 85, 40, Math.PI / 2, 0, true); // door swing
  ctx.stroke();
  ctx.setLineDash([8, 7]); // wall to remove
  ctx.beginPath();
  ctx.moveTo(x + 40, y + 100); ctx.lineTo(x + 150, y + 100);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (const cx of [x + 70, x + 120]) {
    ctx.moveTo(cx - 10, y + 90); ctx.lineTo(cx + 10, y + 110);
    ctx.moveTo(cx + 10, y + 90); ctx.lineTo(cx - 10, y + 110);
  }
  ctx.stroke();
  font(ctx, 500, 20, MONO);
  ctx.fillText('REMOVE', x + 52, y + 140);
  ctx.restore();
}

// PROJECTS: cork board with three pinned index cards
function drawProjects(ctx, w, h) {
  const r = rngFrom(51);
  ctx.fillStyle = '#b8864f';
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, r, w, h, 16000, ['#8a5a2e', '#d3a46c', '#6f4523', '#c99560', '#e2b98a'], [0.35, 0.9], [1.5, 4.5]);
  const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(40,20,5,0.35)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);

  tape(ctx, r, 80, 52, 520, 112, -0.03);
  ctx.save();
  ctx.translate(120, 132);
  ctx.rotate(-0.03);
  font(ctx, 400, 66, MARKER);
  ctx.fillStyle = INK;
  ctx.fillText('Recent work', 0, 0);
  ctx.restore();

  const cards = [
    { cx: 310, rot: -0.045, pin: '#d63a2f', cap: 'Three-bed family home', tag: 'No. 01 · 2025', sketch: sketchHouse },
    { cx: 800, rot: 0.03, pin: AMBER, cap: 'Two-storey rear extension', tag: 'No. 02 · 2024', sketch: sketchExtension },
    { cx: 1290, rot: -0.025, pin: '#2f63c8', cap: 'Victorian terrace refit', tag: 'No. 03 · 2024', sketch: sketchTerrace },
  ];
  const CWd = 430, CHt = 620, top = -CHt / 2;
  for (const c of cards) {
    ctx.save();
    ctx.translate(c.cx, 248 + CHt / 2);
    ctx.rotate(c.rot);
    ctx.shadowColor = 'rgba(30,15,0,0.45)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 6;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = '#fbf8ef';
    ctx.fillRect(-CWd / 2, top, CWd, CHt);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(217,104,106,0.8)';
    ctx.fillRect(-CWd / 2, top + 70, CWd, 2.5);
    ctx.fillStyle = 'rgba(120,160,205,0.4)';
    for (let ly = top + 124; ly < top + CHt - 20; ly += 54) ctx.fillRect(-CWd / 2, ly, CWd, 1.5);

    ctx.strokeStyle = '#3b3f46';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    c.sketch(ctx, r, -170, top + 88, 340, 290);

    ctx.fillStyle = INK;
    font(ctx, 700, 56, HAND);
    let y = top + 450;
    for (const line of wrap(ctx, c.cap, 370)) { ctx.fillText(line, -185, y); y += 58; }
    font(ctx, 500, 32, MONO);
    ctx.fillStyle = '#6a6a66';
    ctx.fillText(c.tag, -185, top + CHt - 32);
    pushpin(ctx, 0, top + 34, 19, c.pin);
    ctx.restore();
  }
}

function sketchHouse(ctx, r, x, y, w, h) {
  const gy = y + h - 12;
  hline(ctx, r, x, gy, x + w, gy);
  handRect(ctx, r, x + 90, gy - 130, 180, 130, 2, 4);
  hline(ctx, r, x + 72, gy - 128, x + 180, gy - 228);
  hline(ctx, r, x + 180, gy - 228, x + 288, gy - 128);
  handRect(ctx, r, x + 220, gy - 220, 26, 50, 1.5, 3); // chimney
  handRect(ctx, r, x + 163, gy - 70, 34, 70, 1.5, 3); // door
  for (const wx of [x + 110, x + 220]) {
    handRect(ctx, r, wx, gy - 108, 32, 30, 1.5, 3);
    hline(ctx, r, wx + 16, gy - 108, wx + 16, gy - 78, 1);
  }
  ctx.beginPath(); // tree
  ctx.arc(x + 36, gy - 92, 30, 0, Math.PI * 2);
  ctx.stroke();
  hline(ctx, r, x + 36, gy - 62, x + 36, gy, 1);
}

function sketchExtension(ctx, r, x, y, w, h) {
  const gy = y + h - 12;
  hline(ctx, r, x, gy, x + w, gy);
  handRect(ctx, r, x + 20, gy - 150, 150, 150, 2, 4);
  hline(ctx, r, x + 6, gy - 148, x + 95, gy - 236);
  hline(ctx, r, x + 95, gy - 236, x + 184, gy - 148);
  handRect(ctx, r, x + 170, gy - 140, 150, 140, 2, 4); // two-storey box
  hline(ctx, r, x + 165, gy - 146, x + 326, gy - 146, 1.5);
  handRect(ctx, r, x + 190, gy - 120, 110, 42, 1.5, 3);
  handRect(ctx, r, x + 190, gy - 64, 110, 64, 1.5, 3); // glazed doors
  for (const gx of [x + 227, x + 263]) hline(ctx, r, gx, gy - 64, gx, gy, 1);
  handRect(ctx, r, x + 75, gy - 110, 40, 34, 1.5, 3);
}

function sketchTerrace(ctx, r, x, y, w, h) {
  const gy = y + h - 12;
  hline(ctx, r, x, gy, x + w, gy);
  hline(ctx, r, x + 10, gy - 180, x + 330, gy - 180);
  hline(ctx, r, x + 10, gy - 180, x + 10, gy);
  hline(ctx, r, x + 330, gy - 180, x + 330, gy);
  hline(ctx, r, x + 30, gy - 230, x + 310, gy - 230);
  hline(ctx, r, x + 10, gy - 180, x + 30, gy - 230, 1);
  hline(ctx, r, x + 330, gy - 180, x + 310, gy - 230, 1);
  for (let i = 0; i < 3; i++) {
    const hx = x + 10 + i * 107;
    if (i) hline(ctx, r, hx, gy - 180, hx, gy, 1);
    handRect(ctx, r, hx + (i ? -10 : 90), gy - 262, 20, 32, 1, 2); // chimney pots
    ctx.beginPath(); // bay window
    ctx.moveTo(hx + 14, gy - 20); ctx.lineTo(hx + 22, gy - 80); ctx.lineTo(hx + 58, gy - 80); ctx.lineTo(hx + 66, gy - 20);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath(); // arched door
    ctx.moveTo(hx + 74, gy); ctx.lineTo(hx + 74, gy - 50);
    ctx.arc(hx + 87, gy - 50, 13, Math.PI, 0);
    ctx.lineTo(hx + 100, gy);
    ctx.stroke();
    handRect(ctx, r, hx + 24, gy - 160, 30, 40, 1, 2);
    handRect(ctx, r, hx + 66, gy - 160, 30, 40, 1, 2);
  }
}

// CONTACT: chalkboard
function drawContact(ctx, w, h) {
  const r = rngFrom(67);
  ctx.fillStyle = '#26332d';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) { // smudges
    const x = r() * w, y = r() * h, rad = 120 + r() * 320;
    const b = ctx.createRadialGradient(x, y, 0, x, y, rad);
    b.addColorStop(0, `rgba(255,255,255,${0.025 + r() * 0.035})`);
    b.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = b;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'; // eraser swipes
  ctx.lineWidth = 70;
  for (let i = 0; i < 5; i++) {
    const x = r() * w * 0.8, y = 120 + r() * (h - 240);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 200, y - 60 + r() * 120, x + 380 + r() * 200, y + (r() - 0.5) * 60);
    ctx.stroke();
  }
  // faint leftover sums
  ctx.save();
  ctx.translate(1180, 920);
  ctx.rotate(-0.06);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  font(ctx, 400, 54, HAND);
  ctx.fillText('rafters @ 400 c/c', 0, 0);
  ctx.restore();

  // chalk layer, roughened before compositing
  const layer = document.createElement('canvas');
  layer.width = w;
  layer.height = h;
  const c = layer.getContext('2d');
  const CHALK = '#f4f1e8', YELLOW = '#f6c453';
  c.lineCap = 'round';
  c.lineJoin = 'round';

  c.fillStyle = CHALK;
  font(c, 700, 150, HAND);
  c.fillText('Got a plot?', 110, 225);
  c.fillStyle = YELLOW;
  c.fillText("Let's talk.", 110, 385);
  markerUnderline(c, r, 110, 420, c.measureText("Let's talk.").width, YELLOW, 7);

  c.strokeStyle = CHALK;
  c.fillStyle = CHALK;
  c.lineWidth = 5;
  const rows = [560, 670, 780];
  // envelope
  handRect(c, r, 110, rows[0] - 50, 72, 50, 1.5, 3);
  hline(c, r, 110, rows[0] - 50, 146, rows[0] - 22, 1);
  hline(c, r, 146, rows[0] - 22, 182, rows[0] - 50, 1);
  // phone
  c.beginPath();
  c.roundRect(126, rows[1] - 62, 42, 70, 8);
  c.stroke();
  c.beginPath(); c.arc(147, rows[1] - 2, 3, 0, Math.PI * 2); c.fill();
  // clock
  c.beginPath(); c.arc(146, rows[2] - 24, 30, 0, Math.PI * 2); c.stroke();
  hline(c, r, 146, rows[2] - 24, 146, rows[2] - 44, 0.5);
  hline(c, r, 146, rows[2] - 24, 162, rows[2] - 18, 0.5);

  font(c, 700, 72, HAND);
  c.fillText('hello@example.com', 220, rows[0]);
  c.fillText('000 000 0000', 220, rows[1]);
  c.fillText('Mon–Fri  7:00–17:00', 220, rows[2]);

  // doodle: your house on your plot
  const px = 1090, gy = 800;
  c.lineWidth = 5;
  hline(c, r, px - 30, gy, px + 420, gy, 3);
  c.save();
  c.setLineDash([16, 14]);
  c.beginPath();
  c.moveTo(px + 90, gy); c.lineTo(px + 90, gy - 140); c.lineTo(px + 195, gy - 225);
  c.lineTo(px + 300, gy - 140); c.lineTo(px + 300, gy);
  c.stroke();
  c.restore();
  font(c, 700, 110, HAND);
  c.textAlign = 'center';
  c.fillText('?', px + 195, gy - 40);
  c.textAlign = 'left';
  hline(c, r, px + 380, gy, px + 380, gy - 120, 1); // survey peg + flag
  c.fillStyle = YELLOW;
  c.beginPath();
  c.moveTo(px + 380, gy - 120); c.lineTo(px + 430, gy - 104); c.lineTo(px + 380, gy - 88);
  c.closePath();
  c.fill();
  c.fillStyle = YELLOW;
  c.strokeStyle = YELLOW;
  font(c, 700, 60, HAND);
  c.fillText('Free site visit', 1060, 470);
  c.lineWidth = 5;
  curveArrow(c, r, 1260, 500, 1330, 520, 1300, 570, 22);

  c.globalCompositeOperation = 'destination-out';
  speckle(c, r, w, h, 60000, ['#000'], [0.4, 1], [1, 3]);
  ctx.globalAlpha = 0.93;
  ctx.drawImage(layer, 0, 0);
  ctx.globalAlpha = 1;

  // chalk dust along the bottom edge
  const dust = ctx.createLinearGradient(0, h - 90, 0, h);
  dust.addColorStop(0, 'rgba(255,255,255,0)');
  dust.addColorStop(1, 'rgba(255,255,255,0.12)');
  ctx.fillStyle = dust;
  ctx.fillRect(0, h - 90, w, 90);
  for (let i = 0; i < 900; i++) {
    ctx.globalAlpha = 0.15 + r() * 0.35;
    ctx.fillStyle = '#fff';
    ctx.fillRect(r() * w, h - Math.pow(r(), 2) * 70, 2, 2);
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* 3D dressing (frames, trays, props)                                  */
/* ------------------------------------------------------------------ */

const std = (color, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

function box(g, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function frame(g, w, h, b, depth, z, mat) {
  box(g, w + 2 * b, b, depth, 0, h / 2 + b / 2, z, mat);
  box(g, w + 2 * b, b, depth, 0, -h / 2 - b / 2, z, mat);
  box(g, b, h, depth, -w / 2 - b / 2, 0, z, mat);
  box(g, b, h, depth, w / 2 + b / 2, 0, z, mat);
}

function backing(g, w, h, pad, depth, mat) {
  box(g, w + 2 * pad, h + 2 * pad, depth, 0, 0, -depth / 2 - 0.002, mat);
}

function stick(g, len, radius, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 12), std(color, 0.5));
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
}

const SPECS = {
  about: {
    draw: drawAbout,
    roughness: 0.65,
    dress(g, w, h) {
      backing(g, w, h, 0.03, 0.02, std(0xeeeae2, 0.9));
      frame(g, w, h, 0.045, 0.04, 0.004, std(0x1c1c1a, 0.45, 0.1));
    },
  },
  process: {
    draw: drawProcess,
    roughness: 0.45,
    dress(g, w, h) {
      backing(g, w, h, 0.02, 0.02, std(0xf2f4f5, 0.5));
      frame(g, w, h, 0.035, 0.032, 0.004, std(0xb9bec3, 0.35, 0.7));
      const ty = -h / 2 - 0.05;
      box(g, w * 0.62, 0.022, 0.075, 0, ty, 0.035, std(0xb9bec3, 0.35, 0.7));
      box(g, w * 0.62, 0.03, 0.006, 0, ty + 0.02, 0.07, std(0xb9bec3, 0.35, 0.7));
      stick(g, 0.13, 0.009, 0x1f4fbf, -0.35, ty + 0.02, 0.035);
      stick(g, 0.13, 0.009, 0xc8312b, -0.15, ty + 0.02, 0.04);
      stick(g, 0.13, 0.009, 0x24272b, 0.3, ty + 0.02, 0.035);
      box(g, 0.13, 0.035, 0.05, 0.55, ty + 0.028, 0.035, std(0x2a2a2a, 0.9)); // eraser
    },
  },
  services: {
    draw: drawServices,
    roughness: 0.7,
    emissive: 0x3a3a3a,
    dress(g, w, h) {
      backing(g, w, h, 0.08, 0.025, std(0xc9a77a, 0.85)); // plywood board
      frame(g, w + 0.16, h + 0.16, 0.02, 0.03, -0.012, std(0x4a3a28, 0.7));
    },
  },
  projects: {
    draw: drawProjects,
    roughness: 0.8,
    dress(g, w, h) {
      backing(g, w, h, 0.02, 0.02, std(0x8a5a33, 0.8));
      frame(g, w, h, 0.05, 0.04, 0.004, std(0x8a5a33, 0.6));
    },
  },
  contact: {
    draw: drawContact,
    roughness: 0.75,
    emissive: 0x4a4a4a,
    dress(g, w, h) {
      const wood = std(0x6b4a2e, 0.6);
      backing(g, w, h, 0.02, 0.02, std(0x1d2723, 0.9));
      frame(g, w, h, 0.06, 0.04, 0.004, wood);
      const ty = -h / 2 - 0.06 - 0.012;
      box(g, w + 0.12, 0.024, 0.085, 0, ty, 0.04, wood);
      stick(g, 0.08, 0.008, 0xf4f1e8, -0.6, ty + 0.02, 0.045);
      stick(g, 0.06, 0.008, 0xf6c453, -0.45, ty + 0.02, 0.05);
      box(g, 0.14, 0.035, 0.05, 0.7, ty + 0.03, 0.04, std(0x5a4a3a, 0.9));
    },
  },
};

/* ------------------------------------------------------------------ */
/* fonts                                                               */
/* ------------------------------------------------------------------ */

function ensureHandFonts() {
  const links = [...document.querySelectorAll('link[href*="fonts.googleapis.com"]')];
  const has = (name) => links.some((l) => l.href.includes(name));
  if (has('Caveat') && has('Permanent+Marker')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_CSS;
    link.onload = link.onerror = () => resolve();
    setTimeout(resolve, 4000);
    document.head.appendChild(link);
  });
}

function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  return ensureHandFonts()
    .then(() => Promise.all(FONT_SPECS.map((s) => document.fonts.load(s).catch(() => []))))
    .then(() => document.fonts.ready)
    .catch(() => {});
}

/* ------------------------------------------------------------------ */
/* public                                                              */
/* ------------------------------------------------------------------ */

export function createBoards(anchors) {
  const root = new THREE.Group();
  root.name = 'boards';
  const redraws = [];

  for (const id of ['about', 'services', 'process', 'projects', 'contact']) {
    const anchor = anchors && anchors[id];
    const spec = SPECS[id];
    if (!anchor) continue;
    const w = anchor.width ?? 2.4, h = anchor.height ?? 1.5;

    const g = new THREE.Group();
    g.name = `board-${id}`;
    g.userData.id = id;
    g.position.copy(anchor.position);
    g.rotation.y = anchor.rotationY ?? 0;

    const canvas = document.createElement('canvas');
    canvas.width = CW;
    canvas.height = Math.round((CW * h) / w);
    const ctx = canvas.getContext('2d');

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: new THREE.Color(spec.emissive ?? 0x333333),
      roughness: spec.roughness ?? 0.6,
      metalness: 0,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    plane.receiveShadow = true;
    plane.name = `board-${id}-face`;
    g.add(plane);
    spec.dress(g, w, h);

    const redraw = () => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      spec.draw(ctx, canvas.width, canvas.height);
      ctx.restore();
      tex.needsUpdate = true;
    };
    redraw(); // fallback fonts first
    redraws.push(redraw);
    root.add(g);
  }

  const redrawAll = () => redraws.forEach((fn) => fn());
  loadFonts().then(redrawAll);
  if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
    // catch any face that finishes late (e.g. slow network), for a short window
    let pending = 0;
    const onDone = () => { clearTimeout(pending); pending = setTimeout(redrawAll, 150); };
    document.fonts.addEventListener('loadingdone', onDone);
    setTimeout(() => document.fonts.removeEventListener('loadingdone', onDone), 10000);
  }
  root.userData.redraw = redrawAll;
  return root;
}
