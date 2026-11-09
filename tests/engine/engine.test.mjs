// Tests for the ward model and the WebAssembly core: physics with known answers, and the
// optimisers against brute force.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkWard, compile, decodeEvaluate, decodeOptimise, roomModel, WardError, NEEDS, KINDS } from '../../src/web/model.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const WARDS = { surgical: read('../../wards/surgical.json'), open: read('../../wards/open-ward.json') };
const bytes = readFileSync(new URL('../../site/assets/hushward.wasm', import.meta.url));

async function core() {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const e = instance.exports;
  const out = () => Array.from(new Float64Array(e.memory.buffer, e.outPtr(), e.outLength()));
  return {
    e,
    load(numbers) {
      new Float64Array(e.memory.buffer, e.inputPtr(), numbers.length).set(numbers);
      return e.load(numbers.length);
    },
    evaluate(mask) { assert.equal(e.evaluate(mask), 0); return out(); },
    optimise(budget, reassign) { assert.equal(e.optimise(budget, reassign), 0); return out(); },
  };
}

/** A small ward: a corridor and two rooms, each with a bed; a sound in room A. */
function tiny({ ceiling = 'hard', options = [] } = {}) {
  return {
    name: 'Tiny',
    rooms: [
      { id: 'corridor', name: 'Corridor', rect: [0, 6, 20, 8], height: 2.7, ceiling: 'hard', kind: 'corridor' },
      { id: 'a', name: 'A', rect: [0, 0, 6, 6], height: 2.7, ceiling, kind: 'room', door: [3, 6], doorWidth: 1 },
      { id: 'b', name: 'B', rect: [12, 0, 18, 6], height: 2.7, ceiling: 'hard', kind: 'room', door: [15, 6], doorWidth: 1 },
    ],
    beds: [{ id: 'a1', room: 'a', at: [1.5, 1.5] }, { id: 'b1', room: 'b', at: [16, 2] }],
    patients: [{ name: 'P', needs: 'general', bed: 'a1' }],
    sources: [{ id: 'beep', name: 'Beep', kind: 'alarm', room: 'a', at: [4, 4], level: 70, perNight: 5 }],
    options,
  };
}

test('the core imports nothing', () => {
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(bytes)), []);
});

test('free field: doubling the distance takes off 6 dB; reverberation time is Sabine', () => {
  const dead = { lx: 40, ly: 40, lz: 40, af: 0.99, aw: 0.99, ac: 0.99 };
  const a = roomModel(dead, [20, 20, 20], [22, 20, 20], 80);
  const b = roomModel(dead, [20, 20, 20], [24, 20, 20], 80);
  assert.ok(Math.abs(a.direct - b.direct - 20 * Math.log10(2)) < 1e-9);
  assert.ok(Math.abs(a.level - b.level - 6) < 0.2);
  // Lp = Lw - 10 log10(4 pi r^2): at 1 m, 11 dB below the sound power.
  const one = roomModel(dead, [20, 20, 20], [21, 20, 20], 80);
  assert.ok(Math.abs(one.direct - (80 - 10 * Math.log10(4 * Math.PI))) < 1e-9);
  const room = { lx: 9, ly: 9, lz: 2.7, af: 0.2, aw: 0.1, ac: 0.05 };
  const A = 81 * 0.2 + 81 * 0.05 + 2 * 18 * 2.7 * 0.1;
  assert.ok(Math.abs(roomModel(room, [1, 1, 1], [5, 5, 1], 70).rt60 - (0.161 * 9 * 9 * 2.7) / A) < 1e-12);
  assert.equal(roomModel(room, [1, 1, 1], [5, 5, 1], 70).images.length, 25);
});

test('acoustic tiles lower the level far from a sound more than close to it', () => {
  const hard = { lx: 12, ly: 9, lz: 2.7, af: 0.2, aw: 0.1, ac: 0.05 };
  const soft = { ...hard, ac: 0.7 };
  const near = roomModel(hard, [1, 4.5, 1.2], [2, 4.5, 0.9], 70).level - roomModel(soft, [1, 4.5, 1.2], [2, 4.5, 0.9], 70).level;
  const far = roomModel(hard, [1, 4.5, 1.2], [11, 4.5, 0.9], 70).level - roomModel(soft, [1, 4.5, 1.2], [11, 4.5, 0.9], 70).level;
  assert.ok(near > 0 && far > near + 1, `near ${near} far ${far}`);
});

test('the core matches the JavaScript room model, and closing a door takes off its extra loss', async () => {
  const k = await core();
  const w = checkWard(tiny({ options: [{ id: 'shut', name: 'Shut B', cost: 10, effects: [{ close: 'b' }] }, { id: 'shut-a', name: 'Shut A', cost: 10, effects: [{ close: 'a' }] }] }));
  const c = compile(w);
  assert.equal(k.load(c.numbers), 0);
  const open = decodeEvaluate(k.evaluate(0), w, c);
  const js = roomModel({ lx: 6, ly: 6, lz: 2.7, af: 0.15, aw: 0.06, ac: 0.05 }, [4, 4, 1.2], [1.5, 1.5, 0.9], 70);
  assert.ok(Math.abs(open.levels[0][0] - js.level) < 0.01, `${open.levels[0][0]} vs ${js.level}`);
  const shutB = decodeEvaluate(k.evaluate(1), w, c);
  const shutBoth = decodeEvaluate(k.evaluate(3), w, c);
  assert.ok(Math.abs(open.levels[0][1] - shutB.levels[0][1] - 16) < 1e-9, 'B is 16 dB quieter with its door shut');
  assert.ok(Math.abs(open.levels[0][1] - shutBoth.levels[0][1] - 32) < 1e-9, 'and 32 dB with both doors shut');
  assert.equal(shutB.levels[0][0], open.levels[0][0], 'the bed in the same room is unchanged');
});

// ---------- brute force ----------
function* permutations(a) {
  if (a.length <= 1) { yield a; return; }
  for (let i = 0; i < a.length; i++) for (const p of permutations([...a.slice(0, i), ...a.slice(i + 1)])) yield [a[i], ...p];
}

function randomWard(rng) {
  const r = () => rng();
  const rooms = [{ id: 'corridor', name: 'Corridor', rect: [0, 6, 30, 8], height: 2.7, ceiling: 'hard', kind: 'corridor' }];
  const beds = [];
  const nRooms = 2 + Math.floor(r() * 3);
  for (let i = 0; i < nRooms; i++) {
    const x = i * 7;
    rooms.push({ id: `r${i}`, name: `Room ${i}`, rect: [x, 0, x + 6, 6], height: 2.7, ceiling: r() < 0.3 ? 'acoustic' : 'hard', kind: r() < 0.5 ? 'bay' : 'room', door: [x + 1 + r() * 4, 6], doorWidth: 1.2 });
    const nb = 1 + Math.floor(r() * 2);
    for (let j = 0; j < nb; j++) beds.push({ id: `b${i}${j}`, room: `r${i}`, at: [x + 1 + 4 * r(), 1 + 4 * r()] });
  }
  const needs = Object.keys(NEEDS);
  const nPat = Math.min(beds.length, 1 + Math.floor(r() * beds.length));
  const patients = beds.slice(0, nPat).map((b, i) => ({ name: `P${i}`, needs: needs[Math.floor(r() * needs.length)], bed: b.id }));
  const sources = [];
  const kinds = ['alarm', 'talk', 'phone', 'impact', 'trolley'];
  for (let s = 0; s < 3 + Math.floor(r() * 4); s++) {
    if (r() < 0.4) sources.push({ id: `s${s}`, name: `S${s}`, kind: kinds[s % 5], room: 'corridor', at: [r() * 29, 6.5 + r()], level: 60 + r() * 25, perNight: 1 + Math.floor(r() * 10) });
    else {
      const rm = rooms[1 + Math.floor(r() * nRooms)];
      sources.push({ id: `s${s}`, name: `S${s}`, kind: kinds[s % 5], room: rm.id, at: [rm.rect[0] + 0.5 + 5 * r(), 0.5 + 5 * r()], level: 60 + r() * 25, perNight: 1 + Math.floor(r() * 10) });
    }
  }
  const options = [];
  const nOpt = 2 + Math.floor(r() * 4);
  for (let o = 0; o < nOpt; o++) {
    const kind = Math.floor(r() * 3);
    const rm = rooms[1 + Math.floor(r() * nRooms)].id;
    const effects = kind === 0 ? [{ ceiling: rm }] : kind === 1 ? [{ close: rm }] : [{ quieter: sources[Math.floor(r() * sources.length)].id, by: 5 + Math.floor(r() * 10) }];
    options.push({ id: `o${o}`, name: `O${o}`, cost: Math.floor(r() * 5000), effects, ...(o >= 2 && r() < 0.4 ? { group: 'g' } : {}) });
  }
  return { name: 'Random', rooms, beds, patients, sources, options };
}

test('bed assignment and the budget search match brute force', async () => {
  const k = await core();
  let seed = 7;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let checked = 0;
  for (let t = 0; t < 40; t++) {
    const w = checkWard(randomWard(rng));
    const c = compile(w, null, 0.5);
    assert.equal(k.load(c.numbers), 0, `ward ${t}`);
    const n = c.options.length;
    const valid = (m) => {
      const groups = c.options.filter((_, i) => Math.floor(m / 2 ** i) % 2 && c.options[i].group).map((o) => o.group);
      return new Set(groups).size === groups.length;
    };
    // Brute force: every mask, every arrangement of patients.
    const brute = [];
    for (let m = 0; m < 2 ** n; m++) {
      if (!valid(m)) continue;
      const ev = decodeEvaluate(k.evaluate(m), w, c);
      // wakes of patient p in bed b: unweighted levels -> recompute from levels with the same curve
      const wake = (p, b) => w.sources.reduce((s, src, si) => {
        const kd = [KINDS[src.kind].l50, KINDS[src.kind].slope];
        return s + src.perNight / (1 + Math.exp(-(ev.levels[si][b] - (kd[0] - NEEDS[w.patients[p].needs].shift)) / kd[1]));
      }, 0);
      const P = w.patients.length;
      const B = c.beds.length;
      let best = Infinity;
      let bestTrue = Infinity;
      for (const perm of permutations([...Array(B).keys()])) {
        let cost = 0;
        let real = 0;
        for (let p = 0; p < P; p++) {
          const wk = NEEDS[w.patients[p].needs].weight * wake(p, perm[p]);
          real += wk;
          cost += wk + (perm[p] !== p ? 0.5 : 0);
        }
        if (cost < best - 1e-9) { best = cost; bestTrue = real; }
      }
      assert.ok(Math.abs(ev.best - bestTrue) < 1e-6, `assignment ward ${t} mask ${m}: ${ev.best} vs ${bestTrue}`);
      const cost = c.options.reduce((s, o, i) => s + (Math.floor(m / 2 ** i) % 2 ? o.cost : 0), 0);
      brute.push({ m, cost, total: ev.best });
      checked++;
    }
    for (const budget of [0, 2000, 6000, 1e6]) {
      const op = decodeOptimise(k.optimise(budget, 1), c);
      const fits = brute.filter((b) => b.cost <= budget + 1e-9);
      const want = Math.min(...fits.map((b) => b.total));
      assert.ok(Math.abs(op.best.total - want) < 1e-9, `budget ${budget} ward ${t}`);
      assert.ok(op.best.cost <= budget + 1e-9);
      // The frontier is cheapest-first and strictly improving.
      for (let i = 1; i < op.frontier.length; i++) {
        assert.ok(op.frontier[i].cost >= op.frontier[i - 1].cost && op.frontier[i].total < op.frontier[i - 1].total);
      }
    }
  }
  assert.ok(checked > 200, `checked ${checked}`);
});

test('the example wards plan sensibly', async () => {
  const k = await core();
  for (const raw of Object.values(WARDS)) {
    const w = checkWard(raw);
    const c = compile(w);
    assert.equal(k.load(c.numbers), 0);
    const today = decodeEvaluate(k.evaluate(0), w, c);
    const op = decodeOptimise(k.optimise(10000, 1), c);
    assert.ok(op.best.cost <= 10000 && op.best.total < today.asIs * 0.7);
    assert.ok(today.rt.every((t) => t > 0.3 && t < 3), today.rt.join());
  }
});

test('hostile wards are refused without echoing them', () => {
  const base = WARDS.surgical;
  const bad = [
    [{ ...base, extra: 1 }, /unknown field/],
    [{ ...base, name: '<img src=x onerror=alert(1)>' }, /aren't allowed/],
    [{ ...base, name: 'a‮b' }, /aren't allowed/],
    [{ ...base, rooms: base.rooms.filter((r) => r.kind !== 'corridor') }, /exactly one corridor/],
    [{ ...base, rooms: [{ ...base.rooms[0], rect: [0, 0, Number.NaN, 5] }, ...base.rooms.slice(1)] }, /rect/],
    [{ ...base, beds: [{ ...base.beds[0], at: [500, 1] }] }, /must be a number/],
    [{ ...base, beds: Array(30).fill(base.beds[0]) }, /list of 1 to 24/],
    [{ ...base, sources: [{ ...base.sources[0], level: 1e9 }] }, /level/],
    [{ ...base, sources: [{ ...base.sources[0], kind: 'siren' }] }, /unknown kind/],
    [{ ...base, patients: [base.patients[0], base.patients[0]] }, /bed of their own/],
    [{ ...base, options: [{ id: 'x', name: 'X', cost: 1, effects: [{ explode: 'bay-a' }] }] }, /unknown field/],
    [{ ...base, options: [{ id: 'x', name: 'X', cost: 1, effects: [{ move: 'station-talk', to: [3, 3] }] }] }, /within its room/],
    [JSON.parse('{"__proto__": {"x": 1}}'), /unknown field/],
    [null, /must be an object/],
  ];
  for (const [w, msg] of bad) {
    assert.throws(() => checkWard(w), (e) => e instanceof WardError && msg.test(e.message) && !/onerror|siren|explode/.test(e.message), String(msg));
  }
});

test('the core refuses bad numbers', async () => {
  const k = await core();
  const c = compile(checkWard(WARDS.open));
  for (const [i, v] of [[1, 99], [2, Number.NaN], [6, 0], [3, 1e9]]) {
    const n = c.numbers.slice();
    n[i] = v;
    assert.equal(k.load(n), 1, `numbers[${i}] = ${v}`);
  }
  assert.equal(k.load(c.numbers.slice(0, 30)), 1);
  assert.equal(k.load(c.numbers), 0);
  assert.equal(k.e.evaluate(-1), 1);
  assert.equal(k.e.evaluate(1 << 14), 1);
  assert.equal(k.e.heat(0, 0.01, 0), 1);
});
