// ============================================================
// Cycle 3 - Mobile Crane Digital Twin
// Module 4 helper - Data quality (OK / STALE / BAD DATA)
//
// Owner: Abhishek
//
// Why this exists
//   Sir's kit README: "The file contains both real crane failures and
//   impossible rows, but do not assume that every alarming row is a
//   real failure. Handle the missing telemetry interval as a dropout."
//   The failure detector decides about crane failures. This file decides
//   whether a SAMPLE can be trusted at all, so the panel can show a
//   data-quality problem instead of a crane alarm.
//
// Pure functions. No DOM, no THREE, no chart or stability code.
// Every limit is labelled with where it comes from:
//   KIT  = stated in or derived from sir's README
//   TEAM = our own choice, not from sir
// ============================================================

import { KIT, radiusFromAngle } from './craneModel.js';   // Module 3: the one place for kit numbers and the radius formula

export const QUALITY = Object.freeze({
  OK: 'OK',
  STALE: 'STALE',          // data is missing or repeated (dropout, duplicate timestamp)
  BAD: 'BAD DATA',         // the sample contradicts itself or the physics (impossible row)
});

export const LIMITS = Object.freeze({
  gapS: 2,                 // TEAM: more than 2 s between samples = dropout (data is 1 Hz)
  pivotOffsetM: KIT.PIVOT_OFFSET_M,   // KIT: radius = L*cos(angle) + 0.8
  radiusTolM: 0.1,         // TEAM
  hookTolM: 0.5,           // TEAM
  hookMinM: 6,             // KIT: hook_height_m tracks boom-tip height, minimum 6 m
  angleMinDeg: 0,          // TEAM: boom angle above horizontal
  angleMaxDeg: 85,         // TEAM
  telescopeMps: 0.3,       // KIT motion-rate limits
  luffDps: 2,              // KIT
  slewDps: 3,              // KIT
  baseMassT: KIT.MACHINE_MASS_T,      // KIT: 45 carrier + 35 superstructure + 80 counterweight + 10 boom
  padSumTolT: 2,           // TEAM: sum of the four pads vs (170 t + hook load)
});

const NUMERIC_CORE = [
  ['load_t', 'load'],
  ['boom_length_m', 'boomLength'],
  ['boom_angle_deg', 'boomAngle'],
  ['radius_m', 'radius'],
  ['slew_deg', 'slew'],
];

const toSec = (ts) => (typeof ts === 'string' ? Date.parse(ts) / 1000 : NaN);
const rad = (d) => (d * Math.PI) / 180;
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const fin = Number.isFinite;

export const expectedRadiusM = (lengthM, angleDeg) => radiusFromAngle(lengthM, angleDeg, KIT.PIVOT_OFFSET_M);
export const expectedHookHeightM = (lengthM, angleDeg) => Math.max(LIMITS.hookMinM, lengthM * Math.sin(rad(angleDeg)));

const bad = (code, field, text) => ({ code, field, kind: 'bad', text });
const stale = (code, field, text) => ({ code, field, kind: 'stale', text });


/**
 * Problems that live in ONE sample (no previous sample needed).
 * Returns an array of issues; empty when the sample is self-consistent.
 */
export function staticIssues(sample) {
  const issues = [];
  if (sample == null || typeof sample !== 'object') {
    return [bad('NO_SAMPLE', null, 'no sample')];
  }

  for (const [key, field] of NUMERIC_CORE) {
    if (!fin(sample[key])) issues.push(bad('NON_FINITE', field, `${key} is missing or not a number`));
  }
  if (issues.length) return issues;   // the other checks need these numbers

  const { load_t: load, boom_length_m: L, boom_angle_deg: ang, radius_m: r } = sample;

  if (load < 0) {
    issues.push(bad('NEGATIVE_LOAD', 'load', `load ${load} t is negative`));
  }
  if (ang < LIMITS.angleMinDeg || ang > LIMITS.angleMaxDeg) {
    issues.push(bad('ANGLE_RANGE', 'boomAngle',
      `boom angle ${ang}° is outside ${LIMITS.angleMinDeg}..${LIMITS.angleMaxDeg}°`));
  }

  const rExp = expectedRadiusM(L, ang);
  if (Math.abs(r - rExp) > LIMITS.radiusTolM) {
    issues.push(bad('RADIUS_MISMATCH', 'radius',
      `radius ${r.toFixed(1)} m but L*cos(angle)+0.8 = ${rExp.toFixed(1)} m`));
  }

  if (fin(sample.hook_height_m)) {
    const hExp = expectedHookHeightM(L, ang);
    if (Math.abs(sample.hook_height_m - hExp) > LIMITS.hookTolM) {
      issues.push(bad('HOOK_MISMATCH', 'hook',
        `hook height ${sample.hook_height_m.toFixed(1)} m but boom tip is at ${hExp.toFixed(1)} m`));
    }
  }

  // The four pads must carry the whole machine: carrier + superstructure + counterweight + boom + hook load.
  const pads = [sample.pad_fl_t, sample.pad_fr_t, sample.pad_rl_t, sample.pad_rr_t];
  if (sample.outrigger_state === 'DEPLOYED' && pads.every(fin)) {
    const sum = pads.reduce((a, b) => a + b, 0);
    const want = LIMITS.baseMassT + load;
    if (Math.abs(sum - want) > LIMITS.padSumTolT) {
      issues.push(bad('PAD_SUM', 'pads',
        `pads add up to ${sum.toFixed(0)} t but machine + load weigh ${want.toFixed(0)} t`));
    }
  }
  return issues;
}


/**
 * Problems between this sample and the one before it: timestamps and motion rates.
 * `prev` is the sample one row earlier in the recording (or null).
 */
export function sequenceIssues(sample, prev) {
  const issues = [];
  if (!prev) return issues;

  const t = toSec(sample && sample.ts);
  const t0 = toSec(prev.ts);
  if (!fin(t)) return [bad('TS_INVALID', 'time', 'timestamp is missing or not a date')];
  if (!fin(t0)) return issues;

  const dt = t - t0;
  if (dt > LIMITS.gapS) {
    issues.push(stale('TS_GAP', 'time',
      `dropout: no data for ${Math.round(dt - 1)} s (${prev.ts.slice(11, 19)} to ${sample.ts.slice(11, 19)})`));
  } else if (dt === 0) {
    issues.push(stale('TS_REPEAT', 'time', `timestamp ${sample.ts.slice(11, 19)} repeats the previous sample`));
  } else if (dt < 0) {
    issues.push(stale('TS_BACKWARDS', 'time',
      `clock went back ${Math.round(-dt)} s (${prev.ts.slice(11, 19)} to ${sample.ts.slice(11, 19)})`));
  }

  // Motion rates only make sense across a normal 1 s step, and only when the previous
  // sample was itself believable (otherwise the row that comes BACK from a glitch would be blamed).
  if (dt > 0 && dt <= LIMITS.gapS && staticIssues(prev).length === 0) {
    const cur = sample, L = cur.boom_length_m, a = cur.boom_angle_deg, s = cur.slew_deg;
    if (fin(L) && fin(prev.boom_length_m) && Math.abs(L - prev.boom_length_m) / dt > LIMITS.telescopeMps) {
      issues.push(bad('RATE_TELESCOPE', 'boomLength',
        `boom length changed ${(Math.abs(L - prev.boom_length_m) / dt).toFixed(1)} m/s (limit ${LIMITS.telescopeMps} m/s)`));
    }
    if (fin(a) && fin(prev.boom_angle_deg) && Math.abs(a - prev.boom_angle_deg) / dt > LIMITS.luffDps) {
      issues.push(bad('RATE_LUFF', 'boomAngle',
        `boom angle changed ${(Math.abs(a - prev.boom_angle_deg) / dt).toFixed(1)}°/s (limit ${LIMITS.luffDps}°/s)`));
    }
    if (fin(s) && fin(prev.slew_deg) && Math.abs(wrap180(s - prev.slew_deg)) / dt > LIMITS.slewDps) {
      issues.push(bad('RATE_SLEW', 'slew',
        `slew changed ${(Math.abs(wrap180(s - prev.slew_deg)) / dt).toFixed(1)}°/s (limit ${LIMITS.slewDps}°/s)`));
    }
  }
  return issues;
}


/**
 * Is this sample trustworthy?
 * @returns { level: 'OK'|'STALE'|'BAD DATA', issues: [{code, field, kind, text}] }
 */
export function assessSample(sample, prev = null) {
  const issues = [...staticIssues(sample), ...sequenceIssues(sample, prev)];
  const level = issues.some((i) => i.kind === 'bad')
    ? QUALITY.BAD
    : issues.length ? QUALITY.STALE : QUALITY.OK;
  return { level, issues };
}


/**
 * Clock faults in FILE ORDER, straight from the CSV text.
 * parseCSV() sorts rows by ts, which hides a clock that steps backwards, so this reads
 * the raw lines. Returns [{ line, kind: 'GAP'|'BACKWARDS'|'REPEAT', prevTs, ts, seconds }].
 * `line` is the 1-based line number in the file (the header is line 1).
 */
export function scanClockFaults(csvText) {
  const lines = String(csvText).split(/\r?\n/);
  const out = [];
  let prevTs = null;
  for (let i = 1; i < lines.length; i++) {
    const ts = lines[i].split(',', 1)[0].trim();
    if (!ts) continue;
    if (prevTs !== null) {
      const dt = toSec(ts) - toSec(prevTs);
      if (dt > LIMITS.gapS) out.push({ line: i + 1, kind: 'GAP', prevTs, ts, seconds: dt });
      else if (dt === 0) out.push({ line: i + 1, kind: 'REPEAT', prevTs, ts, seconds: 0 });
      else if (dt < 0) out.push({ line: i + 1, kind: 'BACKWARDS', prevTs, ts, seconds: dt });
    }
    prevTs = ts;
  }
  return out;
}
