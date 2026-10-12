import {
  detectFailures,
} from './failureDetector.js';


function showResult(name, telemetry) {
  const result = detectFailures(telemetry);

  console.log(`\n=== ${name} ===`);

  console.log(
    'Timestamp:',
    result.timestamp
  );

  console.log(
    'Status:',
    result.status
  );

  if (result.failures.length === 0) {
    console.log('Failures: none');
  } else {
    result.failures.forEach((failure) => {
      console.log(
        `${failure.type} | ` +
        `time=${failure.timestamp} | ` +
        `trigger=${failure.triggerValue} | ` +
        `${failure.rule}`
      );
    });
  }

  return result;
}


// ------------------------------------------------------------
// 1. NORMAL TELEMETRY
// ------------------------------------------------------------

showResult(
  'NORMAL OPERATION',
  {
    ts: '2026-09-16T08:00:00+05:30',

    load_t: 10,
    boom_length_m: 32,
    boom_angle_deg: 65.64,
    radius_m: 14,
    slew_deg: 0,

    outrigger_state: 'DEPLOYED',

    // R13: deployed reactions must total the 170 t kit plus the 10 t load.
    pad_fl_t: 55,
    pad_fr_t: 29,
    pad_rl_t: 55,
    pad_rr_t: 41,

    hydraulic_pressure_bar: 118,
    wind_kmh: 10,
    lmi_pct: 22.12,
    status_word: 0,
  }
);


// The kit distribution and a large outboard load must still detect tipping.
const tippingResult = detectFailures({
  ts: '2026-09-16T08:00:01+05:30',
  load_t: 100,
  boom_length_m: 38,
  boom_angle_deg: 39.75,
  radius_m: 30,
  slew_deg: 0,
  hook_height_m: 24.30,
  outrigger_state: 'DEPLOYED',
  pad_fl_t: 70,
  pad_fr_t: 65,
  pad_rl_t: 65,
  pad_rr_t: 70,
  hydraulic_pressure_bar: 420,
  wind_kmh: 10,
  lmi_pct: 100,
  status_word: 0,
});
if (!tippingResult.failures.some(failure => failure.type === 'STABILITY_LOSS')) {
  throw new Error('A genuinely tipping synthetic sample must retain STABILITY_LOSS detection');
}


// ------------------------------------------------------------
// 2. OVERLOAD
// ------------------------------------------------------------

showResult(
  'OVERLOAD',
  {
    ts: '2026-09-16T09:00:00+05:30',

    load_t: 52,
    boom_length_m: 38,
    boom_angle_deg: 72.86,
    radius_m: 12,
    slew_deg: 35,

    outrigger_state: 'DEPLOYED',

    pad_fl_t: 21.27,
    pad_fr_t: 63.70,
    pad_rl_t: 47.30,
    pad_rr_t: 89.73,

    hydraulic_pressure_bar: 257.4,
    wind_kmh: 10,
    lmi_pct: 109.47,
    status_word: 0,
  }
);


// ------------------------------------------------------------
// 3. IMPROPER OUTRIGGER DEPLOYMENT
// ------------------------------------------------------------

showResult(
  'IMPROPER OUTRIGGER DEPLOYMENT',
  {
    ts: '2026-09-16T12:40:00+05:30',

    load_t: 0,
    boom_length_m: 32,
    boom_angle_deg: 65.64,
    radius_m: 14,
    slew_deg: 0,

    outrigger_state: 'RETRACTED',

    pad_fl_t: 0,
    pad_fr_t: 0,
    pad_rl_t: 0,
    pad_rr_t: 0,

    hydraulic_pressure_bar: 36,
  }
);


// ------------------------------------------------------------
// 4. HYDRAULIC PRESSURE LOSS
//
// Values based on the supplied telemetry around 11:04.
// Expected pressure = 276 bar.
// Recorded pressure has fallen to about 138 bar.
// ------------------------------------------------------------

showResult(
  'HYDRAULIC PRESSURE LOSS',
  {
    ts: '2026-09-16T11:04:00+05:30',

    load_t: 30,
    boom_length_m: 50,
    boom_angle_deg: 64.91,
    radius_m: 22,
    slew_deg: 80,

    outrigger_state: 'DEPLOYED',

    pad_fl_t: 17.44,
    pad_fr_t: 28.34,
    pad_rl_t: 71.66,
    pad_rr_t: 82.56,

    hydraulic_pressure_bar: 138.0,
  }
);


// ------------------------------------------------------------
// 5. OUTRIGGER LIFT-OFF
// ------------------------------------------------------------

const liftOffResult = showResult(
  'OUTRIGGER LIFT-OFF',
  {
    ts: '2026-09-16T15:30:01+05:30',

    load_t: 10,
    boom_length_m: 32,
    boom_angle_deg: 65.64,
    radius_m: 14,
    slew_deg: 0,

    outrigger_state: 'DEPLOYED',

    // Valid R13 total: 0 + 60 + 60 + 60 = 170 t + 10 t load.
    pad_fl_t: 0,
    pad_fr_t: 60,
    pad_rl_t: 60,
    pad_rr_t: 60,

    hydraulic_pressure_bar: 118,
    wind_kmh: 10,
    lmi_pct: 22.12,
    status_word: 0,
  }
);
if (!liftOffResult.failures.some(failure => failure.type === 'OUTRIGGER_LIFT_OFF')) {
  throw new Error('A valid zero-reaction pad sample must retain OUTRIGGER_LIFT_OFF detection');
}