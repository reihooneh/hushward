// The planner page.
import { NEEDS, checkWard, WardError } from './model.js';
import { Engine, fmt, loadWard, money } from './engine.js';
import { WardScene } from './scene3d.js';
import { PlanView } from './plan2d.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e[k] = v;
  }
  e.append(...kids);
  return e;
};
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

const engine = new Engine();
const scene = new WardScene($('c3d'));
const plan2d = new PlanView($('c2d'));
const state = { wards: {}, key: 'surgical', ward: null, enabled: null, budget: 10000, reassign: true, view: 'plan', mode: '3d', token: 0 };

const setStatus = (t) => { $('status').textContent = t; };

async function selectWard(key) {
  state.key = key;
  if (!state.wards[key]) state.wards[key] = await loadWard(key);
  state.ward = structuredClone(state.wards[key]);
  state.enabled = new Set(state.ward.options.map((o) => o.id));
  $('ward').value = key;
  $('summary').textContent = state.ward.summary;
  scene.setWard(state.ward);
  scene.frame();
  plan2d.setWard(state.ward);
  renderMods();
  await run();
}

let timer = null;
const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 150); };

async function run() {
  const token = ++state.token;
  setStatus('Trying every combination of changes and beds…');
  const t0 = performance.now();
  try {
    const compiled = await engine.load(state.ward, state.enabled);
    const opt = await engine.optimise(compiled, state.budget, state.reassign);
    const today = await engine.evaluate(state.ward, compiled, 0);
    const planned = await engine.evaluate(state.ward, compiled, opt.best.mask);
    const heatToday = await engine.heat(0);
    const heatPlan = await engine.heat(opt.best.mask);
    if (token !== state.token) return;
    state.result = { compiled, opt, today, planned, heatToday, heatPlan };
    state.vmax = Math.max(1, ...heatToday.values.filter(Number.isFinite));
    render();
    const n = compiled.options.length;
    setStatus(`Compared every combination of ${n} changes${state.reassign ? ', each with the best bed for every patient,' : ''} in ${fmt((performance.now() - t0) / 1000)} s.`);
    document.body.dataset.ready = '1';
  } catch (err) {
    if (token !== state.token) return;
    setStatus(err instanceof WardError ? err.message : `Couldn't plan this ward: ${err.message}`);
  }
}

function render() {
  const { opt, today, planned } = state.result;
  const best = opt.best;
  const after = best.total;
  const drop = today.asIs > 0 ? Math.round((100 * (today.asIs - after)) / today.asIs) : 0;
  $('headline').textContent = `Weighted arousals a night: ${fmt(today.asIs)} today, ${fmt(after)} with this plan (${drop}% fewer).`;
  $('total').textContent = best.cost === 0 ? (best.options.length ? 'Free' : 'No changes') : money(best.cost);
  $('plan').replaceChildren(...best.options.map((o) => el('li', {}, el('span', { text: o.name }), el('span', { text: o.cost ? money(o.cost) : 'free' }))));
  const moves = state.reassign ? planned.patients.filter((p) => p.bestBed !== p.bed) : [];
  $('moves').textContent = moves.length ? `Move ${moves.length} patient${moves.length === 1 ? '' : 's'}: ${moves.map((p) => `${p.name} to bed ${p.bestBed.toUpperCase()}`).join(', ')}.` : state.reassign ? 'Everyone stays in their bed.' : '';
  $('patients').replaceChildren(...today.patients.map((p, k) => {
    const q = planned.patients[k];
    const bed = state.reassign ? q.bestBed : q.bed;
    const val = state.reassign ? q.there : q.now;
    return el('tr', {}, el('td', { text: p.name }), el('td', { text: NEEDS[p.needs].name }), el('td', { text: `${p.bed.toUpperCase()}: ${fmt(p.now)}` }),
      el('td', {}, el('span', { text: `${bed.toUpperCase()}: ` }), el('span', { class: val < p.now - 0.05 ? 'down' : val > p.now + 0.05 ? 'up' : '', text: fmt(val) })));
  }));
  renderFrontier();
  show();
}

function renderFrontier() {
  const { frontier, best } = state.result.opt;
  const s = $('frontier');
  while (s.lastChild && s.lastChild.nodeName !== 'title') s.removeChild(s.lastChild);
  const box = { x0: 56, x1: 405, y0: 14, y1: 215 };
  const maxC = Math.max(1000, ...frontier.map((f) => f.cost), state.budget);
  const maxT = Math.max(1, ...frontier.map((f) => f.total));
  const sx = (c) => box.x0 + (c / maxC) * (box.x1 - box.x0);
  const sy = (t) => box.y1 - (t / maxT) * (box.y1 - box.y0);
  for (let k = 0; k <= 4; k++) {
    const t = (maxT * k) / 4;
    s.append(svg('line', { x1: box.x0, x2: box.x1, y1: sy(t), y2: sy(t), stroke: '#2c3f5f' }));
    s.append(svg('text', { x: box.x0 - 8, y: sy(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#a9b7cc' }, Math.round(t).toLocaleString('en-AU')));
  }
  for (let k = 0; k <= 3; k++) {
    const c = (maxC * k) / 3;
    s.append(svg('text', { x: sx(c), y: box.y1 + 18, 'text-anchor': k === 0 ? 'start' : k === 3 ? 'end' : 'middle', 'font-size': 11, fill: '#a9b7cc' }, c === 0 ? '$0' : `$${Math.round(c / 1000)}k`));
  }
  s.append(svg('text', { x: (box.x0 + box.x1) / 2, y: 252, 'text-anchor': 'middle', 'font-size': 12, fill: '#e9eef6' }, 'Cost'));
  let d = '';
  frontier.forEach((f, k) => {
    d += k ? ` H ${sx(f.cost)} V ${sy(f.total)}` : `M ${sx(f.cost)} ${sy(f.total)}`;
  });
  if (frontier.length) d += ` H ${box.x1}`;
  s.append(svg('path', { d, fill: 'none', stroke: '#5fd3c6', 'stroke-width': 2.5 }));
  s.append(svg('line', { x1: sx(state.budget), x2: sx(state.budget), y1: box.y0, y2: box.y1, stroke: '#f5b85b', 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
  s.append(svg('circle', { cx: sx(best.cost), cy: sy(best.total), r: 6, fill: '#f5b85b', stroke: '#0e1726', 'stroke-width': 2 }));
}

async function show() {
  const r = state.result;
  if (!r) return;
  const planView = state.view === 'plan';
  const ev = planView ? r.planned : r.today;
  const mask = planView ? r.opt.best.mask : 0;
  const chosen = r.compiled.options.filter((_, k) => Math.floor(mask / 2 ** k) % 2 === 1);
  const closed = new Set();
  const tiles = new Set();
  const moved = new Map();
  const quiet = new Map();
  for (const o of chosen) {
    for (const e of o.effects) {
      if (e.kind === 'close') closed.add(e.room);
      else if (e.kind === 'ceiling') tiles.add(e.room);
      else if (e.kind === 'move') moved.set(e.source, e.to);
      else for (const sid of e.sources) quiet.set(sid, (quiet.get(sid) ?? 0) + e.by);
    }
  }
  for (const room of state.ward.rooms) if (room.ceiling === 'acoustic') tiles.add(room.id);
  const vmax = Math.max(1, ...r.today.patients.map((p) => p.now));
  const wakes = new Map(state.ward.beds.map((b) => [b.id, null]));
  for (const p of ev.patients) {
    const bed = planView && state.reassign ? p.bestBed : p.bed;
    wakes.set(bed, (planView && state.reassign ? p.there : p.now) / vmax);
  }
  const arrows = planView && state.reassign ? ev.patients.filter((p) => p.bestBed !== p.bed).map((p) => [p.bed, p.bestBed]) : [];
  const heat = planView ? r.heatPlan : r.heatToday;
  scene.setState({ closed, tiles, moved, quiet, wakes });
  scene.setHeat(heat, state.vmax);
  plan2d.set({ heat, vmax: state.vmax, closed, tiles, moved, wakes, arrows });
  $('scale-max').textContent = `${fmt(state.vmax, 0)} arousals a night`;
}

function renderMods() {
  const box = $('mods');
  box.replaceChildren();
  for (const o of state.ward.options) {
    const input = el('input', { type: 'checkbox', checked: state.enabled.has(o.id) });
    input.addEventListener('change', () => {
      if (input.checked) state.enabled.add(o.id);
      else state.enabled.delete(o.id);
      schedule();
    });
    box.append(el('label', {}, input, el('span', { text: o.group ? `${o.name} (one of a choice)` : o.name }), el('span', { class: 'cost', text: o.cost ? money(o.cost) : 'free' })));
  }
}

// ---------- Controls ----------
$('ward').addEventListener('change', () => selectWard($('ward').value));
$('budget').addEventListener('input', () => {
  state.budget = Number($('budget').value);
  $('budget-v').textContent = money(state.budget);
  schedule();
});
$('reassign').addEventListener('change', () => { state.reassign = $('reassign').checked; schedule(); });
for (const [id, view] of [['v-today', 'today'], ['v-plan', 'plan']]) {
  $(id).addEventListener('click', () => {
    state.view = view;
    $('v-today').setAttribute('aria-pressed', String(view === 'today'));
    $('v-plan').setAttribute('aria-pressed', String(view === 'plan'));
    show();
  });
}
for (const [id, mode] of [['v-3d', '3d'], ['v-2d', '2d']]) {
  $(id).addEventListener('click', () => {
    state.mode = mode;
    $('v-3d').setAttribute('aria-pressed', String(mode === '3d'));
    $('v-2d').setAttribute('aria-pressed', String(mode === '2d'));
    $('stage').hidden = mode !== '3d';
    $('plan2d').hidden = mode !== '2d';
    if (mode === '2d') plan2d.draw();
    else scene.resize();
  });
}
$('save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.ward, null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'hushward-ward.json' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  $('file').value = '';
  const err = $('load-error');
  err.hidden = true;
  if (!file) return;
  try {
    if (file.size > 200_000) throw new WardError('That file is too big for a ward (over 200 KB)');
    let json;
    try { json = JSON.parse(await file.text()); } catch { throw new WardError("That file isn't valid JSON"); }
    state.wards.custom = checkWard(json);
    $('ward').querySelector('option[value="custom"]').hidden = false;
    await selectWard('custom');
  } catch (e) {
    err.textContent = e instanceof WardError ? e.message : "Couldn't read that ward.";
    err.hidden = false;
  }
});

$('budget-v').textContent = money(state.budget);
selectWard('surgical').catch((e) => setStatus(`Couldn't start: ${e.message}`));
