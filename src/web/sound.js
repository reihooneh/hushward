// The sound explainer: a room from above with its image sources, the parts of the level at the
// pillow, and level against distance for two ceilings. Uses the same room model as the core.
import { CEILINGS, KINDS, roomModel, wakeChance } from './model.js';
import { fmt } from './engine.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

for (const [k, v] of Object.entries(KINDS)) $('x-kind').append(new Option(v.name, k));
const state = { src: [0.2, 0.5] }; // as fractions of the room

function room() {
  const ceiling = $('x-ceiling').value;
  return { lx: Number($('x-len').value), ly: Number($('x-wid').value), lz: Number($('x-height').value), af: 0.2, aw: 0.1, ac: CEILINGS[ceiling].alpha };
}

function draw() {
  const r = room();
  const lw = Number($('x-level').value);
  const src = [state.src[0] * r.lx, state.src[1] * r.ly, 1.2];
  const pil = [Number($('x-px').value) * r.lx, Number($('x-py').value) * r.ly, 0.9];
  $('x-len-v').textContent = `${r.lx} m`;
  $('x-wid-v').textContent = `${r.ly} m`;
  $('x-height-v').textContent = `${r.lz.toFixed(1)} m`;
  $('x-level-v').textContent = `${lw} dB`;
  $('x-px-v').textContent = `${pil[0].toFixed(1)} m`;
  $('x-py-v').textContent = `${pil[1].toFixed(1)} m`;
  const m = roomModel(r, src, pil, lw);

  // The plan: the room in the middle of its eight mirror copies, a quarter of each showing.
  const c = $('x-plan');
  const boxW = c.parentElement.clientWidth - 28 || 500;
  const spanX = r.lx * 2;
  const spanY = r.ly * 2;
  const s = Math.min(boxW / spanX, 520 / spanY);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.round(spanX * s * dpr);
  c.height = Math.round(spanY * s * dpr);
  c.style.width = `${Math.round(spanX * s)}px`;
  c.style.height = `${Math.round(spanY * s)}px`;
  const g = c.getContext('2d');
  g.setTransform(dpr * s, 0, 0, dpr * s, dpr * s * (r.lx / 2), dpr * s * (r.ly / 2));
  const px = 1 / s;
  g.fillStyle = '#0a111d';
  g.fillRect(-r.lx / 2, -r.ly / 2, spanX, spanY);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    g.strokeStyle = i === 0 && j === 0 ? '#6f86ad' : '#22324f';
    g.lineWidth = (i === 0 && j === 0 ? 2.5 : 1) * px;
    if (i === 0 && j === 0) { g.fillStyle = '#1d2b46'; g.fillRect(0, 0, r.lx, r.ly); }
    g.strokeRect(i * r.lx, j * r.ly, r.lx, r.ly);
  }
  // Images that bounce off walls only (seen from above), with their paths to the pillow.
  const wallImages = m.images.filter((im) => im.order > 0 && im.walls === im.order);
  const strongest = Math.max(...wallImages.map((im) => im.e));
  for (const im of wallImages) {
    g.globalAlpha = 0.25 + 0.75 * Math.sqrt(im.e / strongest);
    g.strokeStyle = im.order === 1 ? '#8fb4ff' : '#c7a6ff';
    g.lineWidth = 1.5 * px;
    g.beginPath();
    g.moveTo(im.x, im.y);
    g.lineTo(pil[0], pil[1]);
    g.stroke();
    g.beginPath();
    g.arc(im.x, im.y, 0.18, 0, Math.PI * 2);
    g.fillStyle = g.strokeStyle;
    g.fill();
  }
  g.globalAlpha = 1;
  g.strokeStyle = '#f5b85b';
  g.lineWidth = 2.5 * px;
  g.beginPath();
  g.moveTo(src[0], src[1]);
  g.lineTo(pil[0], pil[1]);
  g.stroke();
  g.beginPath();
  g.arc(src[0], src[1], 0.3, 0, Math.PI * 2);
  g.fillStyle = '#ff8a8a';
  g.fill();
  g.fillStyle = '#e9eef6';
  g.fillRect(pil[0] - 0.25, pil[1] - 0.25, 0.5, 0.5);
  state.view = { s, ox: r.lx / 2, oy: r.ly / 2, r };

  $('r-total').textContent = `${m.level.toFixed(1)}`;
  $('r-direct').textContent = `${m.direct.toFixed(1)} dB`;
  $('r-early').textContent = `${m.early.toFixed(1)} dB`;
  $('r-reverb').textContent = `${m.reverb.toFixed(1)} dB`;
  $('r-rt').textContent = `${fmt(m.rt60)} s`;
  const kind = $('x-kind').value;
  const p = wakeChance(kind, m.level, 0);
  const pd = wakeChance(kind, m.level, 6);
  $('r-wake').textContent = `One ${KINDS[kind].name.toLowerCase()} at this level wakes a typical sleeper ${Math.round(p * 100)}% of the time, and a patient at risk of delirium ${Math.round(pd * 100)}% of the time (estimated).`;
  chart(r, lw);
  document.body.dataset.ready = '1';
}

function chart(r, lw) {
  const svg = $('x-chart');
  while (svg.lastChild && svg.lastChild.nodeName !== 'desc') svg.removeChild(svg.lastChild);
  const box = { x0: 70, x1: 700, y0: 20, y1: 280 };
  const maxD = Math.max(1, r.lx - 1);
  const pts = (ac) => {
    const out = [];
    for (let d = 0.5; d <= maxD + 1e-9; d += 0.25) {
      const m = roomModel({ ...r, ac }, [0.5, r.ly / 2, 1.2], [0.5 + d, r.ly / 2, 0.9], lw);
      out.push([d, m.level]);
    }
    return out;
  };
  const hard = pts(CEILINGS.hard.alpha);
  const soft = pts(CEILINGS.acoustic.alpha);
  const all = [...hard, ...soft].map((p) => p[1]);
  const lo = Math.floor(Math.min(...all) / 5) * 5;
  const hi = Math.ceil(Math.max(...all) / 5) * 5;
  const sx = (d) => box.x0 + ((d - 0.5) / Math.max(0.5, maxD - 0.5)) * (box.x1 - box.x0);
  const sy = (l) => box.y1 - ((l - lo) / Math.max(5, hi - lo)) * (box.y1 - box.y0);
  for (let l = lo; l <= hi; l += 5) {
    svg.append(svgEl('line', { x1: box.x0, x2: box.x1, y1: sy(l), y2: sy(l), stroke: '#2c3f5f' }));
    svg.append(svgEl('text', { x: box.x0 - 10, y: sy(l) + 5, 'text-anchor': 'end', 'font-size': 14, fill: '#a9b7cc' }, String(l)));
  }
  const step = maxD > 10 ? 4 : 2;
  for (let d = 2; d <= maxD; d += step) {
    svg.append(svgEl('text', { x: sx(d), y: box.y1 + 22, 'text-anchor': 'middle', 'font-size': 14, fill: '#a9b7cc' }, `${d} m`));
  }
  svg.append(svgEl('text', { x: (box.x0 + box.x1) / 2, y: 330, 'text-anchor': 'middle', 'font-size': 15, fill: '#e9eef6' }, 'Distance from the sound'));
  svg.append(svgEl('text', { x: 18, y: (box.y0 + box.y1) / 2, 'text-anchor': 'middle', 'font-size': 15, fill: '#e9eef6', transform: `rotate(-90 18 ${(box.y0 + box.y1) / 2})` }, 'dBA'));
  for (const [data, colour, dash] of [[hard, '#ff8a8a', ''], [soft, '#5fd3c6', '7 5']]) {
    svg.append(svgEl('polyline', { points: data.map(([d, l]) => `${sx(d)},${sy(l)}`).join(' '), fill: 'none', stroke: colour, 'stroke-width': 3, 'stroke-dasharray': dash }));
  }
}

function legend() {
  for (const [label, colour, dash] of [['Plasterboard ceiling', '#ff8a8a', ''], ['Acoustic tiles', '#5fd3c6', '7 5']]) {
    const li = document.createElement('li');
    const sw = document.createElementNS(NS, 'svg');
    sw.setAttribute('viewBox', '0 0 28 10');
    sw.setAttribute('width', '28');
    sw.setAttribute('height', '10');
    sw.setAttribute('aria-hidden', 'true');
    sw.append(svgEl('line', { x1: 0, x2: 28, y1: 5, y2: 5, stroke: colour, 'stroke-width': 3, 'stroke-dasharray': dash }));
    li.append(sw, document.createTextNode(` ${label}`));
    $('x-legend').append(li);
  }
}

// Dragging the sound or the pillow on the plan.
let drag = null;
const at = (e) => {
  const rect = $('x-plan').getBoundingClientRect();
  const v = state.view;
  return [(e.clientX - rect.left) / v.s - v.ox, (e.clientY - rect.top) / v.s - v.oy];
};
$('x-plan').addEventListener('pointerdown', (e) => {
  const [x, y] = at(e);
  const v = state.view.r;
  const src = [state.src[0] * v.lx, state.src[1] * v.ly];
  const pil = [Number($('x-px').value) * v.lx, Number($('x-py').value) * v.ly];
  const ds = Math.hypot(x - src[0], y - src[1]);
  const dp = Math.hypot(x - pil[0], y - pil[1]);
  if (Math.min(ds, dp) > 1.2) return;
  drag = ds < dp ? 'src' : 'pil';
  $('x-plan').setPointerCapture(e.pointerId);
});
$('x-plan').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const [x, y] = at(e);
  const v = state.view.r;
  const fx = Math.max(0.03, Math.min(0.97, x / v.lx));
  const fy = Math.max(0.03, Math.min(0.97, y / v.ly));
  if (drag === 'src') state.src = [fx, fy];
  else { $('x-px').value = String(fx); $('x-py').value = String(fy); }
  draw();
});
$('x-plan').addEventListener('pointerup', () => { drag = null; });
$('x-plan').style.touchAction = 'none';

for (const id of ['x-len', 'x-wid', 'x-height', 'x-ceiling', 'x-kind', 'x-level', 'x-px', 'x-py']) $(id).addEventListener('input', draw);
window.addEventListener('resize', draw);
legend();
draw();
