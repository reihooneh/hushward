# How Hushward works

## 1. Architecture

```
wards/*.json ──checkWard──▶ ward ──compile(allowed changes, move penalty)──▶ numbers
                                                                                │ (worker)
                                     ┌──────────────────────────────────────────▼─────────┐
                                     │ AssemblyScript core (WebAssembly, no imports)       │
                                     │  load: check every number into fixed buffers        │
                                     │  apply(mask): ceilings, closed doors, quieter, moved │
                                     │  levelAt: room image sources + reverb, doorways      │
                                     │  wakes: logistic chance × events, per patient & bed │
                                     │  hungarian: best bed for every patient              │
                                     │  optimise: every mask → best in budget + frontier   │
                                     │  heat: arousals for a sleeper at every floor cell   │
                                     └──────────────────────────────────────────┬─────────┘
                                   decodeEvaluate / decodeOptimise ◀── numbers ──┘
                                              │
                        planner.js ── scene3d.js (three.js) ── plan2d.js (canvas) ── frontier (SVG)
```

## 2. File tour

- **`assembly/index.ts`:**
  - `load` reads the input with range checks into `StaticArray` buffers;
  - `apply` turns a bit mask of options into the current world;
  - `roomLevel` is the image-source and reverberation model;
  - `throughDoor` and `levelAt` chain rooms through the corridor;
  - `wakeChance` and `wakes` turn levels into expected arousals;
  - `hungarian` is the O(n³) assignment with potentials;
  - `evaluate`, `optimise` and `heat` are the exported analyses.
- **`src/web/model.js`:**
  - `checkWard` validates a ward file;
  - `compile` writes the numbers, with patients first so patient k starts in bed k;
  - `roomModel` is a JavaScript twin of the room model, used by the explainer and to cross-check the core.
- **`src/web/planner.js`:** runs load → optimise → evaluate (today and with the plan) → heat maps, then draws the plan, frontier, table and views.

## 3. Key ideas

**Image sources.** In a rectangular room, a reflection off a wall looks exactly like sound from a mirror image of the source behind that wall. Mirroring again gives the second-order reflections. Each image is weakened by the absorption of every surface it reflected from, and its energy falls with the square of its distance. Hushward takes every image up to two reflections (25 paths in all, counting the direct one). In each axis, the image coordinate is ±x + 2k·L, and the reflection counts are |k − i| and |k|, so the loops enumerate exactly the right set.

**The diffuse tail.** After a few reflections, sound fills the room evenly. Sabine's theory gives that energy density as 4/R, where R = A/(1 − ᾱ) and A is the total absorption. Hushward keeps the part that has reflected three or more times, (1 − ᾱ)³ of it, so it doesn't count the early reflections twice. This is why acoustic tiles help most far from a sound: close up, the direct sound dominates whatever the ceiling.

**Doorways.** In a diffuse field, the intensity through an opening is p²/(4ρc). So the power leaving through a doorway of area S is Lp − 6 + 10·log₁₀ S dB. That power becomes a source at the doorway in the corridor, and again at the next room's doorway. A closed door adds a fixed loss (18 dB), so closing a door shifts every sound from another room by exactly that amount, which a test checks.

**From decibels to sleep.** The chance one event wakes someone is a logistic curve, 1 / (1 + e^(−(L − L₅₀)/s)). Alarms have a lower L₅₀ than voices (69 against 76 dB, spread 7 dB, so an alarm peaking at 55 dB wakes about one sleeper in eight, a voice about one in twenty), and vulnerable patients have the curve shifted down a few dB. Expected arousals add up over events, so a night's total is Σ events × chance. The weights per patient are a priority to set, not a measurement.

**Assignment.** Which patient goes in which bed is the classic assignment problem. The Hungarian algorithm keeps dual potentials u and v so that reduced costs stay non-negative. It grows an alternating tree one patient at a time, and finishes in O(n³). Empty beds are padded with zero-cost "patients". Each move from a patient's current bed costs a penalty (2 weighted arousals), so nobody is moved for a trivial gain.

**Why try every combination?** Effects interact. Tiles in a bay are worth less once its door is closed, and moving the handover matters less once the corridor is quiet. A greedy "best value first" list would mis-rank them. With at most 14 changes there are at most 16,384 combinations. Each needs one evaluation (at most 48 sounds × 24 beds × 75 image paths) and one assignment, so the exhaustive search takes a few seconds. Keeping every result also gives the Pareto frontier, the cheapest way to reach each level of quiet.

**AssemblyScript features used:**
- TypeScript syntax with WebAssembly types (`f64`, `i32`, `usize`);
- `StaticArray` for fixed buffers and `unchecked` writes where bounds are already checked;
- `changetype<usize>` to hand buffer addresses to JavaScript;
- `--runtime stub` (no garbage collector needed, since nothing is allocated while running);
- `--use abort=…` to replace the host `abort` import with a trap, so the module imports nothing.

## 4. Interview questions

**Q: How do you know the optimiser's answer is right?**
A: It's tested against brute force at two levels:
- **Assignment:** for every combination of changes in 40 random wards, the Hungarian result (including the move penalty) must equal trying every permutation of patients over beds.
- **Budget:** at four budgets, the best plan must equal the best of every combination evaluated one by one, and the frontier must be cheapest-first with strictly falling totals.

The physics has its own known answers: inverse square, Sabine's reverberation time, the exact door loss, and agreement with an independent JavaScript implementation.

**Q: Why not just add up each change's benefit and pick the best value for money?**
A: Because the benefits aren't additive. Absorption changes the reverberant field that a closed door already reduced, and bed moves react to whichever beds became quiet. Value-per-dollar greedy selection is a knapsack heuristic that assumes independence; it can pick a $7,000 ceiling that a $1,800 door closer would have made unnecessary. With a small number of options, the exact search is affordable, so there's no reason to approximate.

**Q: What are the weakest assumptions, and how would you validate them?**
A: The waking curve and the event counts. The acoustics is standard engineering approximation; the link from decibels to arousal varies a lot between people and sounds. To validate:
- measure LAmax at pillows with a sound level meter and log night-time events for a week;
- fit L₅₀ and the slope per sound type against patient-reported or actigraphy-detected awakenings;
- check that the model ranks beds and interventions in the same order as the measurements.

Ranking is what the planner needs; absolute counts matter less.

## 5. Extension ideas

- **Time of night:** events at 2 am wake more people than at 10 pm. Give each sound a timetable and weight by sleep stage probability.
- **Measured input:** import a sound-level-meter log and fit each source's power from readings at known points (least squares on the same model).
- **Larger searches:** beyond 14 options, use branch and bound with the frontier as a bound, or a mixed-integer formulation with linearised levels.
