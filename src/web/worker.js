// Runs the WebAssembly core off the main thread. Messages carry only numbers.
let core = null;

async function load() {
  if (!core) {
    const res = await fetch('../hushward.wasm');
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
    core = instance.exports;
  }
  return core;
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const out = (e) => Array.from(new Float64Array(e.memory.buffer, e.outPtr(), e.outLength()));

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    const e = await load();
    let code;
    if (type === 'load') {
      const n = data.numbers;
      if (!Array.isArray(n) || n.length < 1 || n.length > 4096 || !n.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('Bad request');
      new Float64Array(e.memory.buffer, e.inputPtr(), n.length).set(n);
      code = e.load(n.length);
      if (code !== 0) throw new Error('The ward has values out of range');
      self.postMessage({ id, ok: true, result: [] });
      return;
    }
    if (type === 'evaluate') {
      if (!isInt(data.mask, 0, 16383)) throw new Error('Bad request');
      code = e.evaluate(data.mask);
    } else if (type === 'optimise') {
      if (!isNum(data.budget, 0, 1e8) || !isInt(data.reassign, 0, 1)) throw new Error('Bad request');
      code = e.optimise(data.budget, data.reassign);
    } else if (type === 'heat') {
      if (!isInt(data.mask, 0, 16383) || !isNum(data.cell, 0.1, 2) || !isNum(data.shift, -20, 20)) throw new Error('Bad request');
      code = e.heat(data.mask, data.cell, data.shift);
    } else {
      throw new Error('Unknown request');
    }
    if (code !== 0) throw new Error('The core refused that request');
    self.postMessage({ id, ok: true, result: out(e) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err.message || err) });
  }
};
