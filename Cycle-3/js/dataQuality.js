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

import {
  KIT,
  SAFETY_LIMITS,
  expectedHookHeightM,
  radiusFromAngle,
  statusBitSet,
} from './craneModel.js';   // Module 3: the one place for kit numbers and safety rules

export const QUALITY = Object.freeze({
  OK: 'OK',
  STALE: 'STALE',          // data is missing or repeated (dropout, duplicate timestamp)
  BAD: 'BAD DATA',         // the sample contradicts itself or the physics (impossible row)
});

export const LIMITS = Object.freeze({
  gapS: 2,                 // TEAM: more than 2 s between samples = dropout (data is 1 Hz)
  pivotOffsetM: KIT.PIVOT_OFFSET_M,   // KIT: radius = L*cos(angle) + 0.8
  radiusTolM: 0.1,         // TEAM
  hookTolM: SAFETY_LIMITS.hookTolM,
  hookMinM: SAFETY_LIMITS.hookMinM,
  angleMinDeg: SAFETY_LIMITS.angleMinDeg,
  angleMaxDeg: SAFETY_LIMITS.angleMaxDeg,
  telescopeMps: SAFETY_LIMITS.telescopeMps,
  luffDps: SAFETY_LIMITS.luffDps,
  slewDps: SAFETY_LIMITS.slewDps,
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
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const fin = Number.isFinite;

export const expectedRadiusM = (lengthM, angleDeg) => radiusFromAngle(lengthM, angleDeg, KIT.PIVOT_OFFSET_M);
export { expectedHookHeightM };

/**
 * Build a frozen-sensor tracker from an explicit mapping and duration.
 *
 * The generic helper remains configurable so tests and future integrations do
 * not silently inherit the provisional production assumptions in KIT.
 */
export function createFrozenSensorTracker({ mappings, durationS } = {}) {
  if (!Array.isArray(mappings) || mappings.length === 0 ||
      !Number.isFinite(durationS) || durationS <= 0) {
    throw new TypeError('frozen-sensor mappings and a positive durationS are required');
  }
  for (const mapping of mappings) {
    if (!mapping || typeof mapping.field !== 'string' ||
        !Number.isInteger(mapping.bit) || mapping.bit < 0) {
      throw new TypeError('each frozen-sensor mapping needs a field and non-negative bit');
    }
  }

  const active = new Map();
  let previousTimestamp = null;

  const reset = () => {
    active.clear();
    previousTimestamp = null;
  };

  const update = (sample) => {
    const timestamp = sample && typeof sample.ts === 'string' ? Date.parse(sample.ts) : NaN;
    if (!sample || !Number.isFinite(timestamp) ||
        (previousTimestamp !== null &&
         (timestamp <= previousTimestamp || (timestamp - previousTimestamp) / 1000 > LIMITS.gapS))) {
      reset();
      return [];
    }

    const seconds = previousTimestamp === null ? 0 : (timestamp - previousTimestamp) / 1000;
    previousTimestamp = timestamp;
    const issues = [];

    for (const mapping of mappings) {
      const key = mapping.field;
      if (!statusBitSet(sample.status_word, mapping.bit) ||
          !Number.isFinite(sample[key])) {
        active.delete(key);
        continue;
      }

      const prior = active.get(key);
      if (!prior || sample[key] !== prior.value) {
        active.set(key, { value: sample[key], elapsedS: 0, reported: false });
        continue;
      }

      prior.elapsedS += seconds;
      if (prior.elapsedS >= durationS && !prior.reported) {
        prior.reported = true;
        issues.push({
          code: 'FROZEN_SENSOR',
          field: key,
          kind: 'bad',
          text: `${key} remained ${sample[key]} while status_word bit ${mapping.bit} was active for at least ${durationS} s`,
        });
      }
    }
    return issues;
  };

  return Object.freeze({ update, reset });
}


/**
 * Create a frozen-sensor tracker pre-configured with the provisional production
 * mappings and duration from KIT (craneModel.js). This is deliberately limited
 * to the fields whose motion relationship is documented in KIT; it does not
 * treat every sensor as changing for every active motion bit.
 *
 * IMPORTANT: the bit-to-field mapping and the duration are documented in
 * KIT.FROZEN_SENSOR_MAPPINGS and KIT.FROZEN_SENSOR_DURATION_S as UNRESOLVED /
 * TEAM choices.  This factory exists so callers (e.g. the playback path in
 * panelModel.js) can hold ONE instance that spans the recording rather than
 * re-creating it per sample.  Reset the tracker whenever the playback position
 * jumps, the stream is interrupted, or the sample sequence breaks.
 *
 * @returns {{ update(sample): Issue[], reset(): void }}
 */
export function createProductionFrozenSensorTracker() {
  return createFrozenSensorTracker({
    mappings: Array.from(KIT.FROZEN_SENSOR_MAPPINGS),
    durationS: KIT.FROZEN_SENSOR_DURATION_S,
  });
}

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
 *
 * @param sample        the current telemetry sample (CSV row object)
 * @param prev          the sample before it, or null
 * @param frozenTracker optional result of createProductionFrozenSensorTracker()
 *                      (or createFrozenSensorTracker()).  When supplied, the
 *                      tracker is updated with this sample and any FROZEN_SENSOR
 *                      issues are merged into the result.
 *
 *                      The tracker is stateful — it must be the same instance
 *                      across consecutive calls in recording / streaming order.
 *                      Pass null or omit for one-shot quality checks where no
 *                      cross-sample tracking is needed.
 *
 * @returns { level: 'OK'|'STALE'|'BAD DATA', issues: [{code, field, kind, text}] }
 */
export function assessSample(sample, prev = null, frozenTracker = null) {
  const issues = [...staticIssues(sample), ...sequenceIssues(sample, prev)];
  if (frozenTracker) {
    const frozenIssues = frozenTracker.update(sample);
    issues.push(...frozenIssues);
  }
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
