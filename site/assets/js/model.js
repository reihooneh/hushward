// Hushward's ward model: checks a ward description, and turns it into the numbers the core reads.
// Used by the pages, the worker and the tests (no DOM here). Plan coordinates are metres.

export const LIMITS = { rooms: 24, beds: 24, sources: 48, options: 14, effects: 64, text: 60 };

/** How easily each kind of sound wakes someone: the level (dBA at the ear) at which half of
 *  events cause an awakening, and how quickly the chance rises around it. Illustrative values in
 *  the range reported for hospital sounds; electronic alarms wake people at lower levels. */
export const KINDS = {
  alarm: { name: 'Equipment alarm', l50: 55, slope: 5 },
  talk: { name: 'Voices', l50: 62, slope: 6 },
  phone: { name: 'Phone', l50: 58, slope: 5 },
  impact: { name: 'Bang or clatter', l50: 58, slope: 5 },
  trolley: { name: 'Trolley or cart', l50: 62, slope: 6 },
};

/** Patients' needs: how much an awakening matters (weight) and how much lower their threshold
 *  is (dB). Weights express clinical priority for the plan, not a measurement. */
export const NEEDS = {
  general: { name: 'General', weight: 1, shift: 0 },
  postop: { name: 'Recovering from surgery', weight: 1.5, shift: 3 },
  delirium: { name: 'At risk of delirium', weight: 3, shift: 6 },
  palliative: { name: 'End of life care', weight: 2, shift: 3 },
  light: { name: 'Light sleeper', weight: 1, shift: 5 },
};

export const CEILINGS = { hard: { name: 'Plasterboard', alpha: 0.05 }, acoustic: { name: 'Acoustic tiles', alpha: 0.7 } };
// Floors carry the absorption of everything standing on them too (beds, curtains, people, chairs),
// which is why the floors of bays and rooms absorb far more than bare vinyl would.
const FLOOR_ALPHA = { bay: 0.2, room: 0.15, corridor: 0.04 };
const WALL_ALPHA = { bay: 0.1, room: 0.06, corridor: 0.05 }; // bays have curtains
const DOOR_HEIGHT = 2.1;
const OPEN_LOSS = 2; // dB: the open doorway itself is in the aperture formula; a little diffraction
const CLOSED_LOSS = 25; // dB: a typical solid ward door with gaps

class WardError extends Error {}
const fail = (msg) => { throw new WardError(msg); };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function num(v, lo, hi, what) {
  if (!isNum(v) || v < lo || v > hi) fail(`${what} must be a number from ${lo} to ${hi}`);
  return v;
}
function text(v, what) {
  if (typeof v !== 'string' || v.length < 1 || v.length > LIMITS.text) fail(`${what} must be text of 1 to ${LIMITS.text} characters`);
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069<>]/.test(v)) fail(`${what} contains characters that aren't allowed`);
  return v;
}
function id(v, what) {
  if (typeof v !== 'string' || !/^[a-z][a-z0-9-]{0,23}$/.test(v)) fail(`${what} must be a short id (a-z, 0-9, -)`);
  return v;
}
function list(v, max, what, min = 0) {
  if (!Array.isArray(v) || v.length > max || v.length < min) fail(`${what} must be a list of ${min} to ${max}`);
  return v;
}
function obj(v, keys, what) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(`${what} must be an object`);
  for (const k of Object.keys(v)) if (!keys.includes(k)) fail(`${what} has an unknown field`);
  return v;
}
function point(v, what) {
  if (!Array.isArray(v) || v.length !== 2) fail(`${what} must be [x, y]`);
  return [num(v[0], 0, 200, what), num(v[1], 0, 200, what)];
}
const insideRect = (r, [x, y]) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];

/** Checks a ward and returns a clean copy. Throws a WardError (never echoing the input). */
export function checkWard(w) {
  obj(w, ['name', 'summary', 'rooms', 'beds', 'patients', 'sources', 'options'], 'The ward');
  const name = text(w.name, 'The name');
  const summary = w.summary === undefined ? '' : (typeof w.summary === 'string' && w.summary.length <= 300 && !/[<>\u0000-\u001f]/.test(w.summary) ? w.summary : fail('The summary must be plain text of at most 300 characters'));
  const roomIds = new Map();
  const rooms = list(w.rooms, LIMITS.rooms, 'rooms', 2).map((r, k) => {
    const what = `room ${k + 1}`;
    obj(r, ['id', 'name', 'rect', 'height', 'ceiling', 'kind', 'door', 'doorWidth'], what);
    if (!Array.isArray(r.rect) || r.rect.length !== 4) fail(`${what} rect must be [x0, y0, x1, y1]`);
    const rect = r.rect.map((v) => num(v, 0, 200, `${what} rect`));
    if (rect[2] - rect[0] < 1 || rect[3] - rect[1] < 1) fail(`${what} must be at least 1 m each way`);
    if (!['bay', 'room', 'corridor'].includes(r.kind)) fail(`${what} kind must be bay, room or corridor`);
    if (!(r.ceiling in CEILINGS)) fail(`${what} ceiling must be hard or acoustic`);
    const out = { id: id(r.id, what), name: text(r.name, `${what} name`), rect, height: num(r.height, 2, 6, `${what} height`), ceiling: r.ceiling, kind: r.kind };
    if (roomIds.has(out.id)) fail(`${what}: the id is used twice`);
    if (r.kind !== 'corridor') {
      out.door = point(r.door, `${what} door`);
      out.doorWidth = num(r.doorWidth, 0.7, 2.5, `${what} door width`);
      const [x, y] = out.door;
      const onEdge = (Math.abs(x - rect[0]) < 1e-6 || Math.abs(x - rect[2]) < 1e-6 || Math.abs(y - rect[1]) < 1e-6 || Math.abs(y - rect[3]) < 1e-6) && insideRect(rect, out.door);
      if (!onEdge) fail(`${what}: the door must be on the room's edge`);
    }
    roomIds.set(out.id, k);
    return out;
  });
  if (rooms.filter((r) => r.kind === 'corridor').length !== 1) fail('A ward needs exactly one corridor');
  const room = (rid, what) => (roomIds.has(rid) ? rooms[roomIds.get(rid)] : fail(`${what}: unknown room`));

  const bedIds = new Map();
  const beds = list(w.beds, LIMITS.beds, 'beds', 1).map((b, k) => {
    const what = `bed ${k + 1}`;
    obj(b, ['id', 'room', 'at'], what);
    const out = { id: id(b.id, what), room: b.room, at: point(b.at, what) };
    if (!insideRect(room(b.room, what).rect, out.at)) fail(`${what} must be inside its room`);
    if (bedIds.has(out.id)) fail(`${what}: the id is used twice`);
    bedIds.set(out.id, k);
    return out;
  });
  const used = new Set();
  const patients = list(w.patients, LIMITS.beds, 'patients').map((p, k) => {
    const what = `patient ${k + 1}`;
    obj(p, ['name', 'needs', 'bed'], what);
    if (!(p.needs in NEEDS)) fail(`${what}: unknown needs`);
    if (!bedIds.has(p.bed) || used.has(p.bed)) fail(`${what} needs a bed of their own`);
    used.add(p.bed);
    return { name: text(p.name, `${what} name`), needs: p.needs, bed: p.bed };
  });
  const srcIds = new Map();
  const sources = list(w.sources, LIMITS.sources, 'sources', 1).map((s, k) => {
    const what = `sound ${k + 1}`;
    obj(s, ['id', 'name', 'kind', 'room', 'bed', 'at', 'level', 'perNight'], what);
    if (!(s.kind in KINDS)) fail(`${what}: unknown kind`);
    const out = { id: id(s.id, what), name: text(s.name, `${what} name`), kind: s.kind, level: num(s.level, 30, 110, `${what} level`), perNight: num(s.perNight, 0, 200, `${what} events a night`) };
    if (s.bed !== undefined) {
      if (!bedIds.has(s.bed) || s.room !== undefined || s.at !== undefined) fail(`${what}: give either a bed or a room and a place`);
      const b = beds[bedIds.get(s.bed)];
      out.bed = s.bed;
      out.room = b.room;
      out.at = [b.at[0], b.at[1]];
    } else {
      out.room = room(s.room, what).id;
      out.at = point(s.at, what);
      if (!insideRect(room(s.room, what).rect, out.at)) fail(`${what} must be inside its room`);
    }
    if (srcIds.has(out.id)) fail(`${what}: the id is used twice`);
    srcIds.set(out.id, k);
    return out;
  });
  let nEffects = 0;
  const groups = new Map();
  const options = list(w.options ?? [], LIMITS.options, 'options').map((o, k) => {
    const what = `change ${k + 1}`;
    obj(o, ['id', 'name', 'cost', 'group', 'effects'], what);
    const effects = list(o.effects, 16, `${what} effects`, 1).map((e) => {
      obj(e, ['ceiling', 'close', 'quieter', 'quieterKind', 'by', 'move', 'to'], `${what} effect`);
      if (e.ceiling !== undefined) return { kind: 'ceiling', room: room(e.ceiling, what).id };
      if (e.close !== undefined) {
        const r = room(e.close, what);
        if (r.kind === 'corridor') fail(`${what}: the corridor has no door`);
        return { kind: 'close', room: r.id };
      }
      if (e.quieter !== undefined || e.quieterKind !== undefined) {
        const by = num(e.by, 1, 40, `${what} quieter by`);
        if (e.quieter !== undefined) {
          if (!srcIds.has(e.quieter)) fail(`${what}: unknown sound`);
          return { kind: 'quieter', sources: [e.quieter], by };
        }
        if (!(e.quieterKind in KINDS)) fail(`${what}: unknown kind`);
        return { kind: 'quieter', sources: sources.filter((s) => s.kind === e.quieterKind).map((s) => s.id), by };
      }
      if (e.move !== undefined) {
        if (!srcIds.has(e.move)) fail(`${what}: unknown sound`);
        const s = sources[srcIds.get(e.move)];
        if (s.bed) fail(`${what}: a bedside sound moves with its bed`);
        const to = point(e.to, `${what} to`);
        if (!insideRect(room(s.room, what).rect, to)) fail(`${what}: a sound can only move within its room`);
        return { kind: 'move', source: e.move, to };
      }
      return fail(`${what}: an effect needs ceiling, close, quieter, quieterKind or move`);
    });
    for (const e of effects) nEffects += e.kind === 'quieter' ? e.sources.length : 1;
    const out = { id: id(o.id, what), name: text(o.name, `${what} name`), cost: num(o.cost, 0, 1e6, `${what} cost`), effects };
    if (o.group !== undefined) {
      out.group = id(o.group, `${what} group`);
      if (!groups.has(out.group)) groups.set(out.group, groups.size);
    }
    return out;
  });
  if (nEffects > LIMITS.effects) fail(`At most ${LIMITS.effects} effects in all`);
  return { name, summary, rooms, beds, patients, sources, options };
}

/** The numbers the core reads, plus look-up tables. `enabled` is the set of option ids allowed
 *  (all by default); patients are listed in bed order of the plan so patient k starts in bed k.
 *  A bed move is only made if it saves at least `movePenalty` weighted arousals a night. */
export function compile(ward, enabled = null, movePenalty = 2) {
  const rIndex = new Map(ward.rooms.map((r, k) => [r.id, k]));
  const bIndex = new Map(ward.beds.map((b, k) => [b.id, k]));
  const sIndex = new Map(ward.sources.map((s, k) => [s.id, k]));
  // Beds are reordered so that occupied beds come first, in patient order.
  const order = [...ward.patients.map((p) => bIndex.get(p.bed))];
  for (let k = 0; k < ward.beds.length; k++) if (!order.includes(k)) order.push(k);
  const beds = order.map((k) => ward.beds[k]);
  const options = ward.options.filter((o) => !enabled || enabled.has(o.id));
  const groupIds = new Map();
  const n = [1, ward.rooms.length];
  for (const r of ward.rooms) {
    const [x0, y0, x1, y1] = r.rect;
    const door = r.door ?? [(x0 + x1) / 2, (y0 + y1) / 2];
    n.push(x0, y0, x1, y1, r.height, FLOOR_ALPHA[r.kind], WALL_ALPHA[r.kind], CEILINGS[r.ceiling].alpha, door[0], door[1],
      (r.doorWidth ?? 1) * DOOR_HEIGHT, OPEN_LOSS, CLOSED_LOSS, r.kind === 'corridor' ? 1 : 0);
  }
  n.push(beds.length);
  for (const b of beds) n.push(rIndex.get(b.room), b.at[0], b.at[1], 0.9);
  n.push(ward.patients.length);
  for (const p of ward.patients) n.push(NEEDS[p.needs].weight, NEEDS[p.needs].shift);
  n.push(ward.sources.length);
  for (const s of ward.sources) {
    const k = KINDS[s.kind];
    n.push(rIndex.get(s.room), s.at[0], s.at[1], s.bed ? 1.0 : 1.2, s.level, s.perNight, k.l50, k.slope);
  }
  n.push(options.length);
  for (const o of options) {
    let g = -1;
    if (o.group !== undefined) {
      if (!groupIds.has(o.group)) groupIds.set(o.group, groupIds.size);
      g = groupIds.get(o.group);
    }
    n.push(o.cost, g);
  }
  const effects = [];
  options.forEach((o, k) => {
    for (const e of o.effects) {
      if (e.kind === 'ceiling') effects.push([k, 0, rIndex.get(e.room), CEILINGS.acoustic.alpha, 0, 0]);
      else if (e.kind === 'close') effects.push([k, 1, rIndex.get(e.room), 0, 0, 0]);
      else if (e.kind === 'quieter') for (const sid of e.sources) effects.push([k, 2, sIndex.get(sid), e.by, 0, 0]);
      else effects.push([k, 3, sIndex.get(e.source), 0, e.to[0], e.to[1]]);
    }
  });
  n.push(effects.length);
  for (const e of effects) n.push(...e);
  n.push(movePenalty);
  return { numbers: n, beds, options };
}

/** Reads the core's evaluate() output. */
export function decodeEvaluate(out, ward, compiled) {
  let p = 0;
  const asIs = out[p++];
  const best = out[p++];
  const patients = ward.patients.map((pt) => {
    const now = out[p++];
    const bed = compiled.beds[out[p++]];
    const there = out[p++];
    return { ...pt, now, bestBed: bed.id, there, weight: NEEDS[pt.needs].weight };
  });
  const levels = ward.sources.map(() => compiled.beds.map(() => out[p++]));
  const rt = ward.rooms.map(() => out[p++]);
  return { asIs, best, patients, levels, rt };
}

export function decodeOptimise(out, compiled) {
  const pick = (mask) => compiled.options.filter((_, k) => Math.floor(mask / 2 ** k) % 2 === 1);
  const best = { mask: out[0], cost: out[1], total: out[2], options: pick(out[0]) };
  const frontier = [];
  for (let p = 3; p + 2 < out.length; p += 3) frontier.push({ mask: out[p], cost: out[p + 1], total: out[p + 2], options: pick(out[p]) });
  return { best, frontier };
}

export { WardError };

/** The same room model as the core, in JavaScript, for the explainer and to cross-check the
 *  core in tests. Room: { lx, ly, lz, af, aw, ac } (metres, absorption); points relative to the
 *  room's corner. Returns the level and its parts (direct, early reflections, reverberant). */
export function roomModel(room, src, rcv, lw) {
  const { lx, ly, lz, af, aw, ac } = room;
  let direct = 0;
  let early = 0;
  const images = [];
  for (let kx = -1; kx <= 1; kx++) for (let ix = 0; ix <= 1; ix++) {
    const nx = Math.abs(kx - ix) + Math.abs(kx);
    if (nx > 2) continue;
    const imx = (1 - 2 * ix) * src[0] + 2 * kx * lx;
    for (let ky = -1; ky <= 1; ky++) for (let iy = 0; iy <= 1; iy++) {
      const ny = Math.abs(ky - iy) + Math.abs(ky);
      if (nx + ny > 2) continue;
      const imy = (1 - 2 * iy) * src[1] + 2 * ky * ly;
      for (let kz = -1; kz <= 1; kz++) for (let iz = 0; iz <= 1; iz++) {
        const lowZ = Math.abs(kz - iz);
        const highZ = Math.abs(kz);
        const order = nx + ny + lowZ + highZ;
        if (order > 2) continue;
        const imz = (1 - 2 * iz) * src[2] + 2 * kz * lz;
        const f = (1 - aw) ** (nx + ny) * (1 - af) ** lowZ * (1 - ac) ** highZ;
        const d2 = Math.max((imx - rcv[0]) ** 2 + (imy - rcv[1]) ** 2 + (imz - rcv[2]) ** 2, 0.09);
        const e = f / (4 * Math.PI * d2);
        if (order === 0) direct += e;
        else early += e;
        images.push({ x: imx, y: imy, z: imz, order, walls: nx + ny, e });
      }
    }
  }
  const floor = lx * ly;
  const wallA = 2 * (lx + ly) * lz;
  const S = 2 * floor + wallA;
  const A = floor * af + floor * ac + wallA * aw;
  const mean = A / S;
  const reverb = (4 / (A / (1 - mean))) * (1 - mean) ** 3;
  const db = (e) => lw + 10 * Math.log10(e);
  return { level: db(direct + early + reverb), direct: db(direct), early: db(early), reverb: db(reverb), rt60: (0.161 * lx * ly * lz) / A, images };
}

/** Chance that one event of this kind at level l (dB) wakes a sleeper with this threshold shift. */
export function wakeChance(kind, l, shift = 0) {
  const k = KINDS[kind];
  return 1 / (1 + Math.exp(-(l - (k.l50 - shift)) / k.slope));
}
