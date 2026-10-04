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

  const capacityT = ratedCapacity(
    CHART,
    boomLengthM,
    radiusM
  );


  // ----------------------------------------------------------
  // Stability calculation
  //
  // Only perform the physical support-polygon check when
  // outriggers are fully deployed and there is an actual load.
  // ----------------------------------------------------------

  let stability = 'ok';
  let cog = { x: 0, z: 0 };


  if (
    outriggerState === 'DEPLOYED' &&
    Number.isFinite(loadT) &&
    loadT > 0
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


  return {

    capacityT,

    utilization:
      capacityT == null
        ? null
        : loadT / capacityT,

    stability,

    cog,

    pads,

    liftedPads,

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


  // ----------------------------------------------------------
  // 1. OVERLOAD
  // ----------------------------------------------------------

  if (
    derived.capacityT != null &&
    Number.isFinite(loadT) &&
    loadT > derived.capacityT
  ) {

    failures.push({

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

    failures.push({

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

  if (
    derived.liftedPads.length > 0
  ) {

    failures.push({

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


  // ----------------------------------------------------------
  // 4. GEOMETRIC STABILITY LOSS
  //
  // Only evaluated while deployed and carrying a load.
  // ----------------------------------------------------------

  if (
    outriggerState === 'DEPLOYED' &&
    loadT > 0 &&
    derived.stability === 'tipping'
  ) {

    failures.push({

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
    hydraulicPressureBar <
      hydraulicLossThreshold
  ) {

    failures.push({

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
      failures.length === 0
        ? 'NORMAL'
        : 'FAILURE_DETECTED',

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