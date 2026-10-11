import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseCSV, PlaybackClock } from './playbackClock.js';
import { detectFailures } from './failureDetector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvPath = join(__dirname, '../data/mobile-telemetry-2026-09-16.csv');

const csv = readFileSync(csvPath, 'utf8');
const rows = parseCSV(csv);

assert.ok(rows.length > 0, 'Playback should load telemetry rows');

let latestSample = null;
let latestFailures = [];
let latestResult = null;

const clock = new PlaybackClock(rows, (sample) => {
  latestSample = sample;
  latestResult = detectFailures(sample);
  latestFailures = latestResult.failures;
});

function assertAlarm(type, timestamp) {
  assert.equal(latestResult.status, 'FAILURE_DETECTED');
  assert.equal(latestResult.timestamp, timestamp);
  const alarm = latestFailures.find(f => f.type === type);
  assert.ok(alarm, `Detector should identify ${type}`);
  assert.equal(alarm.timestamp, timestamp);
  assert.notEqual(alarm.triggerValue, undefined);
  assert.notEqual(alarm.limit, undefined);
  assert.ok(alarm.rule);
}

try {
  clock.jumpTo('2026-09-16T09:00:00+05:30');

  assert.ok(latestSample, 'Playback should publish a sample');
  assert.equal(
    latestSample.ts,
    '2026-09-16T09:00:00+05:30',
    'Playback should select the expected timestamp'
  );
  assertAlarm('OVERLOAD', latestSample.ts);

  console.log('PASS: Playback sample reaches Failure Detector');
  console.log('PASS: Overload detected at', latestSample.ts);
  console.log('Failures:', latestFailures.map(f => f.type).join(', '));

  clock.jumpTo('2026-09-16T11:00:00+05:30');
  assert.equal(latestSample.ts, '2026-09-16T11:00:00+05:30');
  assertAlarm('STABILITY_LOSS', latestSample.ts);
  console.log('PASS: Stability loss detected at', latestSample.ts);
  console.log('Failures:', latestFailures.map(f => f.type).join(', '));

  const knownFaults = [
    ['2026-09-16T11:00:01+05:30', 'HYDRAULIC_PRESSURE_LOSS'],
    ['2026-09-16T12:40:00+05:30', 'IMPROPER_OUTRIGGER_DEPLOYMENT'],
    ['2026-09-16T15:30:00+05:30', 'OUTRIGGER_LIFT_OFF'],
  ];

  for (const [timestamp, type] of knownFaults) {
    clock.jumpTo(timestamp);
    assert.equal(latestSample.ts, timestamp);
    assertAlarm(type, timestamp);
    console.log(`PASS: ${type} detected at`, timestamp);
  }
} finally {
  clock.destroy();
}

