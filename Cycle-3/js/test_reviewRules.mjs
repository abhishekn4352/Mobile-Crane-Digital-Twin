// Checks for the Cycle 3 review items 2, 3, 4 (frozen sensor, lift-off, one copy of the shared limits). Plain node:
//     node Cycle-3/js/test_reviewRules.mjs
// A starting point for whoever commits the constants / detector change (Rushikesh, Sujal): edit freely.
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseCSV } from './playbackClock.js';
import * as det from './failureDetector.js';
import { KIT, SAFETY_LIMITS, expectedHookHeightM, kitCombinedCoG } from './craneModel.js';
import { assessSample, LIMITS, createProductionFrozenSensorTracker } from './dataQuality.js';

const here = dirname(fileURLToPath(import.meta.url));
const rows = parseCSV(fs.readFileSync(join(here, '../data/mobile-telemetry-2026-09-16.csv'), 'utf8'));
const hms = (r) => r.ts.slice(11, 19);
const at = (t) => rows.findIndex((r) => hms(r) === t);
const BAD_ROWS = ['14:30:00', '15:00:00', '15:30:00', '17:00:00'];
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
const run = (i) => det.detectFailures(rows[i], i ? rows[i - 1] : null);
const has = (d, type) => d.failures.some((f) => f.type === type);

console.log('--- item 4: one copy of the shared limits (craneModel.js)');
for (const k of ['telescopeMps', 'luffDps', 'slewDps', 'hookMinM', 'hookTolM', 'angleMinDeg', 'angleMaxDeg', 'radiusTolM', 'padSumTolT']) {
  check(`SAFETY_LIMITS.${k} is defined`, Number.isFinite(SAFETY_LIMITS[k]), String(SAFETY_LIMITS[k]));
}
check('SAFETY_LIMITS holds the kit limits: 0.3 m/s, 2 deg/s, 3 deg/s, hook minimum 6 m',
  SAFETY_LIMITS.telescopeMps === 0.3 && SAFETY_LIMITS.luffDps === 2 && SAFETY_LIMITS.slewDps === 3 && SAFETY_LIMITS.hookMinM === 6);
check('expectedHookHeightM is the boom-tip height with the 6 m minimum',
  typeof expectedHookHeightM === 'function' && expectedHookHeightM(32, 65.64) > 29 && expectedHookHeightM(10, 10) === 6);
for (const f of ['failureDetector.js', 'dataQuality.js']) {
  const src = fs.readFileSync(join(here, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check(`${f}: no own hook-height formula (no Math.sin of the boom angle)`, !/Math\.sin/.test(src));
  check(`${f}: no typed 85-degree limit and no typed 0.3 / 2 / 3 rate limits`,
    !/\b85\b/.test(src) && !/\/\s*(seconds|dt)\s*>\s*\d/.test(src));
  check(`${f}: no typed radius tolerance and no typed pad-sum tolerance`,
    !/expectedRadius\)\s*>\s*\d/.test(src) && !/PAD_SUM_TOLERANCE\s*=\s*\d/.test(src) && !/padSumTolT:\s*\d/.test(src) && !/radiusTolM:\s*\d/.test(src));
}
check('dataQuality LIMITS equal the SAFETY_LIMITS values',
  LIMITS.angleMaxDeg === SAFETY_LIMITS.angleMaxDeg && LIMITS.telescopeMps === SAFETY_LIMITS.telescopeMps && LIMITS.luffDps === SAFETY_LIMITS.luffDps
  && LIMITS.slewDps === SAFETY_LIMITS.slewDps && LIMITS.hookMinM === SAFETY_LIMITS.hookMinM && LIMITS.hookTolM === SAFETY_LIMITS.hookTolM
  && LIMITS.radiusTolM === SAFETY_LIMITS.radiusTolM && LIMITS.padSumTolT === SAFETY_LIMITS.padSumTolT);
const bad = rows.filter((r) => BAD_ROWS.includes(hms(r)));
check('the four impossible rows are still found, by both modules, with the shared tolerances',
  bad.length === 4 && bad.every((r) => det.detectFailures(r, null).status === 'INVALID_TELEMETRY' && assessSample(r, null).level === 'BAD DATA'));
const okRows = rows.filter((r, i) => i % 97 === 0 && !BAD_ROWS.includes(hms(r)));
check('no valid row (every 97th) is called invalid', okRows.every((r) => det.detectFailures(r, null).status !== 'INVALID_TELEMETRY'));

console.log('--- item 3: lift-off at a small noise threshold');
check('KIT.PAD_LIFT_OFF_T is 0.1 t', KIT.PAD_LIFT_OFF_T === 0.1);
check('the lowest pad on a loaded crane is 0.02 t, at 10:25:27 and 10:25:28',
  rows[at('10:25:27')].pad_fl_t === 0.02 && rows[at('10:25:28')].pad_fl_t === 0.02);
check('10:25:27 and 10:25:28 raise OUTRIGGER_LIFT_OFF', has(run(at('10:25:27')), 'OUTRIGGER_LIFT_OFF') && has(run(at('10:25:28')), 'OUTRIGGER_LIFT_OFF'));
check('10:25:26 (0.16 t) is near lift-off, not lift-off',
  has(run(at('10:25:26')), 'OUTRIGGER_NEAR_LIFT_OFF') && !has(run(at('10:25:26')), 'OUTRIGGER_LIFT_OFF'));
check('a retracted or deploying crane (pads 0 by design) raises no lift-off',
  !has(run(at('12:40:00')), 'OUTRIGGER_LIFT_OFF') && !has(run(at('07:03:30')), 'OUTRIGGER_LIFT_OFF'));
check('the 15:30:00 bad row is INVALID_TELEMETRY, not a lift-off alarm',
  run(at('15:30:00')).status === 'INVALID_TELEMETRY' && !has(run(at('15:30:00')), 'OUTRIGGER_LIFT_OFF'));
let liftRows = 0;
rows.forEach((_, i) => { if (has(run(i), 'OUTRIGGER_LIFT_OFF')) liftRows++; });
check('whole day: exactly 2 lift-off rows', liftRows === 2, String(liftRows));

console.log('--- item 3 (continued): the 0.1 t threshold against the pad sensor noise');
{
  // kit reaction formula with the kit pad positions (+-3.9 / +-4.45 m: the recording was made with these)
  const pads = [['fl', -3.9, -4.45], ['fr', 3.9, -4.45], ['rl', -3.9, 4.45], ['rr', 3.9, 4.45]];
  const sx = pads.reduce((s, [, x]) => s + x * x, 0), sz = pads.reduce((s, [, , z]) => s + z * z, 0);
  const SKIP = new Set([...BAD_ROWS]);
  let n = 0, worst = 0, sumSq = 0;
  rows.forEach((r) => {
    const t = hms(r);
    if (r.outrigger_state !== 'DEPLOYED' || SKIP.has(t) || (t >= '10:25:01' && t <= '10:25:54')) return;
    const cog = kitCombinedCoG(r);
    if (!cog) return;
    pads.forEach(([k, x, z]) => {
      const model = cog.totalT / 4 + (cog.totalT * cog.x * x) / sx + (cog.totalT * cog.z * z) / sz;
      const e = r[`pad_${k}_t`] - model;
      n++; worst = Math.max(worst, Math.abs(e)); sumSq += e * e;
    });
  });
  const sigma = Math.sqrt(sumSq / n);
  check(`pad noise: ${n} pad readings differ from the kit formula by at most ${worst.toFixed(4)} t (sigma ${sigma.toFixed(4)} t)`, n > 120000 && worst > 0.02 && worst < 0.025 && sigma < 0.004);
  check('0.1 t is at least four times the largest noise error, so noise alone never raises lift-off', KIT.PAD_LIFT_OFF_T >= 4 * worst, `${KIT.PAD_LIFT_OFF_T} vs ${worst}`);
  let lowestOther = Infinity;
  rows.forEach((r) => {
    const t = hms(r);
    if (r.outrigger_state !== 'DEPLOYED' || r.load_t <= 0 || SKIP.has(t) || (t >= '10:25:00' && t <= '10:25:56')) return;
    lowestOther = Math.min(lowestOther, r.pad_fl_t, r.pad_fr_t, r.pad_rl_t, r.pad_rr_t);
  });
  check(`the lowest pad on any other loaded row is ${lowestOther} t, far above 0.1 t: the threshold has no false alarms`, lowestOther > 10);
}

console.log('--- item 2: frozen sensors (sir\'s kit README section 3; the rule needs another axis to be moving)');
check('mapping: bit 1 telescope -> boom length, bit 2 luff -> boom angle, bit 3 slew -> slew (bit 0 is the hoist)',
  JSON.stringify(KIT.FROZEN_SENSOR_MAPPINGS.map((m) => [m.field, m.bit])) === JSON.stringify([['boom_length_m', 1], ['boom_angle_deg', 2], ['slew_deg', 3]]),
  JSON.stringify(KIT.FROZEN_SENSOR_MAPPINGS));
check('duration is 10 s and the other axis must have changed on half of those seconds', KIT.FROZEN_SENSOR_DURATION_S === 10 && KIT.FROZEN_SENSOR_MOVING_FRACTION === 0.5);
{
  const bitOf = (r, b) => (r.status_word >> b) & 1;
  // the 11 held lifts: bits 1-3 set, nothing moves
  const held = [];
  let s = null;
  rows.forEach((r, i) => {
    const moving = bitOf(r, 1) && bitOf(r, 2) && bitOf(r, 3) && i > 0 &&
      ['boom_length_m', 'boom_angle_deg', 'slew_deg'].every((f) => r[f] === rows[i - 1][f]);
    if (moving && s === null) s = i;
    if (!moving && s !== null) { if (i - s >= 25) held.push(hms(rows[s - 1])); s = null; }
  });
  check('the recording has 11 stretches of 30 s or more where bits 1-3 are set and the boom, luff and slew do not change at all (held lifts)',
    held.join() === '09:00:00,09:50:00,10:25:00,11:00:00,12:18:40,12:30:00,14:00:00,14:10:00,14:20:00,14:40:00,14:50:00', held.join());
}
const tracker = createProductionFrozenSensorTracker();
const frozenAt = new Set();
rows.forEach((r) => { if (tracker.update(r).length) frozenAt.add(hms(r)); });
check('the production tracker reports nothing on the whole recording: held lifts, parked periods, the 07:03 hoist, the dropout and the repeated timestamp are all silent',
  frozenAt.size === 0, [...frozenAt].slice(0, 4).join());
{
  // a stuck sensor in an in-memory copy of a real sweep (the file on disk is untouched)
  const a = at('08:50:00'), b = at('08:51:00'), f = at('08:50:30');
  const copy = rows.slice(a, b + 1).map((r) => ({ ...r }));
  for (let i = f - a; i < copy.length; i++) copy[i].boom_angle_deg = copy[f - a].boom_angle_deg;
  const t2 = createProductionFrozenSensorTracker();
  const hits = [];
  copy.forEach((r) => t2.update(r).forEach((x) => hits.push([hms(r), x.field])));
  check('a boom-angle sensor stuck from 08:50:30 in a real sweep is reported from 08:50:40, on that channel only',
    hits.length === 21 && hits[0].join() === '08:50:40,boom_angle_deg' && hits.every((h) => h[1] === 'boom_angle_deg'), JSON.stringify(hits.slice(0, 2)));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
