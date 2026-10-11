// ============================================================
// Cycle 3 - Mobile Crane Digital Twin
// Module 2 - Failure Detector
//
// Module Owner: Rushikesh
//
// Detects:
//   1. Overload
//   2. Outrigger lift-off / stability loss
//   3. Hydraulic pressure loss
//   4. Improper outrigger deployment
//
// Uses Cycle 2 load-chart and stability modules as the
// single source of truth.
// ============================================================

import {
  CHART,
  ratedCapacity,
} from '../../Cycle-2/js/loadchart.js';

import {
  stabilityVerdict,
  loadGroundPosition,
  outriggerPolygonForSpread,
  combinedCoG,
} from '../../Cycle-2/js/stability.js';


// ------------------------------------------------------------
// Crane configuration
// ------------------------------------------------------------

const OUTRIGGER_SPREAD_X = 8.95;
const OUTRIGGER_SPREAD_Z = 7.8;

const MACHINE_MASS_T = 72;
const MACHINE_X = 0;
const MACHINE_Z = 0;

const WARN_MARGIN_M = 1.5;


// ------------------------------------------------------------
// Hydraulic pressure model
// ------------------------------------------------------------

export function expectedHydraulicPressure(
  loadT,
  radiusM,
  boomLengthM
) {
  return (
    20 +
    0.35 * loadT * radiusM +
    0.5 * boomLengthM
  );
}


// ------------------------------------------------------------
// Calculate derived values
// ------------------------------------------------------------

export function calculateFailureInputs(telemetry) {

  if (telemetry == null || typeof telemetry !== 'object') {
    throw new TypeError('calculateFailureInputs: telemetry must be an object');
  }

  const {
    load_t: loadT,
    boom_length_m: boomLengthM,
    boom_angle_deg: boomAngleDeg,
    radius_m: radiusM,
    slew_deg: slewDeg,
    outrigger_state: outriggerState,

    pad_fl_t: padFL,
    pad_fr_t: padFR,
    pad_rl_t: padRL,
    pad_rr_t: padRR,
  } = telemetry;


  // ----------------------------------------------------------
  // Rated capacity from Cycle 2 load chart
  // ----------------------------------------------------------

  const capacityT =
    Number.isFinite(boomLengthM) && Number.isFinite(radiusM)
      ? ratedCapacity(CHART, boomLengthM, radiusM)
      : null;


  // ----------------------------------------------------------
  // Stability calculation
  //
  // Only perform the physical support-polygon check when
  // outriggers are fully deployed and there is an actual load.
  // ----------------------------------------------------------

  let stability = 'ok';
  let cog = { x: 0, z: 0 };
  let stabilityInputsValid = true;

  if (
    outriggerState === 'DEPLOYED' &&
    Number.isFinite(loadT) &&
    loadT > 0 &&
    Number.isFinite(radiusM) &&
    Number.isFinite(slewDeg)
  ) {

    const polygon =
      outriggerPolygonForSpread(
        OUTRIGGER_SPREAD_X,
        OUTRIGGER_SPREAD_Z
      );


    const position =
      loadGroundPosition(
        radiusM,
        slewDeg
      );


    cog =
      combinedCoG(
        MACHINE_X,
        MACHINE_Z,
        MACHINE_MASS_T,
        position.x,
        position.z,
        loadT
      );

    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.z) ||
      !Number.isFinite(cog.x) ||
      !Number.isFinite(cog.z)
    ) {
      stability = null;
      stabilityInputsValid = false;
    } else {
      stability =
        stabilityVerdict(
          cog.x,
          cog.z,
          polygon,
          {
            warnMarginM: WARN_MARGIN_M,
          }
        );
    }
  } else if (
    outriggerState === 'DEPLOYED' &&
    Number.isFinite(loadT) &&
    loadT > 0
  ) {
    stability = null;
    stabilityInputsValid = false;
  }


  // ----------------------------------------------------------
  // Pad reactions
  //
  // Only check lift-off when the crane is fully DEPLOYED.
  // DEPLOYING / RETRACTING / RETRACTED states are not treated
  // as lift-off faults.
  // ----------------------------------------------------------

  const pads = {
    FL: padFL,
    FR: padFR,
    RL: padRL,
    RR: padRR,
  };


  const deployed =
    outriggerState === 'DEPLOYED';


  const liftedPads =
    deployed
      ? Object.entries(pads)
          .filter(
            ([, value]) =>
              Number.isFinite(value) &&
              value <= 0
          )
          .map(([name]) => name)
      : [];

  const invalidPads =
    deployed
      ? Object.entries(pads)
          .filter(([, value]) => !Number.isFinite(value))
          .map(([name]) => name)
      : [];


  return {

    capacityT,

    utilization:
      capacityT == null || !Number.isFinite(loadT)
        ? null
        : loadT / capacityT,

    stability,
    stabilityInputsValid,
    cog,
    pads,
    liftedPads,
    invalidPads,

    expectedHydraulicPressure:
      expectedHydraulicPressure(
        loadT,
        radiusM,
        boomLengthM
      ),
  };
}


// ------------------------------------------------------------
// Detect failures for ONE telemetry sample
// ------------------------------------------------------------

export function detectFailures(telemetry) {

  if (telemetry == null || typeof telemetry !== 'object') {
    return {
      timestamp: null,
      status: 'INVALID_TELEMETRY',
      failures: [],
      errors: ['telemetry must be a non-null object'],
      telemetry: null,
      derived: null,
    };
  }

  const {
    ts,
    load_t: loadT,
    boom_length_m: boomLengthM,
    boom_angle_deg: boomAngleDeg,
    radius_m: radiusM,
    slew_deg: slewDeg,
    outrigger_state: outriggerState,
    hydraulic_pressure_bar: hydraulicPressureBar,
  } = telemetry;


  const derived =
    calculateFailureInputs(telemetry);

  const failures = [];
  const errors = [];
  const validTimestamp =
    typeof ts === 'string' &&
    ts.trim() !== '' &&
    Number.isFinite(Date.parse(ts));

  if (!validTimestamp) {
    errors.push('telemetry timestamp must be a valid timestamp');
  }

  const addFailure = (failure) => {
    if (validTimestamp) failures.push(failure);
  };

  if (
    Number.isNaN(derived.capacityT) ||
    !Number.isFinite(boomLengthM) ||
    !Number.isFinite(radiusM)
  ) {
    addFailure({
      type: 'DATA_QUALITY',
      timestamp: ts,
      triggerValue: 'boom_length_m/radius_m',
      limit: 'finite boom length and radius',
      rule: 'load-chart inputs are missing or non-finite',
    });
  }

  if (
    outriggerState === 'DEPLOYED' &&
    Number.isFinite(loadT) &&
    loadT > 0 &&
    !derived.stabilityInputsValid
  ) {
    addFailure({
      type: 'DATA_QUALITY',
      timestamp: ts,
      triggerValue: 'radius_m/slew_deg/geometry',
      limit: 'finite stability geometry',
      rule: 'stability geometry is missing or non-finite',
    });
  }


  // ----------------------------------------------------------
  // 1. OVERLOAD
  // ----------------------------------------------------------

  if (
    derived.capacityT != null &&
    Number.isFinite(loadT) &&
    loadT > derived.capacityT
  ) {

    addFailure({

      type: 'OVERLOAD',

      timestamp: ts,

      triggerValue: loadT,

      limit: derived.capacityT,

      rule:
        `load ${loadT} t exceeds rated capacity ` +
        `${derived.capacityT.toFixed(2)} t`,
    });
  }


  // ----------------------------------------------------------
  // 2. IMPROPER OUTRIGGER DEPLOYMENT
  //
  // DEPLOYING and RETRACTING are transition states.
  // RETRACTED means the required deployed state is absent.
  // ----------------------------------------------------------

  if (
    outriggerState === 'RETRACTED'
  ) {

    addFailure({

      type: 'IMPROPER_OUTRIGGER_DEPLOYMENT',

      timestamp: ts,

      triggerValue: outriggerState,

      limit: 'DEPLOYED',

      rule:
        `outrigger state is ${outriggerState}; ` +
        `required state is DEPLOYED`,
    });
  }


  // ----------------------------------------------------------
  // 3. OUTRIGGER LIFT-OFF
  // ----------------------------------------------------------

  if (derived.liftedPads.length > 0) {

    addFailure({

      type: 'OUTRIGGER_LIFT_OFF',

      timestamp: ts,

      triggerValue:
        derived.liftedPads.join(', '),

      limit:
        '> 0 t reaction on every deployed pad',

      rule:
        `pad reaction is zero/non-positive on ` +
        `${derived.liftedPads.join(', ')}`,
    });
  }

  if (derived.invalidPads.length > 0) {
    addFailure({
      type: 'DATA_QUALITY',
      timestamp: ts,
      triggerValue: derived.invalidPads.join(', '),
      limit: 'finite pad reaction on every deployed pad',
      rule:
        `missing or non-finite pad reaction on ` +
        `${derived.invalidPads.join(', ')}`,
    });
  }


  // ----------------------------------------------------------
  // 4. GEOMETRIC STABILITY LOSS
  //
  // Only evaluated while deployed and carrying a load.
  // ----------------------------------------------------------

  if (
    outriggerState === 'DEPLOYED' &&
    loadT > 0 &&
    derived.stabilityInputsValid &&
    derived.stability === 'tipping'
  ) {

    addFailure({

      type: 'STABILITY_LOSS',

      timestamp: ts,

      triggerValue:
        derived.stability,

      limit:
        'ok/warn',

      rule:
        'combined centre of gravity is outside the ' +
        'outrigger support polygon',
    });
  }


  // ----------------------------------------------------------
  // 5. HYDRAULIC PRESSURE LOSS
  // ----------------------------------------------------------

  const expectedPressure =
    derived.expectedHydraulicPressure;

  const hydraulicLossThreshold =
    expectedPressure * 0.95;


  if (
    Number.isFinite(hydraulicPressureBar) &&
    Number.isFinite(expectedPressure) &&
    hydraulicPressureBar <
      hydraulicLossThreshold
  ) {

    addFailure({

      type: 'HYDRAULIC_PRESSURE_LOSS',

      timestamp: ts,

      triggerValue:
        hydraulicPressureBar,

      limit:
        hydraulicLossThreshold,

      rule:
        `recorded pressure ${hydraulicPressureBar} bar ` +
        `is below 95% of expected pressure ` +
        `${expectedPressure.toFixed(1)} bar`,
    });
  }


  return {

    timestamp: ts,

    status:
      !validTimestamp
        ? 'INVALID_TELEMETRY'
        : failures.length === 0
          ? 'NORMAL'
          : 'FAILURE_DETECTED',

    errors,
    failures,

    telemetry: {
      loadT,
      boomLengthM,
      boomAngleDeg,
      radiusM,
      slewDeg,
      outriggerState,
      hydraulicPressureBar,
    },

    derived,
  };
}