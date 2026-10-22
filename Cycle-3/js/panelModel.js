// ============================================================
// Cycle 3 - Mobile Crane Digital Twin
// Module 4 - Sensor Panel & Alarm UI : the logic (no DOM)
//
// Owner: Abhishek
//
// This file decides WHAT the panel shows. js/panel.js only draws it.
// It never calculates chart or stability values:
//   - capacity, utilisation, stability verdict, expected pressure
//     come from the failure detector's `derived` block, which in turn
//     uses the shared chart + stability modules;
//   - alarms come from detectFailures() (Module 2);
//   - the playback position and mode come from the clock (Module 1).
//
// What it adds (and nothing more):
//   - data quality: OK / STALE / BAD DATA (dataQuality.js). A BAD DATA row is
//     shown as a data problem; the detector alarms on it are NOT counted as
//     crane failures.
//   - it hands the detector clean input: a blank device LMI reading is passed as NaN (the shared
//     parseCSV() turns an empty cell into 0), and the previous row is passed only when that row
//     itself is believable, so the row after a glitch is not blamed for the glitch.
//   - device conditions (wind, LMI bypass, pre-warning, A2B, device-vs-chart LMI) and
//     NOT PERMITTED are the detector's own alarms; the panel only classifies and words them.
//   - an alarm log: one latched entry per alarm episode, stamped with the
//     first timestamp at which it became true, however the playback got there.
// ============================================================

import { KIT } from './craneModel.js';            // Module 3: kit constants live there only
import { QUALITY, LIMITS, assessSample, staticIssues } from './dataQuality.js';
import { expectedRadiusM, expectedHookHeightM } from './dataQuality.js';

export const MODE = Object.freeze({ LIVE: 'LIVE', MANUAL: 'MANUAL' });

// KIT: wind alert threshold; status_word bits (README section 3).
export const WIND_ALERT_KMH = 36;
export const STATUS_BIT = Object.freeze({ outriggersSet: 4, wind: 6, overload: 7, prewarn: 8, a2b: 9, bypass: 12 });

// TEAM thresholds (not from sir): LMI mismatch tolerance, pad colouring.
export const LMI_TOLERANCE_PCT = 2;
export const PAD_WATCH_T = KIT.PAD_NEAR_LIFT_T;   // the kit / detector near-lift-off value
export const PREWARN_PCT = 90;         // KIT: bit 8 = LMI pre-warning (>= 90 %)

const JUMP_ROWS = 1200;                // a forward step bigger than this is treated as a jump
const MAX_LOOKBACK_ROWS = 5000;        // how far back we look for the true start of an alarm

// Which of the detector's alarm types are crane failures (critical) and which are
// device / driver conditions. TEAM classification: the kit does not rank them.
const CRITICAL_TYPES = new Set([
  'OVERLOAD', 'STABILITY_LOSS', 'OUTRIGGER_LIFT_OFF', 'HYDRAULIC_PRESSURE_LOSS', 'IMPROPER_OUTRIGGER_DEPLOYMENT',
  'NOT_PERMITTED', 'A2B_ALERT', 'DEVICE_OVERLOAD',
]);
const DEVICE_TYPES = new Set([
  'WIND_ALERT', 'LMI_BYPASS', 'LMI_PREWARNING', 'DEVICE_OVERLOAD', 'A2B_ALERT', 'LMI_DIVERGENCE',
]);
// alarms whose triggerValue is the raw status_word: the panel shows the bit instead
const STATUS_BIT_OF = { LMI_BYPASS: 12, DEVICE_OVERLOAD: 7, A2B_ALERT: 9 };

const fin = Number.isFinite;
const fmt = (n, d = 1) => (fin(n) ? n.toFixed(d) : '—');
const hms = (ts) => (typeof ts === 'string' && ts.length >= 19 ? ts.slice(11, 19) : '--:--:--');
export const hasBit = (word, bit) => fin(word) && ((word >> bit) & 1) === 1;


// ------------------------------------------------------------
// 1. Analyse ONE sample -> everything the panel needs to know about it
// ------------------------------------------------------------

/**
 * Device LMI % of one sample, or null when the device gave no reading.
 * The kit says lmi_pct is EMPTY when the chart does not permit the combination.
 * The shared parseCSV() turns an empty cell into 0 (Number('') === 0), so a 0 with a real
 * load on the hook cannot be a reading: it is treated as blank. (If parseCSV is changed to
 * give NaN for empty cells this still works.)
 */
export function deviceLmiPct(sample) {
  if (!sample || !fin(sample.lmi_pct)) return null;
  if (sample.lmi_pct === 0 && fin(sample.load_t) && sample.load_t > 0.5) return null;
  return sample.lmi_pct;
}

/**
 * The detector's pad checks need four finite pad readings on a DEPLOYED crane. A MANUAL sample has
 * no pad model, so the detector is given an even split of (kit mass + load): finite and balanced,
 * so the pad checks stay silent. The panel never shows these numbers (pads read "not simulated").
 */
function withNeutralPads(sample) {
  if (!fin(sample.load_t)) return sample;
  const each = (KIT.MACHINE_MASS_T + sample.load_t) / 4;
  return { ...sample, pad_fl_t: each, pad_fr_t: each, pad_rl_t: each, pad_rr_t: each };
}

/**
 * @param sample  telemetry sample (CSV row object, or a manual sample)
 * @param prev    the row before it in the recording (null for a manual sample)
 * @param deps    { detect }   detectFailures(sample, previousSample) from Module 2
 * @param opts    { manual }   true for a MANUAL (override) sample
 */
export function analyseSample(sample, prev, deps, opts = {}) {
  const manual = !!opts.manual;
  const cwtT = opts.cwtT ?? 80;
  const quality = assessSample(sample, manual ? null : prev);

  // The previous row goes to the detector's rate check only if that row is itself believable.
  const prevOk = !manual && prev && !staticIssues(prev).some((i) => i.kind === 'bad');
  const prevArg = prevOk ? prev : undefined;

  // --- clean input for the detector
  let input = sample;
  if (manual && sample) input = withNeutralPads(sample);
  let detection = deps.detect(input, prevArg, cwtT);
  if (!manual && sample && sample.lmi_pct === 0) {
    // 0 is a blank cell (parseCSV) when there is a load on the hook, or when the chart has no
    // capacity here; the kit says lmi_pct is empty in that case. Hand the detector NaN instead.
    const d0 = detection && detection.derived;
    const blank = (fin(sample.load_t) && sample.load_t > 0.5) || (d0 && d0.capacityInputsValid && d0.capacityT === null);
    if (blank) {
      input = { ...sample, lmi_pct: NaN };
      detection = deps.detect(input, prevArg, cwtT);
    }
  }
  const derived = (detection && detection.derived) || null;

  // --- split the detector's output: data-quality verdict vs alarms
  let crane = [];
  const dataFromDetector = [];
  for (const f of (detection && detection.failures) || []) {
    if (f.type === 'DATA_QUALITY') dataFromDetector.push(String(f.triggerValue || f.rule)); else crane.push(f);
  }
  if (detection && detection.status === 'INVALID_TELEMETRY' && dataFromDetector.length === 0) {
    dataFromDetector.push((detection.errors || []).join('; ') || 'invalid telemetry');
  }
  if (manual) {
    // MANUAL does not simulate pads or the device LMI: those checks are not meaningful there.
    crane = crane.filter((f) => !['OUTRIGGER_LIFT_OFF', 'OUTRIGGER_NEAR_LIFT_OFF', 'LMI_DIVERGENCE'].includes(f.type));
  }

  // --- data quality = my checks (dataQuality.js) + the detector's own verdict
  const issues = [...quality.issues];
  const myBad = issues.some((i) => i.kind === 'bad');
  const detectorAlsoFlags = dataFromDetector.length > 0;
  if (detectorAlsoFlags && !myBad) {
    for (const t of dataFromDetector) issues.push({ code: 'DETECTOR_DATA_QUALITY', field: null, kind: 'bad', text: t });
  }
  const level = issues.some((i) => i.kind === 'bad') ? QUALITY.BAD : issues.length ? QUALITY.STALE : QUALITY.OK;

  // --- a BAD DATA row is not a crane failure: keep alarms out of the failure list
  let failures = crane;
  let suppressed = [];
  if (level === QUALITY.BAD) {
    suppressed = [...new Set(crane.map((f) => f.type))];
    failures = [];
  }

  // --- capacity: a number, "not permitted", or unknown
  const inputsOk = fin(sample && sample.boom_length_m) && fin(sample && sample.radius_m);
  const capT = derived ? derived.capacityT : null;
  const capacity = !inputsOk || (capT !== null && !fin(capT))
    ? { kind: 'unknown', t: null, cwtT }
    : capT === null ? { kind: 'not-permitted', t: null, cwtT } : { kind: 'value', t: capT, cwtT };
  const utilPct = derived && fin(derived.utilization) ? derived.utilization * 100 : null;

  // --- device LMI vs the chart (the detector's LMI_DIVERGENCE decides "mismatch")
  const devicePct = manual || !input || !fin(input.lmi_pct) ? null : input.lmi_pct;
  const lmi = {
    devicePct,
    computedPct: capacity.kind === 'value' ? utilPct : null,
    mismatch: failures.some((f) => f.type === 'LMI_DIVERGENCE'),
  };

  // --- everything that is "raised" on this row (the alarm log is built from this)
  const raised = [];
  for (const f of failures) {
    let value = f.triggerValue;
    let rule = f.rule;
    if (STATUS_BIT_OF[f.type]) value = `status bit ${STATUS_BIT_OF[f.type]}`;
    if (f.type === 'LMI_PREWARNING' && !fin(derived && derived.utilization)) value = 'status bit 8';
    if (f.type === 'LMI_DIVERGENCE' && fin(f.triggerValue) && fin(f.limit)) {
      rule = `device LMI ${fmt(f.triggerValue)} % but the chart gives ${fmt(f.limit)} % (tolerance ${LMI_TOLERANCE_PCT} points)`;
    } else if (f.type === 'LMI_DIVERGENCE') {
      rule = fin(f.triggerValue)
        ? `device LMI ${fmt(f.triggerValue)} % but the chart has no capacity for this boom and radius`
        : `device LMI is blank but the chart has a capacity of ${fmt(capacity.t)} t for this boom and radius`;
    }
    raised.push({
      kind: DEVICE_TYPES.has(f.type) ? 'device' : 'failure', type: f.type,
      severity: CRITICAL_TYPES.has(f.type) ? 'critical' : 'warning',
      value, limit: f.limit, rule,
    });
  }
  if (level === QUALITY.BAD) {
    const bad = issues.filter((i) => i.kind === 'bad');
    const notes = [];
    if (suppressed.length) notes.push(`detector alarm(s) not counted as crane failures: ${suppressed.join(', ')}`);
    if (detectorAlsoFlags) notes.push('the failure detector also reports DATA_QUALITY for this row');
    raised.push({
      kind: 'data', type: 'BAD_DATA', severity: 'data', value: bad[0].text, limit: 'consistent sample',
      rule: bad.map((i) => i.text).join('; '), note: notes.join('. '),
    });
  }
  for (const i of issues.filter((x) => x.kind === 'stale')) {
    const type = i.code === 'TS_GAP' ? 'DROPOUT' : i.code === 'TS_REPEAT' ? 'REPEATED_TIMESTAMP' : 'CLOCK_BACKWARDS';
    raised.push({ kind: 'data', type, severity: 'data', value: i.text, limit: `${2} s`, rule: i.text, note: '' });
  }

  return {
    ts: sample ? sample.ts : null, sample, manual, quality: { level, issues }, detection, derived,
    failures, suppressed, capacity, utilPct, lmi, raised,
  };
}


// ------------------------------------------------------------
// 2. Alarm log: one latched entry per alarm episode
// ------------------------------------------------------------

export class AlarmLog {
  constructor(maxEntries = 300) {
    this.max = maxEntries;
    this.entries = [];
    this._open = new Map();
    this._paused = new Map();   // real alarms that a MANUAL sample closed (they carry on when LIVE comes back)
    this._seq = 0;
  }

  reset() { this.entries = []; this._open.clear(); this._paused.clear(); }

  /**
   * Feed ONE analysed row, in recording order.
   * opts.simulated  true for MANUAL samples (the entries are tagged SIMULATED)
   * opts.onset      optional (raised) -> { ts, raised } : the first row of the unbroken run that
   *                 contains this row. Used when we arrive in the middle of an episode (a jump), so
   *                 the first timestamp AND the trigger value are still those of the true start.
   */
  ingest(analysis, opts = {}) {
    const simulated = !!opts.simulated;
    const now = new Set();
    for (const r of analysis.raised) {
      const key = `${r.kind}:${r.type}:${simulated ? 'S' : 'L'}`;
      now.add(key);
      const open = this._open.get(key);
      if (open) { open.lastTs = analysis.ts; open.rows += 1; continue; }
      const paused = !simulated ? this._paused.get(key) : null;
      if (paused) {
        // back from MANUAL: the real alarm that was greyed while the sliders were in control carries on
        // (same entry, same true first timestamp), instead of a second copy of it
        this._paused.delete(key);
        paused.active = true; paused.clearedTs = null; paused.lastTs = analysis.ts; paused.rows += 1;
        this._open.set(key, paused);
        continue;
      }
      const o = opts.onset ? opts.onset(r) : null;          // { ts, raised } of the first row of the run
      const first = o ? o.raised : r;
      const e = {
        id: ++this._seq, key, kind: r.kind, type: r.type, severity: r.severity,
        value: first.value, limit: first.limit, rule: first.rule, note: first.note || '',
        firstTs: o ? o.ts : analysis.ts, lastTs: analysis.ts, active: true, clearedTs: null, simulated, rows: 1,
      };
      this.entries.push(e);
      this._open.set(key, e);
    }
    for (const [key, e] of this._open) {
      if (now.has(key)) continue;
      e.active = false;
      e.clearedTs = analysis.ts;
      this._open.delete(key);
      if (simulated && !e.simulated) this._paused.set(key, e);
    }
    if (!simulated) this._paused.clear();                 // only the first LIVE row after MANUAL may revive them
    if (this.entries.length > this.max) {
      const drop = this.entries.findIndex((e) => !e.active);
      if (drop >= 0) {
        const [gone] = this.entries.splice(drop, 1);
        if (this._paused.get(gone.key) === gone) this._paused.delete(gone.key);
      }
    }
  }

  /** Active alarms first (newest first), then cleared ones (newest first). */
  list() {
    const by = (a, b) => (a.firstTs < b.firstTs ? 1 : a.firstTs > b.firstTs ? -1 : b.id - a.id);
    return [...this.entries.filter((e) => e.active).sort(by), ...this.entries.filter((e) => !e.active).sort(by)];
  }

  activeCount(severity) {
    return this.entries.filter((e) => e.active && (!severity || e.severity === severity)).length;
  }
}


// ------------------------------------------------------------
// 3. MANUAL sample: built from the slider values
// ------------------------------------------------------------

/**
 * @param base  the last telemetry sample (keeps ts and unit_id)
 * @param c     { loadT, boomLengthM, boomAngleDeg, slewDeg, windKmh, outriggerState }
 * @param deps  { expectedPressure(loadT, radiusM, boomLengthM) }  from the failure detector
 */
export function manualSampleFromControls(base, c, deps) {
  const r = expectedRadiusM(c.boomLengthM, c.boomAngleDeg);
  return {
    ...base,
    manual: true,
    load_t: c.loadT,
    boom_length_m: c.boomLengthM,
    boom_angle_deg: c.boomAngleDeg,
    radius_m: r,
    slew_deg: c.slewDeg,
    hook_height_m: expectedHookHeightM(c.boomLengthM, c.boomAngleDeg),
    outrigger_state: c.outriggerState,
    wind_kmh: c.windKmh,
    // not simulated: pads need the stability module's pad model; LMI/status are device values
    pad_fl_t: NaN, pad_fr_t: NaN, pad_rl_t: NaN, pad_rr_t: NaN,
    lmi_pct: NaN,
    status_word: 0,
    event: '',
    hydraulic_pressure_bar: deps.expectedPressure(c.loadT, r, c.boomLengthM),   // kit model, shown as "modelled"
  };
}

/** Slider values that mirror a telemetry sample (used in LIVE mode). */
export function controlsFromSample(sample) {
  return {
    loadT: sample.load_t,
    boomLengthM: sample.boom_length_m,
    boomAngleDeg: sample.boom_angle_deg,
    slewDeg: sample.slew_deg,
    windKmh: sample.wind_kmh,
    outriggerState: sample.outrigger_state,
  };
}


// ------------------------------------------------------------
// 4. View-model: the exact text and colour class of every panel element
// ------------------------------------------------------------

const cls = { ok: 'ok', warn: 'warn', crit: 'crit', mute: 'mute', bad: 'bad' };

function triggerText(e) {
  const v = e.value;
  if (e.type === 'OVERLOAD' || e.type === 'NOT_PERMITTED') return fin(v) ? `${fmt(v, 1)} t` : String(v);
  if (e.type === 'HYDRAULIC_PRESSURE_LOSS') return fin(v) ? `${fmt(v, 1)} bar` : String(v);
  if (e.type === 'WIND_ALERT') return fin(v) ? `${fmt(v, 0)} km/h` : String(v);
  if (e.type === 'LMI_PREWARNING') return fin(v) ? `${fmt(v, 1)} %` : String(v);
  if (e.type === 'LMI_DIVERGENCE') {
    const dev = fin(v) ? `${fmt(v, 1)} %` : 'blank';
    return fin(e.limit) ? `${dev} vs ${fmt(e.limit, 1)} %` : `${dev} vs chart`;
  }
  return v === null || v === undefined ? '—' : String(v);
}

function emptyModel(mode) {
  const dash = { text: '—', cls: cls.mute };
  return {
    mode: modeBadge(mode), quality: { level: QUALITY.OK, cls: cls.mute, text: '—', detail: '', issues: [] },
    time: { text: '--:--:--', iso: null },
    fields: { load: dash, boomAngle: dash, boomLength: dash, radius: dash, slew: dash, outrigger: dash, pressure: { ...dash, sub: '' }, wind: dash },
    pads: { FL: dash, FR: dash, RL: dash, RR: dash, note: '' },
    capacity: { ...dash, sub: '' }, utilisation: { ...dash, pct: 0 }, stability: { ...dash, sub: '' }, lmi: { ...dash, mismatch: false },
    chips: [], banner: { cls: cls.mute, label: 'NO DATA', reason: '' }, alarms: [], counts: { critical: 0, warning: 0, data: 0 },
  };
}

function modeBadge(mode) {
  return mode === MODE.MANUAL
    ? { key: MODE.MANUAL, text: 'MANUAL (override)', cls: cls.warn }
    : { key: MODE.LIVE, text: 'LIVE (telemetry)', cls: cls.ok };
}

/**
 * @param analysis  result of analyseSample() for the sample on screen (or null)
 * @param log       the AlarmLog
 * @param mode      'LIVE' | 'MANUAL'
 */
export function buildPanelModel(analysis, log, mode) {
  if (!analysis || !analysis.sample) return emptyModel(mode);
  const s = analysis.sample;
  const manual = mode === MODE.MANUAL;
  const flagged = new Set(analysis.quality.issues.map((i) => i.field).filter(Boolean));
  const val = (n, d, unit, field) => ({ text: fin(n) ? `${fmt(n, d)} ${unit}`.trim() : '—', cls: flagged.has(field) ? cls.bad : cls.ok });

  // ---- sensor fields
  const outCls = s.outrigger_state === 'DEPLOYED' ? cls.ok : s.outrigger_state === 'RETRACTED' ? cls.mute : cls.warn;
  const expP = analysis.derived ? analysis.derived.expectedHydraulicPressure : NaN;
  const hydraulic = analysis.failures.some((f) => f.type === 'HYDRAULIC_PRESSURE_LOSS');
  const fields = {
    load: val(s.load_t, 1, 't', 'load'),
    boomAngle: val(s.boom_angle_deg, 1, '°', 'boomAngle'),
    boomLength: val(s.boom_length_m, 1, 'm', 'boomLength'),
    radius: val(s.radius_m, 1, 'm', 'radius'),
    slew: val(s.slew_deg, 0, '°', 'slew'),
    outrigger: { text: s.outrigger_state || '—', cls: outCls },
    pressure: {
      text: fin(s.hydraulic_pressure_bar) ? `${fmt(s.hydraulic_pressure_bar, 0)} bar` : '—',
      cls: hydraulic ? cls.crit : cls.ok,
      sub: manual ? 'modelled (kit formula)' : fin(expP) ? `expected ${fmt(expP, 0)} bar` : '',
    },
    wind: { text: fin(s.wind_kmh) ? `${fmt(s.wind_kmh, 0)} km/h` : '—', cls: fin(s.wind_kmh) && s.wind_kmh > WIND_ALERT_KMH ? cls.crit : cls.ok },
  };

  // ---- pad reactions (telemetry only)
  const padKeys = [['FL', 'pad_fl_t'], ['FR', 'pad_fr_t'], ['RL', 'pad_rl_t'], ['RR', 'pad_rr_t']];
  const pads = { note: manual ? 'not simulated in MANUAL' : s.outrigger_state === 'DEPLOYED' ? '' : 'unloaded while outriggers move / retracted' };
  for (const [name, key] of padKeys) {
    const v = s[key];
    let c = cls.ok;
    if (!fin(v) || manual) c = cls.mute;
    else if (s.outrigger_state !== 'DEPLOYED') c = cls.mute;
    else if (v <= 0) c = cls.crit;
    else if (v < PAD_WATCH_T) c = cls.warn;
    if (flagged.has('pads')) c = cls.bad;
    pads[name] = { text: fin(v) && !manual ? `${fmt(v, 1)} t` : '—', cls: c };
  }

  // ---- capacity / utilisation / stability (from the shared modules, via the detector)
  const cap = analysis.capacity;
  const isAssumed = (cap && cap.cwtT === 40) || analysis.cwtT === 40;
  const capSub = isAssumed
    ? 'ASSUMED, not manufacturer data'
    : 'from the load chart';
  const capacity = cap.kind === 'value'
    ? { text: `${fmt(cap.t, 1)} t`, cls: cls.ok, sub: capSub }
    : cap.kind === 'not-permitted'
      ? { text: 'NOT PERMITTED', cls: s.load_t > 0.5 ? cls.crit : cls.warn, sub: 'chart has no capacity for this boom + radius' }
      : { text: '—', cls: cls.mute, sub: 'boom length or radius unknown' };
  const u = analysis.utilPct;
  const utilCls = u === null ? cls.mute : u >= 100 ? cls.crit : u >= PREWARN_PCT ? cls.warn : cls.ok;
  const utilisation = { text: u === null ? '—' : `${Math.round(u)}%`, cls: utilCls, pct: u === null ? 0 : Math.max(0, Math.min(u, 100)) };

  const evaluated = s.outrigger_state === 'DEPLOYED' && fin(s.load_t) && s.load_t > 0;
  const sv = analysis.derived ? analysis.derived.stability : null;
  const stability = !evaluated
    ? { text: 'NOT EVALUATED', cls: cls.mute, sub: 'needs outriggers DEPLOYED and a load' }
    : sv === 'ok' ? { text: 'OK', cls: cls.ok, sub: 'load point inside the support polygon' }
      : sv === 'warn' ? { text: 'WARN', cls: cls.warn, sub: 'close to the polygon edge' }
        : sv === 'tipping' ? { text: 'TIPPING', cls: cls.crit, sub: 'outside the support polygon' }
          : { text: '—', cls: cls.mute, sub: 'geometry unknown' };

  const lm = analysis.lmi;
  const lmi = {
    text: manual ? 'not simulated' : lm.devicePct === null ? (cap.kind === 'not-permitted' ? 'blank' : '—') : `${fmt(lm.devicePct, 1)} %`,
    computed: lm.computedPct === null ? (cap.kind === 'not-permitted' ? 'not permitted' : '—') : `${fmt(lm.computedPct, 1)} %`,
    mismatch: lm.mismatch,
    cls: lm.mismatch ? cls.warn : cls.ok,
  };

  // ---- device chips (from status_word + wind)
  const word = fin(s.status_word) ? s.status_word : null;
  const chips = manual
    ? [{ key: 'wind', label: 'WIND ALERT', on: fin(s.wind_kmh) && s.wind_kmh > WIND_ALERT_KMH }]
    : [
      { key: 'wind', label: 'WIND ALERT', on: (fin(s.wind_kmh) && s.wind_kmh > WIND_ALERT_KMH) || hasBit(word, STATUS_BIT.wind) },
      { key: 'bypass', label: 'LMI BYPASS', on: hasBit(word, STATUS_BIT.bypass) },
      { key: 'prewarn', label: 'LMI PRE-WARN', on: hasBit(word, STATUS_BIT.prewarn) },
      { key: 'a2b', label: 'A2B', on: hasBit(word, STATUS_BIT.a2b) },
    ];

  // ---- data quality badge
  const q = analysis.quality;
  const quality = {
    level: q.level,
    cls: q.level === QUALITY.OK ? cls.ok : q.level === QUALITY.STALE ? cls.warn : cls.crit,
    text: q.level,
    detail: q.issues.map((i) => i.text).join('; '),
    issues: q.issues,
  };

  // ---- banner: what is wrong on THIS sample
  const sim = manual ? 'SIMULATED · ' : '';
  const here = analysis.raised;
  const crit = here.filter((r) => r.severity === 'critical');
  const warn = here.filter((r) => r.severity === 'warning');
  let banner;
  if (q.level === QUALITY.BAD) {
    banner = { cls: cls.warn, label: `${sim}BAD DATA · not a crane failure`, reason: quality.detail + (analysis.suppressed.length ? `. Detector alarm(s) ignored: ${analysis.suppressed.join(', ')}.` : '') };
  } else if (crit.length) {
    banner = { cls: cls.crit, label: `${sim}${crit.map((r) => r.type.replace(/_/g, ' ')).join(' + ')}`, reason: crit[0].rule };
  } else if (warn.length) {
    banner = { cls: cls.warn, label: `${sim}${warn.map((r) => r.type.replace(/_/g, ' ')).join(' + ')}`, reason: warn[0].rule };
  } else if (q.level === QUALITY.STALE) {
    banner = { cls: cls.warn, label: `${sim}STALE DATA`, reason: quality.detail };
  } else {
    banner = { cls: cls.ok, label: `${sim}NORMAL OPERATION`, reason: 'No alarm on this sample.' };
  }

  // ---- alarm list (latched log)
  const alarms = log.list().map((e) => ({
    id: e.id,
    type: e.type.replace(/_/g, ' '),
    kind: e.kind,
    severity: e.severity,
    valueText: triggerText(e),
    rule: e.rule,
    note: e.note,
    firstTs: e.firstTs,
    first: hms(e.firstTs),
    active: e.active,
    clearedAt: e.clearedTs ? hms(e.clearedTs) : null,
    simulated: e.simulated,
    rows: e.rows,
  }));

  return {
    mode: modeBadge(mode),
    quality,
    time: { text: hms(s.ts), iso: s.ts },
    fields, pads, capacity, utilisation, stability, lmi, chips, banner, alarms,
    counts: { critical: log.activeCount('critical'), warning: log.activeCount('warning'), data: log.activeCount('data') },
  };
}


// ------------------------------------------------------------
// 4b. Dropout in progress (the clock is ts-driven)
// ------------------------------------------------------------

/**
 * The ts-driven clock waits on the last good row while it crosses a stretch with no rows
 * (the 15:20:00-15:24:59 dropout). Without a signal the page would look frozen. This says
 * whether the clock is inside such a stretch.
 *
 * @param rows         parsed recording (sorted by ts)
 * @param index        the row the clock is showing
 * @param simElapsedS  simulated seconds since that row was published. The clock does not expose
 *                     this, so the page estimates it (wall time x playback rate): display only.
 * @returns null, or { lastTs, nextTs, gapS, missingS, elapsedS }
 */
export function dropoutStatus(rows, index, simElapsedS) {
  const cur = rows && rows[index];
  const nxt = rows && rows[index + 1];
  if (!cur || !nxt || !fin(simElapsedS)) return null;
  const gapS = (Date.parse(nxt.ts) - Date.parse(cur.ts)) / 1000;
  if (!(gapS > LIMITS.gapS) || !(simElapsedS > LIMITS.gapS)) return null;
  return { lastTs: cur.ts, nextTs: nxt.ts, gapS, missingS: gapS - 1, elapsedS: Math.min(simElapsedS, gapS) };
}

/** A copy of the view-model that says NO DATA (the values on it are the last ones received). */
export function applyDropout(vm, d) {
  if (!vm || !d) return vm;
  const detail = `no data since ${hms(d.lastTs)}: ${Math.floor(d.elapsedS)} s of ${Math.round(d.gapS)} s until the next sample at ${hms(d.nextTs)}`;
  return {
    ...vm,
    dropout: d,
    quality: { ...vm.quality, level: QUALITY.STALE, cls: cls.warn, text: QUALITY.STALE, detail },
    banner: { cls: cls.warn, label: 'NO DATA · dropout in progress', reason: `${detail}. Values shown are the last ones received (${hms(d.lastTs)}).` },
  };
}


// ------------------------------------------------------------
// 5. Session: feeds the log from the playback and builds the view-model
// ------------------------------------------------------------

export class PanelSession {
  /**
   * @param rows  parsed recording (parseCSV output)
   * @param deps  { detect, expectedPressure }  from failureDetector.js
   */
  constructor(rows, deps) {
    this.rows = rows;
    this.deps = deps;
    this.log = new AlarmLog();
    this.mode = MODE.LIVE;
    this.cwtT = 80;                       // active counterweight: 80 or 40
    this.lastIdx = null;
    this._fromManual = false;
    this._memo = { i: -1, a: null };
    this.lastAnalysis = null;
  }

  /** Switch the active counterweight config and reset the alarm log + analysis cache. */
  setCounterweight(cwtT) {
    this.cwtT = cwtT;
    this.log.reset();
    this._memo = { i: -1, a: null };
  }

  /** Analysis of recording row i (same answer however the playback got there). */
  analyseRow(i) {
    if (this._memo.i === i) return this._memo.a;
    const a = analyseSample(this.rows[i], i > 0 ? this.rows[i - 1] : null, this.deps, { cwtT: this.cwtT });
    this._memo = { i, a };
    return a;
  }

  /** (raised) -> { ts, raised } of the first row of the unbroken run that contains `index`. */
  onsetFinder(index) {
    return (raised) => {
      let found = { ts: this.rows[index].ts, raised };
      for (let k = index - 1; k >= 0 && index - k <= MAX_LOOKBACK_ROWS; k--) {
        const a = analyseSample(this.rows[k], k > 0 ? this.rows[k - 1] : null, this.deps, { cwtT: this.cwtT });
        const hit = a.raised.find((x) => x.kind === raised.kind && x.type === raised.type);
        if (!hit) break;
        found = { ts: a.ts, raised: hit };
      }
      return found;
    };
  }

  /**
   * LIVE: the clock published row `index`.
   * continuous = the clock is playing (steps forward through the data), so every row
   * between the last position and this one is fed to the log. Otherwise it is a jump.
   */
  liveUpdate(index, continuous = false) {
    this.mode = MODE.LIVE;
    const prev = this.lastIdx;
    let analysis;
    const jump = prev === null || (!continuous && index !== prev) || index < prev || index - prev > JUMP_ROWS;
    if (jump) {
      // arrived by a jump (or the first sample): start the log again from here,
      // looking back so the first timestamps are the true starts of the alarms
      this.log.reset();
      this._fromManual = false;
      analysis = this.analyseRow(index);
      this.log.ingest(analysis, { onset: this.onsetFinder(index) });
    } else if (this._fromManual) {
      // back from MANUAL on the same row: the real alarms re-open with their true first timestamps
      this._fromManual = false;
      analysis = this.analyseRow(index);
      this.log.ingest(analysis, { onset: this.onsetFinder(index) });
    } else if (index > prev) {
      for (let k = prev + 1; k <= index; k++) this.log.ingest(this.analyseRow(k));
      analysis = this.analyseRow(index);
    } else {
      analysis = this.analyseRow(index);                 // same row published again: nothing new
    }
    this.lastIdx = index;
    this.lastAnalysis = analysis;
    return buildPanelModel(analysis, this.log, MODE.LIVE);
  }

  /** MANUAL: a sample built from the sliders (see manualSampleFromControls). */
  manualUpdate(sample) {
    this.mode = MODE.MANUAL;
    this._fromManual = true;
    const analysis = analyseSample(sample, null, this.deps, { manual: true, cwtT: this.cwtT });
    this.log.ingest(analysis, { simulated: true });
    this.lastAnalysis = analysis;
    return buildPanelModel(analysis, this.log, MODE.MANUAL);
  }

  /** Redraw the last analysed sample (for example after the mode badge changes). */
  current(mode = this.mode) {
    return buildPanelModel(this.lastAnalysis, this.log, mode);
  }
}


// ------------------------------------------------------------
// 6. Event index of a RECORDING (for the "Jump to" list)
// ------------------------------------------------------------

/**
 * Pre-scan of a RECORDED day: every row goes through the same analysis and the same alarm log that the
 * playback uses, and the alarm episodes come back with their first timestamps.
 *
 * Why it exists: the "Jump to" list used to be typed into the page (times chosen by hand). A typed list
 * knows the future, only fits one CSV and can disagree with the detector. This list is derived: nothing
 * in it is written by hand, and it is exactly what the alarm log shows when the whole day is played.
 *
 * What it is NOT: a detector. It cannot be used on a live feed, where the future is unknown; there the
 * alarm log simply fills as rows arrive. It only helps to navigate a recording.
 *
 * @returns [{ type, kind, severity, firstTs, lastTs, index, rows, value, rule }] in time order
 *          (`index` = position in `rows` of the first row of the episode; with repeated timestamps it can
 *          differ from the first row that has that ts)
 */
export function buildEventIndex(rows, deps, cwtT = 80) {
  const log = new AlarmLog(Number.MAX_SAFE_INTEGER);
  for (let i = 0; i < rows.length; i++) {
    const n = log.entries.length;
    log.ingest(analyseSample(rows[i], i > 0 ? rows[i - 1] : null, deps, { cwtT }));
    for (let k = n; k < log.entries.length; k++) log.entries[k].index = i;     // the row on which the episode was first seen
  }
  return log.entries
    .map((e) => ({ type: e.type, kind: e.kind, severity: e.severity, firstTs: e.firstTs, lastTs: e.lastTs, index: e.index, rows: e.rows, value: e.value, rule: e.rule }))
    .sort((a, b) => (a.firstTs < b.firstTs ? -1 : a.firstTs > b.firstTs ? 1 : 0));
}
