// ============================================================
// Cycle 3 — Mobile Crane Digital Twin
// Module 3 — Stability & Load Chart Module + Tests
//
// Module Owner: Sujal
//
// Run:  node test_craneModel.mjs
//
// The tests import ONLY from craneModel.js, which is the same
// module the Failure Detector and the Sensor Panel use. The
// recording-based checks below prove the kit model against the
// 39,301-row telemetry file instead of against hand-typed
// numbers.
// ============================================================

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  KIT,
  CHART,
  ratedCapacity,
  radiusFromAngle,
  capacityFor,
  stabilityFor,
  padReactionsFor,
  kitCombinedCoG,
  supportPolygon,
  craneStateFor,
  pointInPolygon,
  stabilityVerdict,
} from './craneModel.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}  ->  got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function approx(label, actual, expected, tol = 1e-6) {
  const ok = actual != null && Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}  ->  got ${actual}, want ~${expected} (+/- ${tol})`);
}

function ok(label, condition, detail = '') {
  condition ? pass++ : fail++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${condition ? '' : '  ->  ' + detail}`);
}


// ------------------------------------------------------------
// Load the recording
// ------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '../data/mobile-telemetry-2026-09-16.csv');

const lines = fs.readFileSync(CSV_PATH, 'utf8').trim().split(/\r?\n/);
const headers = lines[0].split(',');
const rows = lines.slice(1).map(line => {
  const values = line.split(',');
  const row = {};
  headers.forEach((header, index) => {
    const raw = values[index];
    const num = Number(raw);
    row[header] = raw !== '' && Number.isFinite(num) ? num : raw;
  });
  return row;
});

console.log(`Recording: ${rows.length} rows\n`);


// ------------------------------------------------------------
// 1. Load chart lookup
// ------------------------------------------------------------

console.log('1. Load chart (Cycle 2 chart, read through Module 3)');

check('L 38.0 / r 12 -> 47.5 t', ratedCapacity(CHART, 38, 12), 47.5);
check('L 23.6 / r 8 -> 83.5 t', ratedCapacity(CHART, 23.6, 8), 83.5);
check('L 52.4 / r 20 -> 23.5 t', ratedCapacity(CHART, 52.4, 20), 23.5);
check('L 70.0 / r 30 -> 12.1 t (PDF p.17)', ratedCapacity(CHART, 70, 30), 12.1);
approx('interpolated L 30.8 / r 10 -> 60.5 t', ratedCapacity(CHART, 30.8, 10), 60.5);
approx('interpolated L 38 / r 16 -> 38.1 t', ratedCapacity(CHART, 38, 16), 38.1);

check('L 52.4 / r 8 -> null (F5, not permitted)', ratedCapacity(CHART, 52.4, 8), null);
check('L 13.3 / r 20 -> null (blank cell)', ratedCapacity(CHART, 13.3, 20), null);
check('L 99 / r 10 -> null (outside chart)', ratedCapacity(CHART, 99, 10), null);
check('L 38 / r 40 -> null (outside chart)', ratedCapacity(CHART, 38, 40), null);

const f1 = capacityFor({ boom_length_m: 38, radius_m: 12, load_t: 52 });
check('F1 capacity', f1.capacityT, 47.5);
check('F1 capacityInputsValid', f1.capacityInputsValid, true);
approx('F1 utilisation 52/47.5 = 109.47 %', f1.utilization * 100, 109.47, 0.01);

const f5 = capacityFor({ boom_length_m: 52.4, radius_m: 8, load_t: 4 });
check('F5 capacity is null', f5.capacityT, null);
check('F5 inputs are valid (chart refused)', f5.capacityInputsValid, true);
check('F5 utilisation is null (NOT PERMITTED)', f5.utilization, null);

const bad = capacityFor({ boom_length_m: NaN, radius_m: 12, load_t: 1 });
check('NaN boom -> capacity null', bad.capacityT, null);
check('NaN boom -> inputs invalid', bad.capacityInputsValid, false);
check('NaN boom -> utilisation null', bad.utilization, null);

check('capacityFor(null) -> inputs invalid', capacityFor(null).capacityInputsValid, false);


// ------------------------------------------------------------
// 2. Geometry: radius from boom length and angle
// ------------------------------------------------------------

console.log('\n2. Geometry (radiusFromAngle, pivot 0.8 m)');

approx('L 32, 65.64 deg -> r 14 m (recorded as 14.00)', radiusFromAngle(32, 65.64, KIT.PIVOT_OFFSET_M), 14, 0.005);
check('pivot offset is the kit 0.8 m', KIT.PIVOT_OFFSET_M, 0.8);

const radiusOutliers = [];
let worstRadius = { error: 0, ts: null };
for (const row of rows) {
  const L = row.boom_length_m;
  const angle = row.boom_angle_deg;
  const radius = row.radius_m;
  if (![L, angle, radius].every(Number.isFinite)) continue;
  const expected = radiusFromAngle(L, angle, KIT.PIVOT_OFFSET_M);
  const error = Math.abs(radius - expected);
  if (error > 0.01) radiusOutliers.push(row.ts);
  if (error > worstRadius.error && error <= 0.01) worstRadius = { error, ts: row.ts };
}

check('exactly 3 rows disagree with the radius formula', radiusOutliers.length, 3);
check('those rows are the impossible 14:30 / 15:00 / 17:00',
  JSON.stringify(radiusOutliers.slice().sort()),
  JSON.stringify([
    '2026-09-16T14:30:00+05:30',
    '2026-09-16T15:00:00+05:30',
    '2026-09-16T17:00:00+05:30',
  ].sort()));
ok(`all other rows match within 0.01 m (worst ${worstRadius.error.toFixed(5)} m)`,
  worstRadius.error <= 0.01, `worst=${worstRadius.error}`);


// ------------------------------------------------------------
// 3. Kit centre of gravity and pad reactions vs the recording
// ------------------------------------------------------------

console.log('\n3. Kit pad model vs recorded pad reactions (DEPLOYED rows)');

check('verified X spread is 7.8 m', KIT.OUTRIGGER_SPREAD_X, 7.8);
check('verified Z spread is 8.95 m', KIT.OUTRIGGER_SPREAD_Z, 8.95);
check('verified pad coordinates are mapped X ±3.9 m and Z ±4.475 m',
  JSON.stringify(KIT.PAD_POSITIONS),
  JSON.stringify({
    fl: { x: -3.9, z: -4.475 }, fr: { x: 3.9, z: -4.475 },
    rl: { x: -3.9, z: 4.475 }, rr: { x: 3.9, z: 4.475 },
  }));

// The recording predates the verified 8.95 m Z spread. Keep that fixture
// unchanged and use the same rigid-body formula with its legacy half-span.
function legacyPadReactionsFor(sample) {
  const cog = kitCombinedCoG(sample);
  if (cog == null) return null;
  const positions = [
    ['fl', -3.9, -4.45], ['fr', 3.9, -4.45],
    ['rl', -3.9, 4.45], ['rr', 3.9, 4.45],
  ];
  const sumX2 = positions.reduce((sum, [, x]) => sum + x * x, 0);
  const sumZ2 = positions.reduce((sum, [, , z]) => sum + z * z, 0);
  const raw = positions.map(([name, x, z]) => [
    name,
    cog.totalT / 4 + (cog.totalT * cog.x * x) / sumX2 + (cog.totalT * cog.z * z) / sumZ2,
  ]);
  return Object.fromEntries(raw.map(([name, value]) => [name.toUpperCase(), Math.max(0, value)]));
}

const KNOWN_EXCEPTIONS = new Set([
  '2026-09-16T14:30:00+05:30',
  '2026-09-16T15:30:00+05:30',
]);
const F6_START = '2026-09-16T10:25:01+05:30';
const F6_END = '2026-09-16T10:25:54+05:30';

let deployedRows = 0;
let padOutliers = [];
let worstPad = 0;
let worstPadTs = null;
let worstSum = 0;
let sumViolations = [];

for (const row of rows) {
  if (row.outrigger_state !== 'DEPLOYED') continue;
  const load = row.load_t;
  const radius = row.radius_m;
  const slew = row.slew_deg;
  const recorded = ['fl', 'fr', 'rl', 'rr'].map(k => row[`pad_${k}_t`]);
  if (![load, radius, slew, ...recorded].every(Number.isFinite)) continue;
  deployedRows++;

  const model = legacyPadReactionsFor(row);
  const keys = ['FL', 'FR', 'RL', 'RR'];
  let rowWorst = 0;
  for (let i = 0; i < keys.length; i++) {
    rowWorst = Math.max(rowWorst, Math.abs(model[keys[i]] - recorded[i]));
  }

  const sum = recorded.reduce((a, b) => a + b, 0);
  const sumError = Math.abs(sum - (KIT.MACHINE_MASS_T + load));
  if (sumError > 0.05) sumViolations.push(row.ts);
  else if (sumError > worstSum) worstSum = sumError;

  if (rowWorst > 0.05) {
    padOutliers.push(row.ts);
  } else if (rowWorst > worstPad) {
    worstPad = rowWorst;
    worstPadTs = row.ts;
  }
}

console.log(`  DEPLOYED rows checked: ${deployedRows}`);
check('31,860 DEPLOYED rows in the recording', deployedRows, 31860);
ok(`model matches every row within 0.05 t outside the known windows (worst ${worstPad.toFixed(5)} t at ${worstPadTs})`,
  worstPad <= 0.025, `worst=${worstPad}`);
check('exactly 56 rows are outside 0.05 t', padOutliers.length, 56);

const inF6 = padOutliers.filter(ts => ts >= F6_START && ts <= F6_END);
check('54 of them are the 10:25:01-10:25:54 F6 window', inF6.length, 54);
check('the other two are the impossible rows 14:30 and 15:30',
  JSON.stringify(padOutliers.filter(ts => !inF6.includes(ts)).sort()),
  JSON.stringify([...KNOWN_EXCEPTIONS].sort()));

check('only the impossible 15:30 row breaks the 170 t + load balance',
  JSON.stringify(sumViolations), JSON.stringify(['2026-09-16T15:30:00+05:30']));
ok(`every other row balances 170 t + load (worst ${worstSum.toFixed(4)} t)`,
  worstSum <= 0.05, `worst=${worstSum}`);

const idle = { load_t: 0, radius_m: 14, slew_deg: 0, outrigger_state: 'DEPLOYED' };
const idlePads = padReactionsFor(idle);
approx('current geometry idle pads FL = 55.96 t', idlePads.FL, 55.96, 0.01);
approx('current geometry idle pads FR = 29.04 t', idlePads.FR, 29.04, 0.01);
approx('current geometry idle pads RL = 55.96 t', idlePads.RL, 55.96, 0.01);
approx('current geometry idle pads RR = 29.04 t', idlePads.RR, 29.04, 0.01);

const retracted = padReactionsFor({ ...idle, outrigger_state: 'RETRACTED' });
check('retracted -> all pads 0', JSON.stringify(retracted), JSON.stringify({ FL: 0, FR: 0, RL: 0, RR: 0, deployed: false, computed: true }));

const unusable = padReactionsFor({ ...idle, radius_m: NaN });
check('NaN radius -> model refuses', unusable.computed, false);

const cog = kitCombinedCoG(idle);
approx('idle CoG x = -1.2353 m (counterweight behind)', cog.x, -1.2353, 0.0001);
approx('idle CoG z = 0 m at slew 0', cog.z, 0, 1e-9);
check('idle total weight = 170 t', cog.totalT, 170);

const f1cog = kitCombinedCoG({ load_t: 52, radius_m: 12, slew_deg: 35 });
ok('loaded CoG stays finite', Number.isFinite(f1cog.x) && Number.isFinite(f1cog.z), JSON.stringify(f1cog));


// ------------------------------------------------------------
// 4. Stability verdict
// ------------------------------------------------------------

console.log('\n4. Support-polygon stability verdict');

const polygon = supportPolygon();
check('polygon has 4 pads', polygon.length, 4);
check('centre is inside', pointInPolygon(0, 0, polygon), true);
check('outside a corner is not inside', pointInPolygon(4.5, 4.5, polygon), false);

const idleState = stabilityFor(idle);
check('idle DEPLOYED crane -> ok', idleState.stability, 'ok');
check('idle stability inputs valid', idleState.stabilityInputsValid, true);

const retractedState = stabilityFor({ ...idle, outrigger_state: 'RETRACTED' });
check('retracted crane -> ok (nothing supported)', retractedState.stability, 'ok');

const noDataState = stabilityFor({ ...idle, load_t: 5, radius_m: NaN });
check('load with no geometry -> verdict null', noDataState.stability, null);
check('verdict marked as not computable', noDataState.stabilityInputsValid, false);

const tippingState = stabilityFor({
  load_t: 100, radius_m: 30, slew_deg: 0, outrigger_state: 'DEPLOYED',
});
check('100 t at 30 m -> tipping', tippingState.stability, 'tipping');

const farOut = stabilityFor({
  load_t: 60, radius_m: 25, slew_deg: 90, outrigger_state: 'DEPLOYED',
});
check('60 t at 25 m / 90 deg is outside the polygon', farOut.stability, 'tipping');

const falseAlarmWindows = [
  '2026-09-16T11:00:00+05:30',
  '2026-09-16T14:09:59+05:30',
  '2026-09-16T14:19:57+05:30',
  '2026-09-16T14:39:51+05:30',
  '2026-09-16T14:49:48+05:30',
];
const byTs = new Map(rows.map(row => [row.ts, row]));
for (const ts of falseAlarmWindows) {
  const state = stabilityFor(byTs.get(ts));
  check(`A2 false-alarm row ${ts.slice(11, 19)} -> ${state.stability}`, state.stability !== 'tipping', true);
}

const f6State = stabilityFor(byTs.get('2026-09-16T10:25:27+05:30'));
ok(`F6 pad lift-off row: model CoG still inside (verdict ${f6State.stability}, recorded FL 0.02 t)`,
  f6State.stability !== 'tipping', JSON.stringify(f6State));

check('stabilityFor(null) -> null verdict', stabilityFor(null).stability, null);
check('stabilityVerdict is re-exported and callable',
  stabilityVerdict(0, 0, polygon, { warnMarginM: KIT.WARN_MARGIN_M }), 'ok');


// ------------------------------------------------------------
// 5. craneStateFor — one call for the panel
// ------------------------------------------------------------

console.log('\n5. craneStateFor');

const state = craneStateFor(byTs.get('2026-09-16T09:00:00+05:30'));
check('capacityT', state.capacityT, 47.5);
check('capacityInputsValid', state.capacityInputsValid, true);
check('utilization > 1 (overload)', state.utilization > 1, true);
check('stability verdict present', typeof state.stability, 'string');
check('cog present', typeof state.cog.x, 'number');
check('pads present', typeof state.pads.FL, 'number');
check('polygon present', state.polygon.length, 4);

const notPermittedState = craneStateFor(byTs.get('2026-09-16T12:18:40+05:30'));
check('F5 sample capacity is null', notPermittedState.capacityT, null);
check('F5 sample utilisation is null', notPermittedState.utilization, null);


// ------------------------------------------------------------
// 6. Single source of truth
//------------------------------------------------------------

console.log('\n6. Single source of truth (no second copy in Cycle 3)');

const cycle3Dir = join(__dirname);
const cycle3Files = fs.readdirSync(cycle3Dir)
  .filter(name => name.endsWith('.js'))
  .sort();

const detectorSource = fs.readFileSync(join(cycle3Dir, 'failureDetector.js'), 'utf8');

check('failureDetector imports Module 3',
  detectorSource.includes("from './craneModel.js'"), true);
check('failureDetector no longer imports Cycle 2 directly',
  detectorSource.includes('../../Cycle-2'), false);
check('failureDetector has no local centre-of-gravity copy',
  detectorSource.includes('function kitCentreOfGravity'), false);
check('failureDetector has no local load chart copy',
  detectorSource.includes('capacityT: ['), false);
check('failureDetector has no local outrigger spread constants',
  detectorSource.includes('OUTRIGGER_SPREAD_X'), false);

let directCycle2Imports = [];
for (const name of cycle3Files) {
  if (name === 'craneModel.js') continue;
  const source = fs.readFileSync(join(cycle3Dir, name), 'utf8');
  if (source.includes("Cycle-2/js/")) directCycle2Imports.push(name);
}
check('no other Cycle 3 module reaches around Module 3',
  JSON.stringify(directCycle2Imports), '[]');

const reExported = [
  'ratedCapacity', 'radiusFromAngle', 'stabilityVerdict',
  'pointInPolygon', 'edgeDistanceM', 'loadGroundPosition',
  'combinedCoG', 'outriggerPolygonForSpread',
];
const modelSource = fs.readFileSync(join(cycle3Dir, 'craneModel.js'), 'utf8');
for (const name of reExported) {
  ok(`craneModel.js exposes ${name}`, modelSource.includes(name));
}


// ------------------------------------------------------------
// Summary
// ------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log(` MODULE 3 TEST RESULTS  ->  ${pass} passed, ${fail} failed`);
console.log('-'.repeat(60));
process.exit(fail === 0 ? 0 : 1);
