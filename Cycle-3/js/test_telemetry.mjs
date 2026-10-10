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
import { detectFailures } from './failureDetector.js';


// ------------------------------------------------------------
// Telemetry file supplied by the mentor
// ------------------------------------------------------------

const CSV_PATH =
  '../data/mobile-telemetry-2026-09-16.csv';


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


for (const telemetry of telemetryRows) {

  const result =
    detectFailures(telemetry);


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