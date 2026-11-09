// Hushward core (AssemblyScript): how loud each night-time sound is at each bed, how likely it
// is to wake the patient there, the bed assignment that wakes people least, and the best set
// of changes within a budget. Everything lives in fixed buffers: no allocation, no imports.

// ---------------------------------------------------------------- limits and buffers
const MAX_ROOMS = 24;
const MAX_BEDS = 24;
const MAX_SOURCES = 48;
const MAX_OPTIONS = 14;
const MAX_EFFECTS = 64;
const IN_CAP = 4096;
const OUT_CAP = 65536;

const IN = new StaticArray<f64>(IN_CAP);
const OUT = new StaticArray<f64>(OUT_CAP);
let outLen: i32 = 0;

// rooms: x0 y0 x1 y1 height aFloor aWalls aCeiling doorX doorY doorArea openLoss closedLoss corridor
const R_FIELDS = 14;
const rooms = new StaticArray<f64>(MAX_ROOMS * R_FIELDS);
let nRooms: i32 = 0;
let corridor: i32 = -1;
// beds: room x y z
const bedRoom = new StaticArray<i32>(MAX_BEDS);
const bedX = new StaticArray<f64>(MAX_BEDS);
const bedY = new StaticArray<f64>(MAX_BEDS);
const bedZ = new StaticArray<f64>(MAX_BEDS);
let nBeds: i32 = 0;
// patients: weight, sensitivity shift (dB lower threshold)
const patW = new StaticArray<f64>(MAX_BEDS);
const patShift = new StaticArray<f64>(MAX_BEDS);
let nPatients: i32 = 0;
// sources: room x y z lw perNight l50 slope bed
const srcRoom = new StaticArray<i32>(MAX_SOURCES);
const srcX = new StaticArray<f64>(MAX_SOURCES);
const srcY = new StaticArray<f64>(MAX_SOURCES);
const srcZ = new StaticArray<f64>(MAX_SOURCES);
const srcLw = new StaticArray<f64>(MAX_SOURCES);
const srcRate = new StaticArray<f64>(MAX_SOURCES);
const srcL50 = new StaticArray<f64>(MAX_SOURCES);
const srcSlope = new StaticArray<f64>(MAX_SOURCES);
let nSources: i32 = 0;
// options and their effects: option kind target value x y
const optCost = new StaticArray<f64>(MAX_OPTIONS);
const optGroup = new StaticArray<i32>(MAX_OPTIONS);
let nOptions: i32 = 0;
const effOpt = new StaticArray<i32>(MAX_EFFECTS);
const effKind = new StaticArray<i32>(MAX_EFFECTS);
const effTarget = new StaticArray<i32>(MAX_EFFECTS);
const effValue = new StaticArray<f64>(MAX_EFFECTS);
const effX = new StaticArray<f64>(MAX_EFFECTS);
const effY = new StaticArray<f64>(MAX_EFFECTS);
let nEffects: i32 = 0;
// Weighted arousals a bed move must save to be worth the disruption of moving a patient.
let movePenalty: f64 = 0;

// The world with a set of options applied.
const curRooms = new StaticArray<f64>(MAX_ROOMS * R_FIELDS);
const doorClosed = new StaticArray<bool>(MAX_ROOMS);
const curX = new StaticArray<f64>(MAX_SOURCES);
const curY = new StaticArray<f64>(MAX_SOURCES);
const curLw = new StaticArray<f64>(MAX_SOURCES);

// Working space.
const level = new StaticArray<f64>(MAX_SOURCES * MAX_BEDS);
const cost = new StaticArray<f64>((MAX_BEDS + 1) * (MAX_BEDS + 1));
const assign = new StaticArray<i32>(MAX_BEDS); // patient -> bed
const hu = new StaticArray<f64>(MAX_BEDS + 1);
const hv = new StaticArray<f64>(MAX_BEDS + 1);
const hp = new StaticArray<i32>(MAX_BEDS + 1);
const hway = new StaticArray<i32>(MAX_BEDS + 1);
const hminv = new StaticArray<f64>(MAX_BEDS + 1);
const hused = new StaticArray<bool>(MAX_BEDS + 1);
// Every combination tried by optimise(): its mask, cost and total, and a sort order.
const fm = new StaticArray<i32>(1 << MAX_OPTIONS);
const fc = new StaticArray<f64>(1 << MAX_OPTIONS);
const ft = new StaticArray<f64>(1 << MAX_OPTIONS);
const order = new StaticArray<i32>(1 << MAX_OPTIONS);

export function abort(msg: usize, file: usize, line: u32, col: u32): void {
  unreachable();
}

export function inputPtr(): usize {
  return changetype<usize>(IN);
}
export function outPtr(): usize {
  return changetype<usize>(OUT);
}
export function outLength(): i32 {
  return outLen;
}

function out(v: f64): void {
  if (outLen < OUT_CAP) {
    unchecked((OUT[outLen] = v));
    outLen++;
  }
}

// ---------------------------------------------------------------- reading the input
let pos: i32 = 0;
let n: i32 = 0;
let bad: bool = false;

function num(lo: f64, hi: f64): f64 {
  if (pos >= n) {
    bad = true;
    return lo;
  }
  const v = IN[pos++];
  if (!isFinite(v) || v < lo || v > hi) {
    bad = true;
    return lo;
  }
  return v;
}
function int(lo: i32, hi: i32): i32 {
  const v = num(<f64>lo, <f64>hi);
  if (v != Math.floor(v)) bad = true;
  return <i32>v;
}

/** Reads `count` numbers from the input buffer. 0 if they describe a valid ward, else 1. */
export function load(count: i32): i32 {
  n = count;
  pos = 0;
  bad = false;
  if (count < 1 || count > IN_CAP) return 1;
  if (int(1, 1) != 1) return 1;
  nRooms = int(1, MAX_ROOMS);
  corridor = -1;
  for (let r = 0; r < nRooms && !bad; r++) {
    const o = r * R_FIELDS;
    const x0 = num(0, 200), y0 = num(0, 200), x1 = num(0, 200), y1 = num(0, 200);
    if (x1 - x0 < 1 || y1 - y0 < 1) bad = true;
    rooms[o] = x0; rooms[o + 1] = y0; rooms[o + 2] = x1; rooms[o + 3] = y1;
    rooms[o + 4] = num(2, 6); // height
    rooms[o + 5] = num(0.01, 0.99);
    rooms[o + 6] = num(0.01, 0.99);
    rooms[o + 7] = num(0.01, 0.99);
    rooms[o + 8] = num(0, 200); // door x, y
    rooms[o + 9] = num(0, 200);
    rooms[o + 10] = num(0.5, 6); // door area m2
    rooms[o + 11] = num(0, 60); // loss through the open door, dB
    rooms[o + 12] = num(0, 60); // through the closed door
    const c = int(0, 1);
    rooms[o + 13] = <f64>c;
    if (c == 1) {
      if (corridor >= 0) bad = true;
      corridor = r;
    }
  }
  if (corridor < 0) bad = true;
  nBeds = int(1, MAX_BEDS);
  for (let b = 0; b < nBeds && !bad; b++) {
    const r = int(0, nRooms - 1);
    bedRoom[b] = r;
    bedX[b] = num(0, 200); bedY[b] = num(0, 200); bedZ[b] = num(0.2, 2);
    if (!inside(r, bedX[b], bedY[b])) bad = true;
  }
  nPatients = int(0, nBeds);
  for (let p = 0; p < nPatients && !bad; p++) {
    patW[p] = num(0, 10);
    patShift[p] = num(-20, 20);
  }
  nSources = int(1, MAX_SOURCES);
  for (let s = 0; s < nSources && !bad; s++) {
    const r = int(0, nRooms - 1);
    srcRoom[s] = r;
    srcX[s] = num(0, 200); srcY[s] = num(0, 200); srcZ[s] = num(0, 3);
    srcLw[s] = num(20, 120);
    srcRate[s] = num(0, 500);
    srcL50[s] = num(20, 100);
    srcSlope[s] = num(1, 20);
    if (!inside(r, srcX[s], srcY[s])) bad = true;
  }
  nOptions = int(0, MAX_OPTIONS);
  for (let k = 0; k < nOptions && !bad; k++) {
    optCost[k] = num(0, 1e7);
    optGroup[k] = int(-1, MAX_OPTIONS);
  }
  nEffects = int(0, MAX_EFFECTS);
  for (let e = 0; e < nEffects && !bad; e++) {
    effOpt[e] = int(0, max(0, nOptions - 1));
    const kind = int(0, 3);
    effKind[e] = kind;
    // kinds: 0 ceiling absorption of room, 1 close the door of room, 2 source quieter by value dB,
    // 3 move source to (x, y)
    effTarget[e] = int(0, kind < 2 ? nRooms - 1 : nSources - 1);
    effValue[e] = num(0, 60);
    effX[e] = num(0, 200);
    effY[e] = num(0, 200);
    if (kind == 0 && (effValue[e] < 0.01 || effValue[e] > 0.99)) bad = true;
    if (kind == 3 && !inside(srcRoom[effTarget[e]], effX[e], effY[e])) bad = true;
    if (nOptions == 0) bad = true;
  }
  movePenalty = num(0, 100);
  if (pos != n) bad = true;
  return bad ? 1 : 0;
}

function inside(r: i32, x: f64, y: f64): bool {
  const o = r * R_FIELDS;
  return x >= rooms[o] && x <= rooms[o + 2] && y >= rooms[o + 1] && y <= rooms[o + 3];
}

// ---------------------------------------------------------------- options
function apply(mask: i32): void {
  for (let i = 0; i < nRooms * R_FIELDS; i++) curRooms[i] = rooms[i];
  for (let r = 0; r < nRooms; r++) doorClosed[r] = false;
  for (let s = 0; s < nSources; s++) {
    curX[s] = srcX[s];
    curY[s] = srcY[s];
    curLw[s] = srcLw[s];
  }
  for (let e = 0; e < nEffects; e++) {
    if (((mask >> effOpt[e]) & 1) == 0) continue;
    const t = effTarget[e];
    const k = effKind[e];
    if (k == 0) curRooms[t * R_FIELDS + 7] = effValue[e];
    else if (k == 1) doorClosed[t] = true;
    else if (k == 2) curLw[t] -= effValue[e];
    else {
      curX[t] = effX[e];
      curY[t] = effY[e];
    }
  }
}

// ---------------------------------------------------------------- acoustics
const PI4 = 4 * Math.PI;

/** Sound pressure level (dB) at (rx, ry, rz) from a source of power lw at (sx, sy, sz), both in
 *  room r: image sources up to second order, then the diffuse reverberant field for the energy
 *  that has been reflected three or more times. */
export function roomLevel(r: i32, sx: f64, sy: f64, sz: f64, rx: f64, ry: f64, rz: f64, lw: f64): f64 {
  const o = r * R_FIELDS;
  const x0 = curRooms[o], y0 = curRooms[o + 1];
  const lx = curRooms[o + 2] - x0, ly = curRooms[o + 3] - y0, lz = curRooms[o + 4];
  const af = curRooms[o + 5], aw = curRooms[o + 6], ac = curRooms[o + 7];
  const px = sx - x0, py = sy - y0, qx = rx - x0, qy = ry - y0;
  let e: f64 = 0;
  for (let kx = -1; kx <= 1; kx++)
    for (let ix = 0; ix <= 1; ix++) {
      const nx = abs(kx - ix) + abs(kx);
      if (nx > 2) continue;
      const imx = (1 - 2 * ix) * px + 2 * kx * lx;
      for (let ky = -1; ky <= 1; ky++)
        for (let iy = 0; iy <= 1; iy++) {
          const ny = abs(ky - iy) + abs(ky);
          if (nx + ny > 2) continue;
          const imy = (1 - 2 * iy) * py + 2 * ky * ly;
          for (let kz = -1; kz <= 1; kz++)
            for (let iz = 0; iz <= 1; iz++) {
              const lowZ = abs(kz - iz);
              const highZ = abs(kz);
              if (nx + ny + lowZ + highZ > 2) continue;
              const imz = (1 - 2 * iz) * sz + 2 * kz * lz;
              let f = Math.pow(1 - aw, <f64>(nx + ny)) * Math.pow(1 - af, <f64>lowZ) * Math.pow(1 - ac, <f64>highZ);
              const dx = imx - qx, dy = imy - qy, dz = imz - rz;
              const d2 = max(dx * dx + dy * dy + dz * dz, 0.09); // closer than 0.3 m: near field
              e += f / (PI4 * d2);
            }
        }
    }
  const floor = lx * ly;
  const wallA = 2 * (lx + ly) * lz;
  const S = 2 * floor + wallA;
  const A = floor * af + floor * ac + wallA * aw;
  const mean = A / S;
  const R = A / (1 - mean);
  e += (4 / R) * Math.pow(1 - mean, 3);
  return lw + 10 * Math.log10(e);
}

/** Reverberation time (Sabine) of room r with the current options, seconds. */
export function rt60(r: i32): f64 {
  const o = r * R_FIELDS;
  const lx = curRooms[o + 2] - curRooms[o], ly = curRooms[o + 3] - curRooms[o + 1], lz = curRooms[o + 4];
  const floor = lx * ly;
  const A = floor * curRooms[o + 5] + floor * curRooms[o + 7] + 2 * (lx + ly) * lz * curRooms[o + 6];
  return (0.161 * lx * ly * lz) / A;
}

function doorLoss(r: i32): f64 {
  return curRooms[r * R_FIELDS + (doorClosed[r] ? 12 : 11)];
}

/** Power passed on through room r's doorway, from the level just inside it (diffuse field:
 *  intensity is p^2 / (4 rho c), so Lw = Lp - 6 + 10 log10(area)), less the door's loss. */
function throughDoor(r: i32, lp: f64): f64 {
  return lp - 6 + 10 * Math.log10(curRooms[r * R_FIELDS + 10]) - doorLoss(r);
}

function doorX(r: i32): f64 {
  return curRooms[r * R_FIELDS + 8];
}
function doorY(r: i32): f64 {
  return curRooms[r * R_FIELDS + 9];
}

/** Level at a point (room rr, x, y, z) from source s, through doorways and the corridor. */
function levelAt(s: i32, rr: i32, x: f64, y: f64, z: f64): f64 {
  const rs = srcRoom[s];
  const sx = curX[s], sy = curY[s], sz = srcZ[s], lw = curLw[s];
  if (rs == rr) return roomLevel(rr, sx, sy, sz, x, y, z, lw);
  // Into the corridor.
  let cx: f64, cy: f64, cw: f64;
  if (rs == corridor) {
    cx = sx; cy = sy; cw = lw;
  } else {
    cw = throughDoor(rs, roomLevel(rs, sx, sy, sz, doorX(rs), doorY(rs), 1.2, lw));
    cx = doorX(rs); cy = doorY(rs);
  }
  if (rr == corridor) return roomLevel(corridor, cx, cy, 1.2, x, y, z, cw);
  // Along the corridor to the room's door, then in.
  const atDoor = roomLevel(corridor, cx, cy, 1.2, doorX(rr), doorY(rr), 1.2, cw);
  const w2 = throughDoor(rr, atDoor);
  return roomLevel(rr, doorX(rr), doorY(rr), 1.2, x, y, z, w2);
}

/** Chance that one event at level l (dB) wakes a patient whose threshold is lowered by shift. */
function wakeChance(s: i32, l: f64, shift: f64): f64 {
  return 1 / (1 + Math.exp(-(l - (srcL50[s] - shift)) / srcSlope[s]));
}

function fillLevels(): void {
  for (let s = 0; s < nSources; s++)
    for (let b = 0; b < nBeds; b++)
      level[s * MAX_BEDS + b] = levelAt(s, bedRoom[b], bedX[b], bedY[b], bedZ[b]);
}

/** Expected awakenings a night for patient p in bed b (unweighted). */
function wakes(p: i32, b: i32): f64 {
  let t: f64 = 0;
  for (let s = 0; s < nSources; s++) t += srcRate[s] * wakeChance(s, level[s * MAX_BEDS + b], patShift[p]);
  return t;
}

// ---------------------------------------------------------------- assignment (Hungarian)
/** Minimum-cost assignment of patients to beds (each move costs movePenalty); returns the total
 *  weighted awakenings of that assignment. */
function hungarian(): f64 {
  const m = nBeds; // rows: patients padded to nBeds with empty beds' "patients" of weight 0
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= m; j++) {
      const p = i - 1;
      cost[i * (MAX_BEDS + 1) + j] = p < nPatients ? patW[p] * wakes(p, j - 1) + (j - 1 != p ? movePenalty : 0) : 0;
    }
  for (let j = 0; j <= m; j++) {
    hu[j] = 0; hv[j] = 0; hp[j] = 0; hway[j] = 0;
  }
  for (let i = 1; i <= m; i++) {
    hp[0] = i;
    let j0 = 0;
    for (let j = 0; j <= m; j++) {
      hminv[j] = Infinity;
      hused[j] = false;
    }
    do {
      hused[j0] = true;
      const i0 = hp[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (hused[j]) continue;
        const cur = cost[i0 * (MAX_BEDS + 1) + j] - hu[i0] - hv[j];
        if (cur < hminv[j]) {
          hminv[j] = cur;
          hway[j] = j0;
        }
        if (hminv[j] < delta) {
          delta = hminv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (hused[j]) {
          hu[hp[j]] += delta;
          hv[j] -= delta;
        } else hminv[j] -= delta;
      }
      j0 = j1;
    } while (hp[j0] != 0);
    do {
      const j1 = hway[j0];
      hp[j0] = hp[j1];
      j0 = j1;
    } while (j0 != 0);
  }
  let total: f64 = 0;
  for (let j = 1; j <= m; j++) {
    const p = hp[j] - 1;
    if (p < nPatients) {
      assign[p] = j - 1;
      total += patW[p] * wakes(p, j - 1); // the penalty steers the choice but isn't an arousal
    }
  }
  return total;
}

function asIs(): f64 {
  let t: f64 = 0;
  for (let p = 0; p < nPatients; p++) t += patW[p] * wakes(p, p);
  return t;
}

function maskCost(mask: i32): f64 {
  let c: f64 = 0;
  for (let k = 0; k < nOptions; k++) if ((mask >> k) & 1) c += optCost[k];
  return c;
}

function maskValid(mask: i32): bool {
  for (let a = 0; a < nOptions; a++) {
    if (((mask >> a) & 1) == 0 || optGroup[a] < 0) continue;
    for (let b = a + 1; b < nOptions; b++) if ((mask >> b) & 1 && optGroup[b] == optGroup[a]) return false;
  }
  return true;
}

// ---------------------------------------------------------------- exported analyses
/** With options `mask`: out = [as-is total, best total, then per patient: bed now's wakes,
 *  best bed, wakes there], then per bed the level of every source. */
export function evaluate(mask: i32): i32 {
  outLen = 0;
  if (mask < 0 || mask >= 1 << nOptions || !maskValid(mask)) return 1;
  apply(mask);
  fillLevels();
  const now = asIs();
  const best = hungarian();
  out(now);
  out(best);
  for (let p = 0; p < nPatients; p++) {
    out(<f64>p < <f64>nBeds ? wakes(p, p) : 0);
    out(<f64>assign[p]);
    out(wakes(p, assign[p]));
  }
  for (let s = 0; s < nSources; s++) for (let b = 0; b < nBeds; b++) out(level[s * MAX_BEDS + b]);
  for (let r = 0; r < nRooms; r++) out(rt60(r));
  return 0;
}

/** Every allowed combination of options within the budget, with patients reassigned for each.
 *  out = [best mask, its cost, its total, then the cheapest-for-its-result frontier as
 *  (mask, cost, total) triples, cheapest first]. */
export function optimise(budget: f64, reassign: i32): i32 {
  outLen = 0;
  const limit = 1 << nOptions;
  let bestMask = 0;
  let bestTotal = Infinity;
  let bestCost: f64 = 0;
  let nf = 0;
  for (let mask = 0; mask < limit; mask++) {
    if (!maskValid(mask)) continue;
    const c = maskCost(mask);
    apply(mask);
    fillLevels();
    const t = reassign ? hungarian() : asIs();
    fm[nf] = mask; fc[nf] = c; ft[nf] = t; nf++;
    if (c <= budget + 1e-9 && (t < bestTotal - 1e-12 || (Math.abs(t - bestTotal) <= 1e-12 && c < bestCost))) {
      bestTotal = t;
      bestMask = mask;
      bestCost = c;
    }
  }
  out(<f64>bestMask);
  out(bestCost);
  out(bestTotal);
  // Pareto frontier: sort by cost (insertion into a list of indices), keep strictly better totals.
  for (let i = 0; i < nf; i++) order[i] = i;
  // simple shell sort by (cost, total)
  let gap = nf >> 1;
  while (gap > 0) {
    for (let i = gap; i < nf; i++) {
      const t = order[i];
      let j = i;
      while (j >= gap && (fc[order[j - gap]] > fc[t] || (fc[order[j - gap]] == fc[t] && ft[order[j - gap]] > ft[t]))) {
        order[j] = order[j - gap];
        j -= gap;
      }
      order[j] = t;
    }
    gap >>= 1;
  }
  let bestSoFar = Infinity;
  for (let i = 0; i < nf; i++) {
    const k = order[i];
    if (ft[k] < bestSoFar - 1e-9) {
      bestSoFar = ft[k];
      out(<f64>fm[k]);
      out(fc[k]);
      out(ft[k]);
    }
  }
  return 0;
}

/** A floor map at head height with options `mask`, cells `cell` metres: for each cell inside a
 *  room, the expected awakenings a night for a patient (with sensitivity shift) whose head was
 *  there, or NaN outside rooms. out = [nx, ny, x0, y0, cell, values row by row]. */
export function heat(mask: i32, cell: f64, shift: f64): i32 {
  outLen = 0;
  if (mask < 0 || mask >= 1 << nOptions || !maskValid(mask)) return 1;
  if (!(cell >= 0.1 && cell <= 2)) return 1;
  apply(mask);
  let x0: f64 = Infinity, y0: f64 = Infinity, x1: f64 = -Infinity, y1: f64 = -Infinity;
  for (let r = 0; r < nRooms; r++) {
    const o = r * R_FIELDS;
    x0 = min(x0, rooms[o]); y0 = min(y0, rooms[o + 1]);
    x1 = max(x1, rooms[o + 2]); y1 = max(y1, rooms[o + 3]);
  }
  const nx = <i32>Math.ceil((x1 - x0) / cell);
  const ny = <i32>Math.ceil((y1 - y0) / cell);
  if (<f64>nx * <f64>ny + 5 > <f64>OUT_CAP) return 1;
  out(<f64>nx); out(<f64>ny); out(x0); out(y0); out(cell);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + (<f64>i + 0.5) * cell, y = y0 + (<f64>j + 0.5) * cell;
      let room = -1;
      for (let r = 0; r < nRooms; r++) if (inside(r, x, y)) { room = r; if (r != corridor) break; }
      if (room < 0) { out(NaN); continue; }
      let t: f64 = 0;
      for (let s = 0; s < nSources; s++) t += srcRate[s] * wakeChance(s, levelAt(s, room, x, y, 0.9), shift);
      out(t);
    }
  return 0;
}
