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
//   pads at (±3.9, ±4.475) m, rigid-body plane reactions
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
  OUTRIGGER_SPREAD_Z: 8.95,

  CARRIER_MASS_T: 45,
  SUPERSTRUCTURE_MASS_T: 35,
  COUNTERWEIGHT_MASS_T: 80,
  BOOM_MASS_T: 10,
  // Machine mass without hook load: 45 + 35 + 80 + 10 = 170 t.
  MACHINE_MASS_T: 45 + 35 + 80 + 10,
  TAIL_RADIUS_M: 3.5,

  PAD_POSITIONS: Object.freeze({
    fl: Object.freeze({ x: -3.9, z: -4.475 }),
    fr: Object.freeze({ x: 3.9, z: -4.475 }),
    rl: Object.freeze({ x: -3.9, z: 4.475 }),
    rr: Object.freeze({ x: 3.9, z: 4.475 }),
  }),

  PAD_ORDER: Object.freeze(['fl', 'fr', 'rl', 'rr']),
  // TEAM rule requested by the Cycle 3 mentor: a finite deployed-pad
  // reaction at or below this value is classified as critical lift-off.
  PAD_LIFT_OFF_T: 0.1,
  PAD_NEAR_LIFT_T: 5,
  WARN_MARGIN_M: DEFAULT_WARN_MARGIN_M,

  // The recording documents bits 0-3 only as a coarse motion group.  These
  // one-to-one mappings are provisional TEAM assumptions for data-quality
  // monitoring, not manufacturer specifications.
  FROZEN_SENSOR_MAPPINGS: Object.freeze([
    Object.freeze({ field: 'boom_length_m', bit: 1 }),
    Object.freeze({ field: 'boom_angle_deg', bit: 2 }),
    Object.freeze({ field: 'slew_deg', bit: 3 }),
  ]),
  // TEAM noise/duration choice pending an authoritative sensor mapping.
  FROZEN_SENSOR_DURATION_S: 10,
});

export const SAFETY_LIMITS = Object.freeze({
  hookMinM: 6,
  hookTolM: 0.5,
  radiusTolM: 0.1,
  padSumTolT: 2,
  angleMinDeg: 0,
  angleMaxDeg: 85,
  telescopeMps: 0.3,
  luffDps: 2,
  slewDps: 3,
});

export const expectedHookHeightM = (lengthM, angleDeg) =>
  Math.max(SAFETY_LIMITS.hookMinM, lengthM * Math.sin((angleDeg * Math.PI) / 180));

export const statusBitSet = (statusWord, bit) =>
  Number.isFinite(statusWord) && Number.isInteger(bit) && bit >= 0
  && (statusWord & (1 << bit)) !== 0;

const isNum = value => Number.isFinite(value);


// ------------------------------------------------------------
// Support polygon
//
// Pads are fixed by the kit, so the polygon is derived from
// PAD_POSITIONS instead of being re-typed per module.
// ------------------------------------------------------------

export function supportPolygon() {
  const p = KIT.PAD_POSITIONS;
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
  const deployed = sample != null && typeof sample === 'object'
    && sample.outrigger_state === 'DEPLOYED';

  if (!deployed) {
    return { FL: 0, FR: 0, RL: 0, RR: 0, deployed: false, computed: true };
  }

  const cog = kitCombinedCoG(sample);
  if (cog == null) {
    return { FL: NaN, FR: NaN, RL: NaN, RR: NaN, deployed: true, computed: false };
  }

  const p = KIT.PAD_POSITIONS;
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
    return { capacityT: null, capacityInputsValid: false, utilization: null };
  }

  const boomLengthM = sample.boom_length_m;
  const radiusM = sample.radius_m;
  const loadT = sample.load_t;

  const capacityInputsValid = isNum(boomLengthM) && isNum(radiusM);
  const capacityT = capacityInputsValid
    ? ratedCapacity(CHART, boomLengthM, radiusM)
    : null;
  const utilization = capacityT != null && isNum(loadT) && capacityT > 0
    ? loadT / capacityT
    : null;

  return { capacityT, capacityInputsValid, utilization };
}


// ------------------------------------------------------------
// Support-polygon stability verdict for a telemetry sample
//
// stability: 'ok' | 'warn' | 'tipping' | null
// null = the verdict could not be computed from this sample.
// ------------------------------------------------------------

export function stabilityFor(sample) {
  const polygon = supportPolygon();

  if (sample == null || typeof sample !== 'object') {
    return { stability: null, stabilityInputsValid: false, cog: { x: 0, z: 0 }, polygon };
  }

  const cogResult = kitCombinedCoG(sample);
  const cog = cogResult == null ? { x: 0, z: 0 } : { x: cogResult.x, z: cogResult.z };
  const geometryValid = cogResult != null;
  const deployed = sample.outrigger_state === 'DEPLOYED';
  const loadT = sample.load_t;
  const working = isNum(loadT) && loadT > 0;

  let stability = 'ok';
  let stabilityInputsValid = true;

  if (deployed && working && !geometryValid) {
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
