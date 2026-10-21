// ============================================================
// Cycle 3 — Mobile Crane Digital Twin
// Module 3 — Stability & Load Chart Module + Tests
//
// Module Owner: Sujal
//
// Single source of truth for every chart and stability number
// used by the Cycle 3 twin. The Failure Detector, the Sensor
// Panel and the 3D UI import from this file; none of them may
// re-implement a chart lookup, an interpolation, an outrigger
// geometry, a centre-of-gravity calculation or a support
// reaction.
//
// The file re-exports the tested Cycle 2 primitives (the load
// chart and the support-polygon geometry) and adds the kit
// model from README-for-students.md §2:
//
//   carrier 45 t + superstructure 35 t at the slew centre
//   counterweight 80 t, 3.5 m tail radius, at slew + 180°
//   boom self-weight 10 t at half the horizontal reach
//   hook load at the working radius
//   pads at (±3.9, ±4.45) m, rigid-body plane reactions
// ============================================================

import {
  CHART,
  ratedCapacity,
  radiusFromAngle,
  validate,
  VALIDATION_CELLS,
} from '../../Cycle-2/js/loadchart.js';

import {
  pointInPolygon,
  loadGroundPosition,
  edgeDistanceM,
  stabilityVerdict,
  combinedCoG,
  outriggerPolygonForSpread,
  DEFAULT_WARN_MARGIN_M,
} from '../../Cycle-2/js/stability.js';

export {
  CHART,
  ratedCapacity,
  radiusFromAngle,
  validate,
  VALIDATION_CELLS,
  pointInPolygon,
  loadGroundPosition,
  edgeDistanceM,
  stabilityVerdict,
  combinedCoG,
  outriggerPolygonForSpread,
  DEFAULT_WARN_MARGIN_M,
};


// ------------------------------------------------------------
// Kit constants (README-for-students.md §2)
//
// Manufacturer chart values live in Cycle-2/js/loadchart.js.
// Everything below is a synthetic kit assumption, not a
// manufacturer figure.
// ------------------------------------------------------------

export const KIT = Object.freeze({
  PIVOT_OFFSET_M: 0.8,
  OUTRIGGER_LENGTH_M: 8.9,
  OUTRIGGER_SPREAD_X: 7.8,
  OUTRIGGER_SPREAD_Z: 8.9,
  HALF_OUTRIGGER_SPREAD_X: 4.2,

  CARRIER_MASS_T: 45,
  SUPERSTRUCTURE_MASS_T: 35,
  COUNTERWEIGHT_MASS_T: 80,
  BOOM_MASS_T: 10,
  // Machine mass without hook load: 45 + 35 + 80 + 10 = 170 t.
  MACHINE_MASS_T: 45 + 35 + 80 + 10,
  TAIL_RADIUS_M: 3.5,

  PAD_POSITIONS: Object.freeze({
    fl: Object.freeze({ x: -3.9, z: -4.45 }),
    fr: Object.freeze({ x: 3.9, z: -4.45 }),
    rl: Object.freeze({ x: -3.9, z: 4.45 }),
    rr: Object.freeze({ x: 3.9, z: 4.45 }),
  }),

  PAD_ORDER: Object.freeze(['fl', 'fr', 'rl', 'rr']),
  PAD_NEAR_LIFT_T: 5,
  WARN_MARGIN_M: DEFAULT_WARN_MARGIN_M,
});

export const OUTRIGGER_STATES = Object.freeze({
  FULL: 'FULL',
  HALF: 'HALF',
});

const INVALID_OUTRIGGER_STATE = Symbol('INVALID_OUTRIGGER_STATE');
const INACTIVE_OUTRIGGER_STATE = Symbol('INACTIVE_OUTRIGGER_STATE');

const OUTRIGGER_CHARTS = Object.freeze({
  FULL: CHART,
  HALF: null,
});

const isNum = value => Number.isFinite(value);

function outriggerStateFor(sample) {
  if (sample == null || typeof sample !== 'object' || sample.outrigger_state == null) {
    return OUTRIGGER_STATES.FULL;
  }
  if (sample.outrigger_state === OUTRIGGER_STATES.HALF) return OUTRIGGER_STATES.HALF;
  if (sample.outrigger_state === OUTRIGGER_STATES.FULL
    || sample.outrigger_state === 'DEPLOYED') {
    return OUTRIGGER_STATES.FULL;
  }
  if (sample.outrigger_state === 'DEPLOYING'
    || sample.outrigger_state === 'RETRACTED'
    || sample.outrigger_state === 'RETRACTING') {
    return INACTIVE_OUTRIGGER_STATE;
  }
  return INVALID_OUTRIGGER_STATE;
}

function padPositionsFor(state) {
  const halfWidth = state === OUTRIGGER_STATES.HALF
    ? KIT.HALF_OUTRIGGER_SPREAD_X / 2
    : KIT.OUTRIGGER_SPREAD_X / 2;
  const halfDepth = KIT.OUTRIGGER_SPREAD_Z / 2;
  return {
    fl: { x: -halfWidth, z: -halfDepth },
    fr: { x: halfWidth, z: -halfDepth },
    rl: { x: -halfWidth, z: halfDepth },
    rr: { x: halfWidth, z: halfDepth },
  };
}


// ------------------------------------------------------------
// Support polygon
//
// Pads are fixed by the kit, so the polygon is derived from
// PAD_POSITIONS instead of being re-typed per module.
// ------------------------------------------------------------

export function supportPolygon(sample) {
  const state = outriggerStateFor(sample);
  if (state === INVALID_OUTRIGGER_STATE) return [];
  const p = padPositionsFor(state);
  return [
    { x: p.fl.x, z: p.fl.z },
    { x: p.fr.x, z: p.fr.z },
    { x: p.rr.x, z: p.rr.z },
    { x: p.rl.x, z: p.rl.z },
  ];
}


// ------------------------------------------------------------
// Combined centre of gravity of the kit machine + hook load
//
// Returns { x, z, totalT } in the stability frame, or null when
// load / radius / slew are not usable numbers.
// ------------------------------------------------------------

export function kitCombinedCoG(sample) {
  if (sample == null || typeof sample !== 'object') return null;
  const loadT = sample.load_t;
  const radiusM = sample.radius_m;
  const slewDeg = sample.slew_deg;
  if (!isNum(loadT) || !isNum(radiusM) || !isNum(slewDeg)) return null;

  const totalT = KIT.MACHINE_MASS_T + loadT;
  if (totalT <= 0) return null;

  const hook = loadGroundPosition(radiusM, slewDeg);
  const counterweight = loadGroundPosition(KIT.TAIL_RADIUS_M, slewDeg + 180);
  const boom = loadGroundPosition(radiusM / 2, slewDeg);

  return {
    x: (KIT.COUNTERWEIGHT_MASS_T * counterweight.x
      + KIT.BOOM_MASS_T * boom.x
      + loadT * hook.x) / totalT,
    z: (KIT.COUNTERWEIGHT_MASS_T * counterweight.z
      + KIT.BOOM_MASS_T * boom.z
      + loadT * hook.z) / totalT,
    totalT,
  };
}


// ------------------------------------------------------------
// Pad reactions — rigid-body plane formula (kit)
//
//   R_i = W/4 + W·ex·x_i/Σx_j² + W·ez·z_i/Σz_j²
//
// W is the machine mass plus hook load, (ex, ez) is the
// combined CoG above. Pads unload to zero while the outriggers
// are not deployed; a negative reaction is reported as zero
// (tipping / lift-off).
// ------------------------------------------------------------

export function padReactionsFor(sample) {
  const state = outriggerStateFor(sample);
  const deployed = state === OUTRIGGER_STATES.FULL || state === OUTRIGGER_STATES.HALF;

  if (!deployed) {
    return { FL: 0, FR: 0, RL: 0, RR: 0, deployed: false, computed: true };
  }

  const cog = kitCombinedCoG(sample);
  if (cog == null) {
    return { FL: NaN, FR: NaN, RL: NaN, RR: NaN, deployed: true, computed: false };
  }

  const p = padPositionsFor(state);
  const sumX2 = KIT.PAD_ORDER.reduce((sum, key) => sum + p[key].x * p[key].x, 0);
  const sumZ2 = KIT.PAD_ORDER.reduce((sum, key) => sum + p[key].z * p[key].z, 0);
  const W = cog.totalT;

  const raw = {};
  for (const key of KIT.PAD_ORDER) {
    const x = p[key].x;
    const z = p[key].z;
    raw[key] = W / 4 + (W * cog.x * x) / sumX2 + (W * cog.z * z) / sumZ2;
  }

  const clamp = value => (value < 0 ? 0 : value);
  return {
    FL: clamp(raw.fl),
    FR: clamp(raw.fr),
    RL: clamp(raw.rl),
    RR: clamp(raw.rr),
    deployed: true,
    computed: true,
  };
}


// ------------------------------------------------------------
// Load chart lookup for a telemetry sample
//
// capacityT === null means the boom/radius combination is not
// permitted by the chart (or the inputs are not numbers).
// capacityInputsValid separates those two cases: false when the
// inputs themselves are unusable, true when the chart refused.
// ------------------------------------------------------------

export function capacityFor(sample) {
  if (sample == null || typeof sample !== 'object') {
    return {
      capacityT: null,
      capacityInputsValid: false,
      capacityDataAvailable: false,
      utilization: null,
    };
  }

  const boomLengthM = sample.boom_length_m;
  const radiusM = sample.radius_m;
  const loadT = sample.load_t;

  const capacityInputsValid = isNum(boomLengthM) && isNum(radiusM);
  const state = outriggerStateFor(sample);
  const chart = state === INVALID_OUTRIGGER_STATE
    ? null
    : state === INACTIVE_OUTRIGGER_STATE
      ? CHART
      : OUTRIGGER_CHARTS[state];
  const capacityDataAvailable = chart != null;
  const capacityT = capacityInputsValid && capacityDataAvailable
    ? ratedCapacity(chart, boomLengthM, radiusM)
    : null;
  const utilization = capacityT != null && isNum(loadT) && capacityT > 0
    ? loadT / capacityT
    : null;

  return { capacityT, capacityInputsValid, capacityDataAvailable, utilization };
}


// ------------------------------------------------------------
// Support-polygon stability verdict for a telemetry sample
//
// stability: 'ok' | 'warn' | 'tipping' | null
// null = the verdict could not be computed from this sample.
// ------------------------------------------------------------

export function stabilityFor(sample) {
  const polygon = supportPolygon(sample);

  if (sample == null || typeof sample !== 'object') {
    return { stability: null, stabilityInputsValid: false, cog: { x: 0, z: 0 }, polygon };
  }

  const cogResult = kitCombinedCoG(sample);
  const cog = cogResult == null ? { x: 0, z: 0 } : { x: cogResult.x, z: cogResult.z };
  const geometryValid = cogResult != null;
  const state = outriggerStateFor(sample);
  const deployed = state === OUTRIGGER_STATES.FULL || state === OUTRIGGER_STATES.HALF;
  const stateValid = state !== INVALID_OUTRIGGER_STATE;
  const loadT = sample.load_t;
  const working = isNum(loadT) && loadT > 0;

  let stability = 'ok';
  let stabilityInputsValid = true;

  if (!stateValid) {
    stability = null;
    stabilityInputsValid = false;
  } else if (deployed && working && !geometryValid) {
    stability = null;
    stabilityInputsValid = false;
  } else if (deployed && working) {
    stability = stabilityVerdict(cog.x, cog.z, polygon, { warnMarginM: KIT.WARN_MARGIN_M });
  }

  return { stability, stabilityInputsValid, cog, polygon };
}


// ------------------------------------------------------------
// Convenience: every Module 3 number for one sample
// ------------------------------------------------------------

export function craneStateFor(sample) {
  return {
    ...capacityFor(sample),
    ...stabilityFor(sample),
    pads: padReactionsFor(sample),
  };
}
