// ============================================================
// Cycle 3 - Telemetry Recording Test
// Module 2 - Failure Detector
//
// Reads the actual mentor telemetry recording and runs the
// Failure Detector against every telemetry sample.
//
// This is NOT a replacement for failureDetector.js.
// It is a validation/test runner for the real recording.
// ============================================================

import fs from 'fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { detectFailures } from './failureDetector.js';


// ------------------------------------------------------------
// Telemetry file supplied by the mentor
// ------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '../data/mobile-telemetry-2026-09-16.csv');


// ------------------------------------------------------------
// Read CSV
// ------------------------------------------------------------

const csv = fs.readFileSync(CSV_PATH, 'utf8').trim();

const lines = csv.split(/\r?\n/);

const headers = lines[0].split(',');


// ------------------------------------------------------------
// Convert CSV rows into telemetry objects
// ------------------------------------------------------------

function parseNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : NaN;
}


const telemetryRows = lines.slice(1).map(line => {

  const values = line.split(',');

  const row = {};

  headers.forEach((header, index) => {
    row[header] = values[index];
  });


  // Convert numeric telemetry fields

  row.load_t =
    parseNumber(row.load_t);

  row.boom_length_m =
    parseNumber(row.boom_length_m);

  row.boom_angle_deg =
    parseNumber(row.boom_angle_deg);

  row.radius_m =
    parseNumber(row.radius_m);

  row.slew_deg =
    parseNumber(row.slew_deg);

  row.hook_height_m =
    parseNumber(row.hook_height_m);

  row.pad_fl_t =
    parseNumber(row.pad_fl_t);

  row.pad_fr_t =
    parseNumber(row.pad_fr_t);

  row.pad_rl_t =
    parseNumber(row.pad_rl_t);

  row.pad_rr_t =
    parseNumber(row.pad_rr_t);

  row.hydraulic_pressure_bar =
    parseNumber(row.hydraulic_pressure_bar);

  row.wind_kmh =
    parseNumber(row.wind_kmh);

  row.lmi_pct =
    parseNumber(row.lmi_pct);

  row.status_word =
    parseNumber(row.status_word);


  return row;
});


// ------------------------------------------------------------
// Basic recording information
// ------------------------------------------------------------

console.log('==============================================');

// ------------------------------------------------------------
// Invalid and boundary input checks
// ------------------------------------------------------------

const validSample = {
  ts: '2026-09-16T08:00:00+05:30',
  load_t: 1,
  boom_length_m: 38,
  boom_angle_deg: 60,
  radius_m: 10,
  slew_deg: 0,
  outrigger_state: 'DEPLOYED',
  pad_fl_t: 1,
  pad_fr_t: 1,
  pad_rl_t: 1,
  pad_rr_t: 1,
  hydraulic_pressure_bar: 39,
};

const invalidChartResult = detectFailures({
  ...validSample,
  boom_length_m: NaN,
});
assert.equal(invalidChartResult.derived.capacityT, null);
assert.equal(
  invalidChartResult.failures.some(f => f.type === 'OVERLOAD'),
  false
);

const invalidStabilityResult = detectFailures({
  ...validSample,
  radius_m: NaN,
});
assert.equal(invalidStabilityResult.derived.stability, null);
assert.equal(
  invalidStabilityResult.failures.some(f => f.type === 'STABILITY_LOSS'),
  false
);
assert.equal(
  invalidStabilityResult.failures.some(f => f.type === 'DATA_QUALITY'),
  true
);

const invalidSlewResult = detectFailures({
  ...validSample,
  slew_deg: NaN,
});
assert.equal(invalidSlewResult.derived.stability, null);
assert.equal(
  invalidSlewResult.failures.some(f => f.type === 'STABILITY_LOSS'),
  false
);

const missingPadResult = detectFailures({
  ...validSample,
  pad_fl_t: undefined,
});
assert.deepEqual(missingPadResult.derived.liftedPads, []);
assert.deepEqual(missingPadResult.derived.invalidPads, ['FL']);
assert.equal(missingPadResult.failures[0].type, 'DATA_QUALITY');

const missingTelemetryResult = detectFailures(null);
assert.equal(missingTelemetryResult.status, 'INVALID_TELEMETRY');
assert.deepEqual(missingTelemetryResult.failures, []);

const undefinedTelemetryResult = detectFailures(undefined);
assert.equal(undefinedTelemetryResult.status, 'INVALID_TELEMETRY');
assert.deepEqual(undefinedTelemetryResult.failures, []);

const missingTimestampResult = detectFailures({
  ...validSample,
  ts: undefined,
  outrigger_state: 'RETRACTED',
});
assert.equal(missingTimestampResult.status, 'INVALID_TELEMETRY');
assert.deepEqual(missingTimestampResult.failures, []);

console.log('Input validation checks passed');
console.log(' CYCLE 3 TELEMETRY VALIDATION');
console.log('==============================================');

console.log(`Telemetry rows: ${telemetryRows.length}`);

console.log(
  `First timestamp: ${telemetryRows[0].ts}`
);

console.log(
  `Last timestamp: ${telemetryRows[telemetryRows.length - 1].ts}`
);

console.log(
  `Unit ID: ${telemetryRows[0].unit_id}`
);


// ------------------------------------------------------------
// Run Failure Detector against every telemetry row
// ------------------------------------------------------------

const firstDetected = new Map();

const detectionCounts = new Map();
let totalFailureSamples = 0;
const resultsByTimestamp = new Map();
let stabilityLossCount = 0;


let previousTelemetry = null;

for (const telemetry of telemetryRows) {

  const result =
    detectFailures(telemetry, previousTelemetry);

  previousTelemetry = telemetry;
  resultsByTimestamp.set(telemetry.ts, result);
  if (result.failures.some(failure => failure.type === 'STABILITY_LOSS')) {
    stabilityLossCount++;
  }


  for (const failure of result.failures) {

    totalFailureSamples++;


    // Count each failure type

    detectionCounts.set(
      failure.type,
      (detectionCounts.get(failure.type) || 0) + 1
    );


    // Keep the FIRST occurrence of each failure type

    if (!firstDetected.has(failure.type)) {

      firstDetected.set(
        failure.type,
        failure
      );

    }

  }
}

function resultAt(timestamp) {
  const result = resultsByTimestamp.get(timestamp);
  assert.ok(result, `Expected telemetry row at ${timestamp}`);
  return result;
}

function hasFailure(result, type) {
  return result.failures.some(failure => failure.type === type);
}

// Acceptance checks for the audited rows and device-reported conditions.
assert.equal(hasFailure(resultAt('2026-09-16T07:03:00+05:30'), 'IMPROPER_OUTRIGGER_DEPLOYMENT'), true);
assert.equal(hasFailure(resultAt('2026-09-16T12:40:00+05:30'), 'IMPROPER_OUTRIGGER_DEPLOYMENT'), false);
assert.equal(resultAt('2026-09-16T08:00:00+05:30').status, 'NORMAL');
assert.equal(hasFailure(resultAt('2026-09-16T12:18:40+05:30'), 'NOT_PERMITTED'), true);
assert.equal(hasFailure(resultAt('2026-09-16T10:25:27+05:30'), 'OUTRIGGER_LIFT_OFF'), true);
assert.equal(stabilityLossCount, 0, 'The known false stability alarms must be eliminated');

for (const timestamp of [
  '2026-09-16T14:30:00+05:30',
  '2026-09-16T15:00:00+05:30',
  '2026-09-16T15:30:00+05:30',
  '2026-09-16T17:00:00+05:30',
]) {
  const result = resultAt(timestamp);
  assert.equal(result.status, 'INVALID_TELEMETRY');
  assert.equal(hasFailure(result, 'HYDRAULIC_PRESSURE_LOSS'), false);
  assert.equal(hasFailure(result, 'OUTRIGGER_LIFT_OFF'), false);
}

assert.equal(hasFailure(resultAt('2026-09-16T12:30:00+05:30'), 'WIND_ALERT'), true);
assert.equal(hasFailure(resultAt('2026-09-16T14:00:00+05:30'), 'LMI_BYPASS'), true);
assert.equal(hasFailure(resultAt('2026-09-16T14:09:58+05:30'), 'LMI_PREWARNING'), true);
assert.equal(hasFailure(resultAt('2026-09-16T09:00:00+05:30'), 'OVERLOAD'), true);
assert.equal(hasFailure(resultAt('2026-09-16T11:00:01+05:30'), 'HYDRAULIC_PRESSURE_LOSS'), true);
console.log('Audited acceptance checks passed');


// ------------------------------------------------------------
// First detected occurrence of each fault
// ------------------------------------------------------------

console.log('\n==============================================');
console.log(' FIRST DETECTED FAULTS');
console.log('==============================================');


if (firstDetected.size === 0) {

  console.log('No failures detected.');

} else {

  for (const [type, failure] of firstDetected) {

    console.log(`\n${type}`);

    console.log(
      `  Time    : ${failure.timestamp}`
    );

    console.log(
      `  Trigger : ${failure.triggerValue}`
    );

    console.log(
      `  Limit   : ${failure.limit}`
    );

    console.log(
      `  Rule    : ${failure.rule}`
    );
  }
}


// ------------------------------------------------------------
// Detection count
// ------------------------------------------------------------

console.log('\n==============================================');
console.log(' DETECTION COUNTS');
console.log('==============================================');


if (detectionCounts.size === 0) {

  console.log('No failures detected.');

} else {

  for (const [type, count] of detectionCounts) {

    console.log(
      `${type}: ${count} telemetry sample(s)`
    );
  }
}


// ------------------------------------------------------------
// Mentor recording events
//
// These are the event labels already present in the CSV.
// They are shown separately from detector results so we can
// compare the detector against the recording.
// ------------------------------------------------------------

const recordingEvents = new Map();


for (const telemetry of telemetryRows) {

  const event =
    telemetry.event?.trim();

  if (
    event &&
    event !== ''
  ) {

    if (!recordingEvents.has(event)) {

      recordingEvents.set(
        event,
        telemetry.ts
      );
    }
  }
}


console.log('\n==============================================');
console.log(' EVENTS RECORDED IN MENTOR CSV');
console.log('==============================================');


if (recordingEvents.size === 0) {

  console.log('No event labels found.');

} else {

  for (const [event, timestamp] of recordingEvents) {

    console.log(
      `${event} | first recorded at ${timestamp}`
    );
  }
}


// ------------------------------------------------------------
// Final summary
// ------------------------------------------------------------

console.log('\n==============================================');
console.log(' FINAL SUMMARY');
console.log('==============================================');

console.log(
  `Telemetry samples checked : ${telemetryRows.length}`
);

console.log(
  `Failure samples detected  : ${totalFailureSamples}`
);

console.log(
  `Failure types detected    : ${firstDetected.size}`
);

console.log(
  `Recorded event types      : ${recordingEvents.size}`
);

console.log('==============================================');