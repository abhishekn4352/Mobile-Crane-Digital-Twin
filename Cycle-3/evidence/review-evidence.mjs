// Evidence for the Cycle 3 review fixes. Read-only: it only reads the repo.
//   node review-evidence.mjs <path-to-repo-root>
// Prints (1) frozen-sensor windows and the threshold plateau, (2) pad reactions near lift-off,
// (3) residuals that justify the shared tolerances, (4) detector alarm counts / new-rule checks.
import fs from 'fs';
import path from 'path';
const root = path.resolve(process.argv[2] || '.');
const js = (f) => import(path.join(root, 'Cycle-3/js', f));
const { parseCSV } = await js('playbackClock.js');
const det = await js('failureDetector.js');
const { KIT, SAFETY_LIMITS } = await js('craneModel.js');
const parsed = parseCSV(fs.readFileSync(path.join(root, 'Cycle-3/data/mobile-telemetry-2026-09-16.csv'), 'utf8'));
const rows = parsed.rows || parsed;
const hms = (r) => r.ts.slice(11, 19);
const IMPOSSIBLE = new Set(['14:30:00', '15:00:00', '15:30:00', '17:00:00']);
const rad = (d) => d * Math.PI / 180;
const motion = (r) => Number.isFinite(r.status_word) && (r.status_word & 0x0f) !== 0;
const H = (t) => console.log('\n=== ' + t + ' ===');

H('1. Frozen readings while a motion bit is set (bit1 telescope -> boom length, bit2 luff -> boom angle, bit3 slew -> slew)');
const CH = [[1, 'boom_length_m'], [2, 'boom_angle_deg'], [3, 'slew_deg']];
const stepOk = (a, b) => Date.parse(a.ts) - Date.parse(b.ts) === 1000;
for (const n of [2, 3, 5, 10, 20, 30, 31]) {
  let eps = 0, run = 0;
  for (let i = 1; i < rows.length; i++) {
    const hit = stepOk(rows[i], rows[i - 1]) && CH.some(([bit, k]) => (rows[i].status_word >> bit & 1) && rows[i][k] === rows[i - 1][k]);
    if (hit) { run++; if (run === n) eps++; } else run = 0;
  }
  console.log(`  threshold N = ${String(n).padStart(2)} s -> ${String(eps).padStart(2)} episodes${n === 2 ? '   (too low: ordinary 2 s luff pauses fire)' : n === 31 ? '   (too high: windows of 30 s are missed)' : ''}`);
}
const longestLegit = {};
for (const [bit, k] of CH) {
  let run = 0, best = 0;
  for (let i = 1; i < rows.length; i++) {
    const hit = stepOk(rows[i], rows[i - 1]) && (rows[i].status_word >> bit & 1) && rows[i][k] === rows[i - 1][k];
    if (hit) run++; else { if (run && run < 30) best = Math.max(best, run); run = 0; }
  }
  longestLegit[k] = best;
}
console.log('  longest ordinary stall (runs shorter than 30 s):', JSON.stringify(longestLegit));
const dq = await js('dataQuality.js');
if (typeof dq.createProductionFrozenSensorTracker === 'function' && Array.isArray(KIT.FROZEN_SENSOR_MAPPINGS)) {
  console.log(`  production tracker: mapping ${JSON.stringify(KIT.FROZEN_SENSOR_MAPPINGS.map((m) => [m.field, m.bit]))}, duration ${KIT.FROZEN_SENSOR_DURATION_S} s`);
  const tr = dq.createProductionFrozenSensorTracker();
  const eps = []; let cur = null; let prevT = null; const seen = new Set();
  const sec = (t) => +t.slice(0, 2) * 3600 + +t.slice(3, 5) * 60 + +t.slice(6);
  for (let i = 0; i < rows.length; i++) {
    const issues = tr.update(rows[i]);
    if (issues.length) {
      seen.add(hms(rows[i]));
      if (!cur || sec(hms(rows[i])) - sec(cur.e) !== 1) { if (cur) eps.push(cur); cur = { s: hms(rows[i]), n: 0, ch: new Set() }; }
      cur.n++; cur.e = hms(rows[i]); issues.forEach((x) => cur.ch.add(x.field));
    }
  }
  if (cur) eps.push(cur);
  console.log(`  tracker FROZEN_SENSOR episodes: ${eps.length}`); eps.forEach((e) => console.log(`    ${e.s} -> ${e.e} (${e.n} rows) ${[...e.ch].join(', ')}`));
  for (const [name, t] of [['dropout row 15:25:00', '15:25:00'], ['parked 12:40:00', '12:40:00'], ['repeated ts 15:59:49', '15:59:49'], ['hoist only 07:03:03', '07:03:03']]) {
    console.log(`    ${name.padEnd(22)} FROZEN_SENSOR raised: ${seen.has(t)}`);
  }
} else console.log('  (no production frozen-sensor tracker yet: nothing to run)');

H('2. Pad reactions on DEPLOYED rows (lowest pad of each row)');
const dep = rows.filter((r) => r.outrigger_state === 'DEPLOYED');
const bucket = { '<= 0': 0, '0 - 0.1': 0, '0.1 - 0.5': 0, '0.5 - 1': 0, '1 - 5': 0, '5 - 10': 0, '> 10': 0 };
for (const r of dep) {
  const m = Math.min(r.pad_fl_t, r.pad_fr_t, r.pad_rl_t, r.pad_rr_t);
  bucket[m <= 0 ? '<= 0' : m <= 0.1 ? '0 - 0.1' : m <= 0.5 ? '0.1 - 0.5' : m <= 1 ? '0.5 - 1' : m <= 5 ? '1 - 5' : m <= 10 ? '5 - 10' : '> 10']++;
}
console.log('  DEPLOYED rows:', dep.length, JSON.stringify(bucket));
const low = dep.filter((r) => Math.min(r.pad_fl_t, r.pad_fr_t, r.pad_rl_t, r.pad_rr_t) <= 1);
console.log('  rows with a pad <= 1 t:', low.map((r) => `${hms(r)} FL=${r.pad_fl_t} load=${r.load_t}`).join(' | '));
console.log('  rows with a pad <= 0 t:', dep.filter((r) => Math.min(r.pad_fl_t, r.pad_fr_t, r.pad_rl_t, r.pad_rr_t) <= 0).map((r) => `${hms(r)} (load ${r.load_t}, bad row)`).join(' ') || 'none');
console.log('  pad resolution in the file: 0.01 t; a long parked stretch has identical pad values on every row (no noise)');
for (const th of [0, 0.01, 0.05, 0.1, 0.2, 0.5, 1]) {
  const rowsHit = dep.filter((r) => r.load_t > 0 && Math.min(r.pad_fl_t, r.pad_fr_t, r.pad_rl_t, r.pad_rr_t) <= th).map(hms);
  console.log(`  threshold <= ${String(th).padEnd(4)} t, load > 0 -> ${rowsHit.length} row(s) ${rowsHit.slice(0, 6).join(' ')}`);
}

H('3. Residuals that justify the shared tolerances (valid rows only; impossible rows listed)');
const resid = (name, f) => {
  const ok = [], bad = [];
  for (const r of rows) { const v = f(r); if (v === null || !Number.isFinite(v)) continue; (IMPOSSIBLE.has(hms(r)) ? bad : ok).push([v, hms(r)]); }
  console.log(`  ${name.padEnd(26)} largest on valid rows ${Math.max(...ok.map((x) => x[0])).toFixed(4)} ; impossible rows ${bad.map((b) => b[1] + '=' + b[0].toFixed(2)).join(' ')}`);
};
resid('|radius - formula| (m)', (r) => Math.abs(r.radius_m - (r.boom_length_m * Math.cos(rad(r.boom_angle_deg)) + KIT.PIVOT_OFFSET_M)));
resid('|hook - boom tip| (m)', (r) => Number.isFinite(r.hook_height_m) ? Math.abs(r.hook_height_m - Math.max(6, r.boom_length_m * Math.sin(rad(r.boom_angle_deg)))) : null);
resid('|sum pads - (170+load)| (t)', (r) => r.outrigger_state === 'DEPLOYED' ? Math.abs(r.pad_fl_t + r.pad_fr_t + r.pad_rl_t + r.pad_rr_t - (170 + r.load_t)) : null);
let mt = 0, ml = 0, ms = 0; const wrap = (d) => ((d + 540) % 360) - 180;
for (let i = 1; i < rows.length; i++) { const a = rows[i], b = rows[i - 1]; if (!stepOk(a, b) || IMPOSSIBLE.has(hms(a)) || IMPOSSIBLE.has(hms(b))) continue; mt = Math.max(mt, Math.abs(a.boom_length_m - b.boom_length_m)); ml = Math.max(ml, Math.abs(a.boom_angle_deg - b.boom_angle_deg)); ms = Math.max(ms, Math.abs(wrap(a.slew_deg - b.slew_deg))); }
console.log(`  largest per-second change on valid rows: telescope ${mt.toFixed(2)} m/s (limit 0.3), luff ${ml.toFixed(2)} deg/s (limit 2), slew ${ms.toFixed(2)} deg/s (limit 3)`);
const angles = rows.filter((r) => !IMPOSSIBLE.has(hms(r)) && Number.isFinite(r.boom_angle_deg)).map((r) => r.boom_angle_deg);
console.log(`  boom angle on valid rows: ${Math.min(...angles)} .. ${Math.max(...angles)} deg (limit 0..85); tip height < 6 m on ${rows.filter((r) => Number.isFinite(r.boom_angle_deg) && r.boom_length_m * Math.sin(rad(r.boom_angle_deg)) < 6).length} rows`);

H('4. Detector alarm rows over the whole recording');
const cnt = {}; let prev = null, flagged = 0;
for (let i = 0; i < rows.length; i++) { const d = det.detectFailures(rows[i], prev, rows.slice(Math.max(0, i - 30), i)); if (d.failures.length) flagged++; for (const f of d.failures) cnt[f.type] = (cnt[f.type] || 0) + 1; prev = rows[i]; }
console.log('  rows with >= 1 alarm:', flagged, ' by type:', JSON.stringify(cnt));
console.log('  limits present:', ['hookMinM', 'angleMaxDeg', 'telescopeMps', 'luffDps', 'slewDps', 'radiusTolM', 'padSumTolT'].map((k) => `SAFETY_LIMITS.${k}=${SAFETY_LIMITS?.[k] ?? 'missing'}`).join(' '), `KIT.PAD_LIFT_OFF_T=${KIT.PAD_LIFT_OFF_T ?? 'missing'} KIT.FROZEN_SENSOR_DURATION_S=${KIT.FROZEN_SENSOR_DURATION_S ?? 'missing'}`);
