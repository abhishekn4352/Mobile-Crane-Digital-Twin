// ============================================================
// Cycle 3 - Visual layer tests (crane3d.js, pure mapping part)
//
// Runs in node, no browser needed:
//     node Cycle-3/js/test_crane3d.mjs
//
// Covers only the maths that turns a telemetry sample into a pose.
// The 3D geometry itself (boom head over the data radius, pads on
// the support polygon) is checked in the browser demo page.
// ============================================================

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseCSV } from './playbackClock.js';
import {
  BOOM_L_MIN_M,
  BOOM_L_MAX_M,
  BOOM_STROKE_M,
  boomExtensionFromLength,
  buildOutriggerTimeline,
  outriggerExtensionAt,
  poseFromSample,
} from './crane3d.js';

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; console.log(`  [FAIL] ${name} ${detail}`); }
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvText = fs.readFileSync(join(__dirname, '../data/mobile-telemetry-2026-09-16.csv'), 'utf8');
const rows = parseCSV(csvText);
const at = (hms) => rows.find((r) => r.ts.includes('T' + hms));


console.log('\n=== BOOM LENGTH -> EXTENSION ===');
check('retracted length is 23.35 m', near(BOOM_L_MIN_M, 23.35));
check('extended length is 53.35 m', near(BOOM_L_MAX_M, 53.35));
check('stroke is 30 m', near(BOOM_STROKE_M, 30));
check('23.35 m -> 0', near(boomExtensionFromLength(23.35), 0));
check('38.35 m -> 0.5', near(boomExtensionFromLength(38.35), 0.5));
check('53.35 m -> 1', near(boomExtensionFromLength(53.35), 1));
check('below range is clamped to 0', boomExtensionFromLength(13.3) === 0);
check('above range (70 m glitch row) is clamped to 1', boomExtensionFromLength(70) === 1);
check('NaN gives null (model keeps its last value)', boomExtensionFromLength(NaN) === null);
check('undefined gives null', boomExtensionFromLength(undefined) === null);
check('every valid CSV boom length (23.6 .. 52.4 m) is inside the model range',
  rows.filter((r) => r.boom_length_m <= 60).every((r) => r.boom_length_m >= BOOM_L_MIN_M && r.boom_length_m <= BOOM_L_MAX_M));


console.log('\n=== OUTRIGGER TIMELINE (real CSV) ===');
const timeline = buildOutriggerTimeline(rows);
check('4 transition runs found', timeline.length === 4, `got ${timeline.length}`);
check('run order DEPLOYING, RETRACTING, DEPLOYING, RETRACTING',
  timeline.map((r) => r.state).join() === 'DEPLOYING,RETRACTING,DEPLOYING,RETRACTING', timeline.map((r) => r.state).join());
check('first run is 240 s long (07:00:00 .. 07:03:59)', timeline[0].t1 - timeline[0].t0 + 1 === 240);
check('other runs are 300 s long', [1, 2, 3].every((i) => timeline[i].t1 - timeline[i].t0 + 1 === 300));


console.log('\n=== OUTRIGGER EXTENSION ===');
check('DEPLOYED -> 1', outriggerExtensionAt(timeline, at('10:00:00')) === 1);
check('RETRACTED -> 0', outriggerExtensionAt(timeline, at('13:00:00')) === 0);
check('DEPLOYING starts at 0 (07:00:00)', near(outriggerExtensionAt(timeline, at('07:00:00')), 0));
check('DEPLOYING is halfway at 07:02:00', near(outriggerExtensionAt(timeline, at('07:02:00')), 0.5));
check('DEPLOYING never reaches 1 before DEPLOYED (07:03:59 < 1)', outriggerExtensionAt(timeline, at('07:03:59')) < 1);
check('RETRACTING starts at 1 (12:35:00)', near(outriggerExtensionAt(timeline, at('12:35:00')), 1));
check('RETRACTING is halfway at 12:37:30', near(outriggerExtensionAt(timeline, at('12:37:30')), 0.5));
check('second DEPLOYING run is halfway at 13:47:30', near(outriggerExtensionAt(timeline, at('13:47:30')), 0.5));
check('unknown state -> null', outriggerExtensionAt(timeline, { outrigger_state: 'FAULT', ts: at('10:00:00').ts }) === null);
check('known transition state but no matching run -> 0.5', outriggerExtensionAt([], at('07:02:00')) === 0.5);
check('works after a jump (no memory of earlier samples)', (() => {
  outriggerExtensionAt(timeline, at('17:17:30'));
  return near(outriggerExtensionAt(timeline, at('07:02:00')), 0.5);
})());
check('extension stays within 0..1 over the whole recording',
  rows.every((r) => { const e = outriggerExtensionAt(timeline, r); return e >= 0 && e <= 1; }));
check('extension is non-decreasing across a DEPLOYING run', (() => {
  const run = rows.filter((r) => r.ts >= '2026-09-16T07:00:00' && r.ts < '2026-09-16T07:04:00');
  return run.every((r, i) => i === 0 || outriggerExtensionAt(timeline, r) >= outriggerExtensionAt(timeline, run[i - 1]));
})());


console.log('\n=== POSE FROM SAMPLE ===');
const s = at('09:00:00');
const pose = poseFromSample(s, timeline);
check('copies boom angle', pose.boomAngleDeg === s.boom_angle_deg);
check('copies boom length', pose.boomLengthM === s.boom_length_m);
check('copies slew in DATA convention (no mirroring here)', pose.slewDeg === s.slew_deg);
check('copies load', pose.loadT === s.load_t);
check('DEPLOYED sample -> outriggerExt 1', pose.outriggerExt === 1);
check('a NaN field stays NaN (setPose ignores it)', Number.isNaN(poseFromSample({ ...s, boom_angle_deg: NaN }, timeline).boomAngleDeg));


console.log('\n==============================================');
console.log(' VISUAL LAYER (pure part) TEST RESULTS');
console.log('==============================================');
console.log(`  PASSED : ${passed}`);
console.log(`  FAILED : ${failed}`);
console.log('==============================================');
process.exit(failed === 0 ? 0 : 1);
