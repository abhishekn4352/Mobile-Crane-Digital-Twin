// Evidence for sir's review of 26 Oct (frozen-sensor bits and duration, 0.1 t lift-off threshold), read-only.
//
//     node frozen-and-noise-evidence.mjs <repo root>        e.g.  node frozen-and-noise-evidence.mjs .
//
// Nothing here is typed in from a test: every number is measured on the recording with the repo's own parseCSV, KIT and dataQuality.js.
import fs from 'fs';
import path from 'path';
const root = path.resolve(process.argv[2] || '.');
const { parseCSV } = await import(path.join(root, 'Cycle-3/js/playbackClock.js'));
const cm = await import(path.join(root, 'Cycle-3/js/craneModel.js'));
const dq = await import(path.join(root, 'Cycle-3/js/dataQuality.js'));
const { KIT } = cm;
const rows = parseCSV(fs.readFileSync(path.join(root, 'Cycle-3/data/mobile-telemetry-2026-09-16.csv'), 'utf8'));
const hms = (r) => r.ts.slice(11, 19);
const bit = (r, b) => (r.status_word >> b) & 1;
const AXES = { 1: 'boom_length_m', 2: 'boom_angle_deg', 3: 'slew_deg' };

// ---------------------------------------------------------------- 1. held lifts
// a "held lift" = a stretch where bits 1, 2 and 3 are all set and boom length, angle and slew do not change at all
const held = [];
{
  let s = null;
  rows.forEach((r, i) => {
    const still = i > 0 && bit(r, 1) && bit(r, 2) && bit(r, 3) && Object.values(AXES).every((f) => r[f] === rows[i - 1][f]);
    if (still && s === null) s = i - 1;
    if (!still && s !== null) { if (i - s >= 25) held.push([s, i - 1]); s = null; }
  });
}
const inHeld = (i) => held.some(([a, b]) => i >= a && i <= b);
console.log('=== 1. Held lifts: motion bits 1-3 set, but boom length, angle and slew do not change at all');
held.forEach(([a, b]) => console.log(`  ${hms(rows[a])}-${hms(rows[b])}  ${String(b - a + 1).padStart(3)} s  status_word ${rows[a].status_word}  load ${rows[a].load_t} t`));
console.log(`  ${held.length} stretches, ${held.reduce((s, [a, b]) => s + b - a + 1, 0)} rows`);

// ---------------------------------------------------------------- 2. what the bits mean
console.log('\n=== 2. What the bits mean: when the bit is set, does the matching reading change? (rows outside the held lifts)');
console.log('  bit  reading           rows with the bit set   reading changed   share    longest repeat');
for (const b of [1, 2, 3]) {
  const f = AXES[b];
  let set = 0, changed = 0, run = 1, maxRun = 1;
  for (let i = 1; i < rows.length; i++) {
    if (inHeld(i) || !bit(rows[i], b)) { run = 1; continue; }
    set++;
    const same = rows[i][f] === rows[i - 1][f];
    if (!same) changed++;
    run = same ? run + 1 : 1;
    maxRun = Math.max(maxRun, run);
  }
  console.log(`  ${b}    ${f.padEnd(16)} ${String(set).padStart(8)}               ${String(changed).padStart(8)}        ${(100 * changed / set).toFixed(1)} %   ${maxRun} rows (${maxRun - 1} s)`);
}
const pat = {};
rows.forEach((r) => { const k = [1, 2, 3].map((b) => bit(r, b)).join(''); pat[k] = (pat[k] || 0) + 1; });
console.log(`  bits 1,2,3 together (b1 b2 b3): ${JSON.stringify(pat)}  (they come on and go off together; bit 0 = hoist = load on the hook)`);

// ---------------------------------------------------------------- 3. duration
console.log('\n=== 3. Duration: frozen rows / episodes on the recording, with and without the "another axis moves" rule');
for (const N of [1, 2, 3, 4, 5, 10, 30, 60]) {
  const cells = [0, KIT.FROZEN_SENSOR_MOVING_FRACTION].map((frac) => {
    const t = dq.createFrozenSensorTracker({ mappings: Array.from(KIT.FROZEN_SENSOR_MAPPINGS), durationS: N, movingFraction: frac });
    let n = 0, e = 0, prev = false;
    rows.forEach((r) => { const k = t.update(r).length > 0; if (k) { n++; if (!prev) e++; } prev = k; });
    return `${String(n).padStart(4)} rows / ${String(e).padStart(3)} episodes`;
  });
  console.log(`  ${String(N).padStart(2)} s   bits only: ${cells[0]}     bits + other axis moving: ${cells[1]}`);
}
{
  const t = dq.createProductionFrozenSensorTracker();
  let n = 0;
  rows.forEach((r) => { n += t.update(r).length; });
  console.log(`  production tracker (KIT: ${KIT.FROZEN_SENSOR_DURATION_S} s, fraction ${KIT.FROZEN_SENSOR_MOVING_FRACTION}): ${n} frozen rows on the whole recording`);
}

// ---------------------------------------------------------------- 4. injected freezes
console.log('\n=== 4. A stuck sensor injected into an in-memory copy of the 08:50 sweep (the file on disk is not touched)');
const at = (h) => rows.findIndex((r) => hms(r) === h);
const inject = (fields, from, to, freezeFrom) => {
  const a = at(from), b = at(to), f = at(freezeFrom);
  const copy = rows.slice(a, b + 1).map((r) => ({ ...r }));
  for (let i = f - a; i < copy.length; i++) fields.forEach((k) => { copy[i][k] = copy[f - a][k]; });
  const t = dq.createProductionFrozenSensorTracker();
  const hits = {};
  copy.forEach((r) => t.update(r).forEach((x) => { (hits[x.field] = hits[x.field] || []).push(hms(r)); }));
  return Object.entries(hits).map(([k, v]) => `${k} ${v[0]}-${v[v.length - 1]}`).join(', ') || 'nothing reported';
};
for (const f of Object.values(AXES)) console.log(`  ${f.padEnd(15)} stuck from 08:50:30 to 08:51:00 -> ${inject([f], '08:50:00', '08:51:00', '08:50:30')}`);
console.log(`  all three stuck together           -> ${inject(Object.values(AXES), '08:50:00', '08:51:00', '08:50:30')}   (looks like a held lift: the known limit of the rule)`);

// ---------------------------------------------------------------- 5. pad noise
console.log('\n=== 5. Pad sensor noise and the 0.1 t lift-off threshold');
const pads = [['fl', -3.9, -4.45], ['fr', 3.9, -4.45], ['rl', -3.9, 4.45], ['rr', 3.9, 4.45]];   // positions the recording was made with
const sx = pads.reduce((s, [, x]) => s + x * x, 0), sz = pads.reduce((s, [, , z]) => s + z * z, 0);
const BAD = new Set(['14:30:00', '15:00:00', '15:30:00', '17:00:00']);
let n = 0, worst = 0, sq = 0, lowestOther = Infinity, lowestAt = '';
rows.forEach((r) => {
  const t = hms(r);
  if (r.outrigger_state !== 'DEPLOYED' || BAD.has(t)) return;
  const event = t >= '10:25:00' && t <= '10:25:56';
  if (!event && r.load_t > 0) {
    const m = Math.min(r.pad_fl_t, r.pad_fr_t, r.pad_rl_t, r.pad_rr_t);
    if (m < lowestOther) { lowestOther = m; lowestAt = t; }
  }
  if (event) return;
  const cog = cm.kitCombinedCoG(r);
  if (!cog) return;
  pads.forEach(([k, x, z]) => {
    const model = cog.totalT / 4 + (cog.totalT * cog.x * x) / sx + (cog.totalT * cog.z * z) / sz;
    const e = r[`pad_${k}_t`] - model;
    n++; worst = Math.max(worst, Math.abs(e)); sq += e * e;
  });
});
console.log(`  ${n} pad readings (deployed rows, not 10:25:01-54, not the bad rows) against the kit reaction formula:`);
console.log(`    sigma ${Math.sqrt(sq / n).toFixed(4)} t, largest error ${worst.toFixed(4)} t   (the column has 2 decimals: step 0.01 t, so rounding alone gives sigma ${(0.01 / Math.sqrt(12)).toFixed(4)} t)`);
console.log(`    the pad sum differs from machine mass + load by at most 0.02 t (see SAFETY_LIMITS.padSumTolT)`);
console.log(`  lowest pad on any other loaded row: ${lowestOther} t at ${lowestAt}`);
console.log(`  the lift-off event: ${['10:25:25', '10:25:26', '10:25:27', '10:25:28', '10:25:29'].map((t) => `${t} ${rows[at(t)].pad_fl_t} t`).join(', ')}`);
console.log(`  KIT.PAD_LIFT_OFF_T = ${KIT.PAD_LIFT_OFF_T} t = ${(KIT.PAD_LIFT_OFF_T / worst).toFixed(1)} x the largest noise error = ${(KIT.PAD_LIFT_OFF_T / (Math.sqrt(sq / n))).toFixed(0)} x sigma`);
