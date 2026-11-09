// The page's handle on the core: one worker, requests answered in order as promises.
import { checkWard, compile, decodeEvaluate, decodeOptimise } from './model.js';

export class Engine {
  constructor() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url));
    this.pending = new Map();
    this.next = 1;
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.ok) p.resolve(data.result);
      else p.reject(new Error(data.error));
    };
  }
  call(msg) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }
  /** Loads a ward with the allowed changes; resolves to the compiled tables. */
  async load(ward, enabled) {
    const compiled = compile(ward, enabled);
    await this.call({ type: 'load', numbers: compiled.numbers });
    return compiled;
  }
  async evaluate(ward, compiled, mask) {
    return decodeEvaluate(await this.call({ type: 'evaluate', mask }), ward, compiled);
  }
  async optimise(compiled, budget, reassign) {
    return decodeOptimise(await this.call({ type: 'optimise', budget, reassign: reassign ? 1 : 0 }), compiled);
  }
  async heat(mask, cell = 0.25, shift = 0) {
    const o = await this.call({ type: 'heat', mask, cell, shift });
    return { nx: o[0], ny: o[1], x0: o[2], y0: o[3], cell: o[4], values: o.slice(5) };
  }
}

export async function loadWard(name) {
  const res = await fetch(`assets/wards/${name}.json`);
  if (!res.ok) throw new Error('Could not load the example ward');
  return checkWard(await res.json());
}

export const money = (n) => `$${Math.round(n).toLocaleString('en-AU')}`;
export const fmt = (n, d = 1) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Colour for a value on the night scale (0 quiet .. 1 loud). */
export function heatColour(t) {
  const stops = [[18, 50, 74], [29, 107, 120], [201, 161, 74], [224, 86, 108]];
  const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f));
}
