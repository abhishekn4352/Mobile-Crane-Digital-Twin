// ============================================================
// Cycle 3 - Module 4 helper tests (dataQuality.js)
//
//     node Cycle-3/js/test_dataQuality.mjs
//
// Checks the OK / STALE / BAD DATA decision on the real kit CSV.
// The expected rows come from the fault list (FAULT-LIST.md, sections 3 and 4).
// ============================================================

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseCSV } from './playbackClock.js';
import {
  QUALITY, LIMITS, assessSample, staticIssues, sequenceIssues,
  expectedRadiusM, expectedHookHeightM, scanClockFaults,
  createFrozenSensorTracker, createProductionFrozenSensorTracker,
} from './dataQuality.js';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; console.log(`  [FAIL] ${name} ${detail}`); }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvText = fs.readFileSync(join(__dirname, '../data/mobile-telemetry-2026-09-16.csv'), 'utf8');
const rows = parseCSV(csvText);
const idxAt = (hms) => rows.findIndex((r) => r.ts.includes('T' + hms));
const hms = (r) => r.ts.slice(11, 19);

const results = rows.map((r, i) => assessSample(r, i ? rows[i - 1] : null));
const listOf = (level) => rows.filter((_, i) => results[i].level === level).map(hms);
const codesAt = (t) => results[idxAt(t)].issues.map((i) => i.code).sort();


console.log('\n=== FORMULAS ===');
check('expected radius of the idle crane (32 m @ 65.64 deg) is 14.0 m', Math.abs(expectedRadiusM(32, 65.64) - 14.0) < 0.01);
check('expected hook height of the idle crane is 29.15 m', Math.abs(expectedHookHeightM(32, 65.64) - 29.15) < 0.01);
check('hook height has a 6 m floor', expectedHookHeightM(20, 5) === 6);


console.log('\n=== WHOLE RECORDING ===');
check('BAD DATA rows are exactly the 4 impossible rows',
  listOf(QUALITY.BAD).join() === '14:30:00,15:00:00,15:30:00,17:00:00', listOf(QUALITY.BAD).join());
check('STALE rows are the dropout, the two repeated stamps and the 13 s jump',
  listOf(QUALITY.STALE).join() === '15:25:00,15:59:49,15:59:49,16:00:02', listOf(QUALITY.STALE).join());
check('every other row (39,293) is OK', results.filter((r) => r.level === QUALITY.OK).length === rows.length - 8);
check('real failures are NOT bad data: overload 09:00:00, 09:50:00, 11:00:00 are OK',
  ['09:00:00', '09:50:00', '11:00:00'].every((t) => results[idxAt(t)].level === QUALITY.OK));
check('real failures are NOT bad data: hydraulic loss 11:02:00 is OK', results[idxAt('11:02:00')].level === QUALITY.OK);
check('real failure is NOT bad data: pad near lift-off 10:25:27 is OK', results[idxAt('10:25:27')].level === QUALITY.OK);
check('real failure is NOT bad data: hoist while DEPLOYING 07:03:00 is OK', results[idxAt('07:03:00')].level === QUALITY.OK);
check('real condition is NOT bad data: wind alert 12:30:00 is OK', results[idxAt('12:30:00')].level === QUALITY.OK);
check('real condition is NOT bad data: not-permitted combination 12:18:40 is OK', results[idxAt('12:18:40')].level === QUALITY.OK);


console.log('\n=== THE FOUR IMPOSSIBLE ROWS (reasons) ===');
check('14:30:00 radius 40 m contradicts boom 32 m @ 65.64 deg', codesAt('14:30:00').join() === 'RADIUS_MISMATCH', codesAt('14:30:00').join());
check('15:00:00 boom 70 m: radius, hook and telescope-rate checks all fire',
  codesAt('15:00:00').join() === 'HOOK_MISMATCH,RADIUS_MISMATCH,RATE_TELESCOPE', codesAt('15:00:00').join());
check('15:30:00 load -3 t and pads that add up to 0 t',
  codesAt('15:30:00').join() === 'NEGATIVE_LOAD,PAD_SUM', codesAt('15:30:00').join());
check('17:00:00 angle 95 deg: range, radius, hook and luff-rate checks fire',
  codesAt('17:00:00').join() === 'ANGLE_RANGE,HOOK_MISMATCH,RADIUS_MISMATCH,RATE_LUFF', codesAt('17:00:00').join());
check('the row AFTER a glitch (15:00:01, 17:00:01) is not blamed for coming back to normal',
  results[idxAt('15:00:01')].level === QUALITY.OK && results[idxAt('17:00:01')].level === QUALITY.OK);


console.log('\n=== DROPOUT AND CLOCK FAULTS (sorted rows, as the playback clock sees them) ===');
const gap = results[idxAt('15:25:00')].issues[0];
check('15:25:00 follows a 301 s gap: TS_GAP, 300 s missing', gap.code === 'TS_GAP' && /300 s/.test(gap.text), gap.text);
check('dropout message names both ends (15:19:59 to 15:25:00)', /15:19:59 to 15:25:00/.test(gap.text), gap.text);
check('dropout is STALE, not BAD DATA (it is a data problem, not an impossible reading)', results[idxAt('15:25:00')].level === QUALITY.STALE);
check('15:59:49 appears 3 times; the 2nd and 3rd are flagged TS_REPEAT',
  rows.filter((r) => hms(r) === '15:59:49').length === 3 &&
  results.filter((r, i) => hms(rows[i]) === '15:59:49' && r.issues.some((x) => x.code === 'TS_REPEAT')).length === 2);
check('16:00:02 follows a 3 s gap (16:00:00 and 16:00:01 never appear): TS_GAP', codesAt('16:00:02').join() === 'TS_GAP');
check('no motion-rate flag is raised across a dropout (dt is too big to mean anything)',
  !results[idxAt('15:25:00')].issues.some((i) => i.code.startsWith('RATE_')));


console.log('\n=== CLOCK FAULTS IN FILE ORDER (raw CSV text) ===');
const raw = scanClockFaults(csvText);
check('4 raw clock faults: gap, backwards, repeat, gap', raw.map((r) => r.kind).join() === 'GAP,BACKWARDS,REPEAT,GAP', raw.map((r) => r.kind).join());
check('dropout is 301 s between 15:19:59 and 15:25:00 (line 30002)', raw[0].seconds === 301 && raw[0].line === 30002);
check('the backwards step is visible in file order: 15:59:59 -> 15:59:49 (-10 s, line 32102)', raw[1].seconds === -10 && raw[1].line === 32102);
check('then a 13 s jump to 16:00:02 (line 32104)', raw[3].seconds === 13 && raw[3].line === 32104);
check('parseCSV sorting hides the backwards step (no TS_BACKWARDS in sorted rows)',
  !results.some((r) => r.issues.some((i) => i.code === 'TS_BACKWARDS')));
check('a backwards step IS caught when samples arrive in order, e.g. from a live stream',
  sequenceIssues({ ts: '2026-09-16T15:59:49+05:30' }, { ts: '2026-09-16T15:59:59+05:30' })[0].code === 'TS_BACKWARDS');


console.log('\n=== EDGE CASES (no throwing) ===');
const good = rows[idxAt('10:00:00')];
check('no previous sample: only the sample itself is judged', assessSample(good, null).level === QUALITY.OK);
check('null sample -> BAD DATA, not an exception', assessSample(null, null).level === QUALITY.BAD);
check('NaN boom length -> BAD DATA (NON_FINITE)', assessSample({ ...good, boom_length_m: NaN }, null).issues[0].code === 'NON_FINITE');
check('missing ts with a previous sample -> BAD DATA (TS_INVALID)', assessSample({ ...good, ts: '' }, good).level === QUALITY.BAD);
check('slew wraps: 179 deg -> -179 deg is a 2 deg step, not 358',
  assessSample({ ...good, ts: '2026-09-16T10:00:01+05:30', slew_deg: -179 }, { ...good, slew_deg: 179 }).level === QUALITY.OK);
check('slew faster than 3 deg/s is flagged',
  assessSample({ ...good, ts: '2026-09-16T10:00:01+05:30', slew_deg: 20 }, { ...good, slew_deg: 10 }).issues.some((i) => i.code === 'RATE_SLEW'));
check('pad sum is only judged while DEPLOYED (pads are 0 while DEPLOYING)',
  staticIssues({ ...good, outrigger_state: 'DEPLOYING', pad_fl_t: 0, pad_fr_t: 0, pad_rl_t: 0, pad_rr_t: 0 }).length === 0);
check('limits are frozen (cannot be changed by accident)', Object.isFrozen(LIMITS) && Object.isFrozen(QUALITY));


console.log('\n=== OPT-IN FROZEN-SENSOR HELPER (SYNTHETIC CONTRACT TESTS) ===');
// These tests exercise the generic state machine only. The bit-to-field mapping
// and 3-second interval are synthetic inputs, not approved production settings.
const frozenBase = {
  ts: '2026-09-16T18:00:00+05:30',
  status_word: 1,
  boom_length_m: 32,
};
const tracker = createFrozenSensorTracker({
  mappings: [{ field: 'boom_length_m', bit: 0 }],
  durationS: 3,
});
check('active unchanged sensor does not report before the configured duration',
  tracker.update(frozenBase).length === 0 &&
  tracker.update({ ...frozenBase, ts: '2026-09-16T18:00:01+05:30' }).length === 0 &&
  tracker.update({ ...frozenBase, ts: '2026-09-16T18:00:02+05:30' }).length === 0);
check('active unchanged sensor reports once at the configured duration',
  tracker.update({ ...frozenBase, ts: '2026-09-16T18:00:03+05:30' })[0]?.code === 'FROZEN_SENSOR');
check('continuing freeze does not duplicate the issue',
  tracker.update({ ...frozenBase, ts: '2026-09-16T18:00:04+05:30' }).length === 0);
check('inactive motion bit does not report and resets the candidate',
  tracker.update({ ...frozenBase, ts: '2026-09-16T18:00:05+05:30', status_word: 0 }).length === 0 &&
  tracker.update({ ...frozenBase, ts: '2026-09-16T18:00:06+05:30' }).length === 0);
check('sensor change during movement resets the candidate',
  tracker.update({ ...frozenBase, ts: '2026-09-16T18:00:07+05:30', boom_length_m: 32.1 }).length === 0 &&
  tracker.update({ ...frozenBase, ts: '2026-09-16T18:00:08+05:30', boom_length_m: 32.1 }).length === 0);
check('movement stopping before the duration cannot report a freeze', (() => {
  const t = createFrozenSensorTracker({ mappings: [{ field: 'boom_length_m', bit: 0 }], durationS: 3 });
  t.update(frozenBase);
  t.update({ ...frozenBase, ts: '2026-09-16T18:00:01+05:30' });
  return t.update({ ...frozenBase, ts: '2026-09-16T18:00:02+05:30', status_word: 0 }).length === 0;
})());
check('timestamp gap resets the candidate', (() => {
  const t = createFrozenSensorTracker({ mappings: [{ field: 'boom_length_m', bit: 0 }], durationS: 3 });
  t.update(frozenBase);
  return t.update({ ...frozenBase, ts: '2026-09-16T18:00:04+05:30' }).length === 0;
})());
check('duplicate timestamp resets the candidate', (() => {
  const t = createFrozenSensorTracker({ mappings: [{ field: 'boom_length_m', bit: 0 }], durationS: 3 });
  t.update(frozenBase);
  return t.update(frozenBase).length === 0;
})());
check('missing or invalid sensor values suspend detection', (() => {
  const t = createFrozenSensorTracker({ mappings: [{ field: 'boom_length_m', bit: 0 }], durationS: 3 });
  t.update(frozenBase);
  return t.update({ ...frozenBase, ts: '2026-09-16T18:00:01+05:30', boom_length_m: NaN }).length === 0 &&
    t.update({ ...frozenBase, ts: '2026-09-16T18:00:02+05:30' }).length === 0;
})());
check('parked constant value does not report without an active motion bit', (() => {
  const t = createFrozenSensorTracker({ mappings: [{ field: 'boom_length_m', bit: 0 }], durationS: 3 });
  return t.update({ ...frozenBase, status_word: 0 }).length === 0 &&
    t.update({ ...frozenBase, ts: '2026-09-16T18:00:01+05:30', status_word: 0 }).length === 0 &&
    t.update({ ...frozenBase, ts: '2026-09-16T18:00:02+05:30', status_word: 0 }).length === 0 &&
    t.update({ ...frozenBase, ts: '2026-09-16T18:00:03+05:30', status_word: 0 }).length === 0;
})());
check('production tracker is wired to the shared provisional mapping and duration', (() => {
  const t = createProductionFrozenSensorTracker();
  const base = { ...frozenBase, status_word: 1 };
  t.update(base);
  t.update({ ...base, ts: '2026-09-16T18:00:01+05:30' });
  t.update({ ...base, ts: '2026-09-16T18:00:02+05:30' });
  return t.update({ ...base, ts: '2026-09-16T18:00:03+05:30' })
    .some((issue) => issue.code === 'FROZEN_SENSOR' && issue.field === 'boom_length_m');
})());
check('invalid production timestamp resets frozen tracking', (() => {
  const t = createProductionFrozenSensorTracker();
  const base = { ...frozenBase, status_word: 1 };
  t.update(base);
  t.update({ ...base, ts: '' });
  return t.update({ ...base, ts: '2026-09-16T18:00:01+05:30' }).length === 0;
})());


console.log('\n==============================================');
console.log(' DATA QUALITY TEST RESULTS');
console.log('==============================================');
console.log(`  PASSED : ${passed}`);
console.log(`  FAILED : ${failed}`);
console.log('==============================================');
process.exit(failed === 0 ? 0 : 1);
