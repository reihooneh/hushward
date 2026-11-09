// The home page: plans the example ward and shows it in 3D.
import { Engine, fmt, loadWard, money } from './engine.js';
import { WardScene } from './scene3d.js';

const $ = (id) => document.getElementById(id);

async function main() {
  const engine = new Engine();
  const scene = new WardScene($('hero'), { interactive: false, spin: true });
  const ward = await loadWard('surgical');
  scene.setWard(ward);
  scene.frame();
  const t0 = performance.now();
  const compiled = await engine.load(ward, null);
  const opt = await engine.optimise(compiled, 10000, true);
  const ms = performance.now() - t0;
  const free = await engine.optimise(compiled, 0, true);
  const today = await engine.evaluate(ward, compiled, 0);
  const heat = await engine.heat(0);
  const pct = (x) => `${Math.round((100 * (today.asIs - x)) / today.asIs)}%`;
  $('s-today').textContent = fmt(today.asIs, 0);
  $('s-patients').textContent = String(ward.patients.length);
  $('s-free').textContent = pct(free.best.total);
  $('s-plan').textContent = pct(opt.best.total);
  $('s-cost').textContent = money(opt.best.cost);
  $('s-time').textContent = `${fmt(ms / 1000)} s`;
  $('cap').textContent = `Best plan in $10,000: ${pct(opt.best.total)} fewer`;
  const vmax = Math.max(1, ...today.patients.map((p) => p.now));
  const wakes = new Map(ward.beds.map((b) => [b.id, null]));
  for (const p of today.patients) wakes.set(p.bed, p.now / vmax);
  scene.setState({ wakes });
  scene.setHeat(heat, Math.max(1, ...heat.values.filter(Number.isFinite)));
  document.body.dataset.ready = '1';
}

main().catch(() => {
  $('cap').textContent = "Couldn't run the example here";
  document.body.dataset.ready = '1';
});
