// Module 3 is the single source of truth for chart, kit, and stability math.
import {
  KIT,
  SAFETY_LIMITS,
  expectedHookHeightM,
  statusBitSet,
  capacityFor,
  stabilityFor,
  radiusFromAngle,
  padReactionsFor,
} from './craneModel.js';

// Pad thresholds come from KIT (craneModel.js) to stay DRY.
// PAD_LIFT_OFF_T (0.1 t): mentor-requested critical boundary. A finite pad at or below
// this value is OUTRIGGER_LIFT_OFF (critical). [TEAM]
// PAD_NEAR_LIFT_T (5 t): existing near-lift-off watch level. A finite pad above PAD_LIFT_OFF_T
// but below this value is OUTRIGGER_NEAR_LIFT_OFF (warning). [TEAM/KIT]
// A non-finite deployed pad is a data-quality issue (invalidPads), not confirmed lift-off.
const PAD_LIFT_OFF_T = KIT.PAD_LIFT_OFF_T;
const PAD_NEAR_LIFT_T = KIT.PAD_NEAR_LIFT_T;
const PAD_SUM_TOLERANCE = 3;


const finite = value => Number.isFinite(value);
const bitNumberSet = (word, bit) => statusBitSet(word, bit);
const validTimestamp = ts =>
  typeof ts === 'string' && ts.trim() !== '' && Number.isFinite(Date.parse(ts));

function alarm(type, timestamp, triggerValue, limit, rule) {
  return { type, timestamp, triggerValue, limit, rule };
}

function signedAngleDelta(current, previous) {
  let delta = current - previous;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return Math.abs(delta);
}

function validPreviousTelemetryForRates(telemetry) {
  if (!telemetry || !validTimestamp(telemetry.ts)) return false;

  const {
    load_t: loadT,
    boom_length_m: boomLengthM,
    boom_angle_deg: boomAngleDeg,
    radius_m: radiusM,
    slew_deg: slewDeg,
  } = telemetry;

  if (![loadT, boomLengthM, boomAngleDeg, radiusM, slewDeg].every(finite)) return false;
  if (loadT < 0 || boomAngleDeg < SAFETY_LIMITS.angleMinDeg || boomAngleDeg > SAFETY_LIMITS.angleMaxDeg) return false;

  const expectedRadius = radiusFromAngle(boomLengthM, boomAngleDeg, KIT.PIVOT_OFFSET_M);
  if (Math.abs(radiusM - expectedRadius) > 1) return false;

  if (finite(telemetry.hook_height_m)) {
    const expectedHeight = expectedHookHeightM(boomLengthM, boomAngleDeg);
    if (Math.abs(telemetry.hook_height_m - expectedHeight) > SAFETY_LIMITS.hookTolM) return false;
  }

  if (telemetry.outrigger_state === 'DEPLOYED') {
    const pads = [telemetry.pad_fl_t, telemetry.pad_fr_t, telemetry.pad_rl_t, telemetry.pad_rr_t];
    if (pads.some(value => !finite(value))) return false;
    if (Math.abs(pads.reduce((sum, value) => sum + value, 0) - (KIT.MACHINE_MASS_T + loadT)) > PAD_SUM_TOLERANCE) {
      return false;
    }
  }

  return true;
}

function validationErrors(telemetry, previousTelemetry) {
  const errors = [];
  const {
    load_t: loadT,
    boom_length_m: boomLengthM,
    boom_angle_deg: boomAngleDeg,
    radius_m: radiusM,
    slew_deg: slewDeg,
    hook_height_m: hookHeightM,
    hydraulic_pressure_bar: pressure,
    wind_kmh: wind,
    lmi_pct: lmi,
    outrigger_state: outriggerState,
  } = telemetry;

  if (!finite(loadT)) errors.push('load_t must be finite');
  if (!finite(boomLengthM)) errors.push('boom_length_m must be finite');
  if (!finite(boomAngleDeg)) errors.push('boom_angle_deg must be finite');
  if (!finite(radiusM)) errors.push('radius_m must be finite');
  if (!finite(slewDeg)) errors.push('slew_deg must be finite');
  // CSV blanks are represented as NaN by the playback parser.  They are
  // missing optional device readings, not corrupt numeric values.
  if (pressure !== undefined && pressure !== null && !Number.isNaN(pressure) && !finite(pressure)) {
    errors.push('hydraulic_pressure_bar must be finite');
  }
  if (wind !== undefined && wind !== null && !Number.isNaN(wind) && !finite(wind)) {
    errors.push('wind_kmh must be finite');
  }
  if (lmi !== undefined && lmi !== null && !Number.isNaN(lmi) && !finite(lmi)) {
    errors.push('lmi_pct must be finite');
  }

  if (finite(loadT) && loadT < 0) errors.push('negative load is impossible');
  if (finite(boomAngleDeg) && (boomAngleDeg < SAFETY_LIMITS.angleMinDeg || boomAngleDeg > SAFETY_LIMITS.angleMaxDeg)) {
    errors.push(`boom angle must be between ${SAFETY_LIMITS.angleMinDeg} and ${SAFETY_LIMITS.angleMaxDeg} degrees`);
  }

  if (finite(boomLengthM) && finite(boomAngleDeg) && finite(radiusM)) {
    const expectedRadius = radiusFromAngle(boomLengthM, boomAngleDeg, KIT.PIVOT_OFFSET_M);
    if (Math.abs(radiusM - expectedRadius) > 1) {
      errors.push(`radius ${radiusM} m is inconsistent with boom geometry (${expectedRadius.toFixed(2)} m)`);
    }
  }
  if (finite(boomLengthM) && finite(boomAngleDeg) && finite(hookHeightM)) {
    const expectedHeight = expectedHookHeightM(boomLengthM, boomAngleDeg);
    if (Math.abs(hookHeightM - expectedHeight) > SAFETY_LIMITS.hookTolM) {
      errors.push(`hook height ${hookHeightM} m is inconsistent with boom geometry (${expectedHeight.toFixed(2)} m)`);
    }
  }

  if (validPreviousTelemetryForRates(previousTelemetry) && validTimestamp(telemetry.ts)) {
    const seconds = (Date.parse(telemetry.ts) - Date.parse(previousTelemetry.ts)) / 1000;
    if (seconds > 0 && seconds <= 10) {
      if (finite(previousTelemetry.boom_length_m) && finite(boomLengthM) &&
          Math.abs(boomLengthM - previousTelemetry.boom_length_m) / seconds > SAFETY_LIMITS.telescopeMps) {
        errors.push(`boom telescope rate exceeds ${SAFETY_LIMITS.telescopeMps} m/s`);
      }
      if (finite(previousTelemetry.boom_angle_deg) && finite(boomAngleDeg) &&
          Math.abs(boomAngleDeg - previousTelemetry.boom_angle_deg) / seconds > 2) {
        errors.push(`luff rate exceeds ${SAFETY_LIMITS.luffDps} degrees/s`);
      }
      if (finite(previousTelemetry.slew_deg) && finite(slewDeg) &&
          signedAngleDelta(slewDeg, previousTelemetry.slew_deg) / seconds > 3) {
        errors.push(`slew rate exceeds ${SAFETY_LIMITS.slewDps} degrees/s`);
      }
    }
  }

  const pads = [telemetry.pad_fl_t, telemetry.pad_fr_t, telemetry.pad_rl_t, telemetry.pad_rr_t];
  if (outriggerState === 'DEPLOYED') {
    if (pads.some(value => !finite(value))) errors.push('deployed pad reactions must be finite');
    else if (finite(loadT) && loadT >= 0 &&
      Math.abs(
        pads.reduce((sum, value) => sum + value, 0) -
        (KIT.MACHINE_MASS_T + loadT)
      ) > PAD_SUM_TOLERANCE) {
      errors.push('deployed pad reactions do not balance the 170 t kit plus load');
    }
  }
  return errors;
}

export function expectedHydraulicPressure(loadT, radiusM, boomLengthM) {
  if (!finite(loadT) || !finite(radiusM) || !finite(boomLengthM)) return null;
  return 20 + 0.35 * loadT * radiusM + 0.5 * boomLengthM;
}

export function calculateFailureInputs(telemetry) {
  if (telemetry == null || typeof telemetry !== 'object') {
    throw new TypeError('calculateFailureInputs: telemetry must be an object');
  }
  const loadT = telemetry.load_t;
  const boomLengthM = telemetry.boom_length_m;
  const radiusM = telemetry.radius_m;
  const capacityState = capacityFor(telemetry);
  const capacityInputsValid = capacityState.capacityInputsValid;
  const capacityT = capacityState.capacityT;
  const pads = {
    FL: telemetry.pad_fl_t,
    FR: telemetry.pad_fr_t,
    RL: telemetry.pad_rl_t,
    RR: telemetry.pad_rr_t,
  };
  const deployed = telemetry.outrigger_state === 'DEPLOYED';
  const padEntries = Object.entries(pads);
  // liftedPads: finite pad at or below the critical threshold (0.1 t).
  // Includes zero and negative reactions. Non-finite reactions are invalidPads (data quality),
  // not OUTRIGGER_LIFT_OFF — missing sensor data is not proof of physical lift-off. [TEAM]
  const liftedPads = deployed
    ? padEntries.filter(([, value]) => finite(value) && value <= PAD_LIFT_OFF_T).map(([name]) => name)
    : [];
  // nearLiftedPads: finite pad above the critical threshold but below the 5 t watch level.
  const nearLiftedPads = deployed
    ? padEntries.filter(([name, value]) => finite(value) && value > PAD_LIFT_OFF_T && value < PAD_NEAR_LIFT_T &&
      !liftedPads.includes(name)).map(([name]) => name)
    : [];
  const invalidPads = deployed ? padEntries.filter(([, value]) => !finite(value)).map(([name]) => name) : [];

  const stabilityState = stabilityFor(telemetry);

  return {
    capacityT,
    capacityInputsValid,
    utilization: capacityState.utilization,
    stability: stabilityState.stability,
    stabilityInputsValid: stabilityState.stabilityInputsValid,
    cog: stabilityState.cog,
    modeledPads: padReactionsFor(telemetry),
    pads,
    liftedPads,
    nearLiftedPads,
    invalidPads,
    expectedHydraulicPressure: expectedHydraulicPressure(loadT, radiusM, boomLengthM),
  };
}

export function detectFailures(telemetry, previousTelemetry = null) {
  if (telemetry == null || typeof telemetry !== 'object') {
    return {
      timestamp: null, status: 'INVALID_TELEMETRY', failures: [],
      errors: ['telemetry must be a non-null object'], telemetry: null, derived: null,
    };
  }
  const ts = telemetry.ts;
  const timestampOk = validTimestamp(ts);
  const errors = timestampOk ? validationErrors(telemetry, previousTelemetry) : ['telemetry timestamp must be a valid timestamp'];
  const derived = calculateFailureInputs(telemetry);
  const failures = [];
  const add = (type, triggerValue, limit, rule) => {
    if (timestampOk) failures.push(alarm(type, ts, triggerValue, limit, rule));
  };

  if (!timestampOk) {
    return {
      timestamp: null, status: 'INVALID_TELEMETRY', errors, failures: [],
      telemetry: { ...telemetry }, derived,
    };
  }
  if (errors.length > 0) {
    add('DATA_QUALITY', errors.join('; '), 'valid telemetry', 'R9/R10/R11/R13 telemetry validation failed');
    return {
      timestamp: ts, status: 'INVALID_TELEMETRY', errors, failures,
      telemetry: { ...telemetry }, derived,
    };
  }

  const loadT = telemetry.load_t;
  const statusWord = telemetry.status_word;
  const motionActive = [0, 1, 2, 3].some(bit => bitNumberSet(statusWord, bit));
  if ((motionActive || (finite(loadT) && loadT > 0)) && telemetry.outrigger_state !== 'DEPLOYED') {
    add('IMPROPER_OUTRIGGER_DEPLOYMENT', telemetry.outrigger_state, 'DEPLOYED when moving or carrying load',
      `motion bits 0-3 active (${statusWord}) or load ${loadT} t while outriggers are not DEPLOYED`);
  }
  if (derived.capacityInputsValid && derived.capacityT === null && finite(loadT) && loadT > 0) {
    add('NOT_PERMITTED', loadT, 'valid rated capacity', 'valid chart inputs select a null/not-permitted load-chart cell');
  }
  if (derived.capacityT != null && finite(loadT) && loadT > derived.capacityT) {
    add('OVERLOAD', loadT, derived.capacityT, `load ${loadT} t exceeds rated capacity ${derived.capacityT.toFixed(2)} t`);
  }
  if (derived.liftedPads.length > 0) {
    add('OUTRIGGER_LIFT_OFF', derived.liftedPads.join(', '),
      `> ${PAD_LIFT_OFF_T} t reaction on every deployed pad`,
      `recorded pad reaction is at or below ${PAD_LIFT_OFF_T} t (critical lift-off threshold) on ${derived.liftedPads.join(', ')}`);
  } else if (derived.nearLiftedPads.length > 0) {
    add('OUTRIGGER_NEAR_LIFT_OFF', derived.nearLiftedPads.join(', '),
      `>= ${PAD_NEAR_LIFT_T} t reaction`,
      `recorded pad reaction is above ${PAD_LIFT_OFF_T} t but below ${PAD_NEAR_LIFT_T} t on ${derived.nearLiftedPads.join(', ')}`);
  }
  if (telemetry.outrigger_state === 'DEPLOYED' && derived.stability === 'tipping') {
    add('STABILITY_LOSS', derived.stability, 'ok/warn', 'kit combined centre of gravity is outside the outrigger support polygon');
  }
  const expected = derived.expectedHydraulicPressure;
  if (finite(telemetry.hydraulic_pressure_bar) && finite(expected) && telemetry.hydraulic_pressure_bar < expected * 0.95) {
    add('HYDRAULIC_PRESSURE_LOSS', telemetry.hydraulic_pressure_bar, expected * 0.95,
      `recorded pressure ${telemetry.hydraulic_pressure_bar} bar is below 95% of expected pressure ${expected.toFixed(1)} bar`);
  }

  if (derived.capacityT != null && finite(loadT) && finite(telemetry.lmi_pct)) {
    const computedPct = derived.utilization * 100;
    if (Math.abs(computedPct - telemetry.lmi_pct) > 2) {
      add('LMI_DIVERGENCE', telemetry.lmi_pct, computedPct, `device LMI differs from computed utilization by more than 2 percentage points`);
    }
  } else if ((derived.capacityT != null && finite(loadT)) !== finite(telemetry.lmi_pct)) {
    add('LMI_DIVERGENCE', telemetry.lmi_pct ?? null, 'both computed utilization and lmi_pct present', 'exactly one LMI input is missing');
  }
  if (finite(telemetry.wind_kmh) && telemetry.wind_kmh > 36) {
    add('WIND_ALERT', telemetry.wind_kmh, 36, 'wind speed exceeds 36 km/h');
  }
  if (bitNumberSet(statusWord, 12)) add('LMI_BYPASS', statusWord, 'status bit 12 clear', 'status_word bit 12 reports LMI bypass');
  if ((finite(derived.utilization) && derived.utilization >= 0.9 && derived.utilization < 1) ||
      bitNumberSet(statusWord, 8)) {
    add('LMI_PREWARNING', finite(derived.utilization) ? derived.utilization * 100 : statusWord, 90,
      'computed utilization is 90-100% or status bit 8 reports LMI pre-warning');
  }
  if (bitNumberSet(statusWord, 7) && !failures.some(failure => failure.type === 'OVERLOAD')) {
    add('DEVICE_OVERLOAD', statusWord, 'status bit 7 clear', 'status_word bit 7 reports device overload');
  }
  if (bitNumberSet(statusWord, 9)) add('A2B_ALERT', statusWord, 'status bit 9 clear', 'status_word bit 9 reports anti-two-block condition');

  return {
    timestamp: ts,
    status: failures.length === 0 ? 'NORMAL' : 'FAILURE_DETECTED',
    errors, failures,
    telemetry: {
      loadT, boomLengthM: telemetry.boom_length_m, boomAngleDeg: telemetry.boom_angle_deg,
      radiusM: telemetry.radius_m, slewDeg: telemetry.slew_deg,
      outriggerState: telemetry.outrigger_state,
      hydraulicPressureBar: telemetry.hydraulic_pressure_bar,
    },
    derived,
  };
}
