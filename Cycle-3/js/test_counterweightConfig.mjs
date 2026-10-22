// ============================================================
// Cycle 3 — Counterweight Configuration Tests
//
// Verifies:
// 1. 40 t chart capacities are exactly 0.5x of the 80 t chart
// 2. Null cells in 80 t chart remain null in 40 t chart
// 3. Invalid counterweight tonnage throws RangeError
// 4. Source field contains "ASSUMED, not manufacturer data"
// 5. Recording DATA_QUALITY errors in 40 t match 80 t exactly
//    (pad-sum validation uses 170 t recording mass, not 130 t)
// 6. Overloads increase on 40 t (capacity halving takes effect)
// ============================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CHART,
  CHART_40T,
  chartFor,
  machineMassT,
  capacityFor,
  KIT,
} from './craneModel.js';
import { detectFailures } from './failureDetector.js';
import { parseCSV } from './playbackClock.js';

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${description}`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] ${description}: ${err.message}`);
  }
}

console.log('\n--- 1. Capacity ratio 0.5 & Null cells preservation ---');

test('CHART_40T dimensions match CHART (80 t)', () => {
  assert.equal(CHART_40T.boomLengthsM.length, CHART.boomLengthsM.length);
  assert.equal(CHART_40T.radiiM.length, CHART.radiiM.length);
  assert.equal(CHART_40T.capacityT.length, CHART.capacityT.length);
});

test('Every non-null cell in CHART_40T has capacity ratio 0.5 vs 80 t', () => {
  let nonNullCount = 0;
  for (let r = 0; r < CHART.capacityT.length; r++) {
    const row80 = CHART.capacityT[r];
    const row40 = CHART_40T.capacityT[r];
    assert.equal(row40.length, row80.length);

    for (let c = 0; c < row80.length; c++) {
      const v80 = row80[c];
      const v40 = row40[c];
      if (v80 !== null) {
        nonNullCount++;
        assert.equal(v40, v80 * 0.5, `Cell [${r}][${c}] expected ${v80 * 0.5}, got ${v40}`);
        assert.equal(v40 / v80, 0.5, `Ratio at [${r}][${c}] expected 0.5, got ${v40 / v80}`);
      }
    }
  }
  assert.ok(nonNullCount > 0, 'Must have tested non-null cells');
});

test('Every null cell in 80 t chart is preserved as null in 40 t chart', () => {
  let nullCount = 0;
  for (let r = 0; r < CHART.capacityT.length; r++) {
    const row80 = CHART.capacityT[r];
    const row40 = CHART_40T.capacityT[r];
    for (let c = 0; c < row80.length; c++) {
      if (row80[c] === null) {
        nullCount++;
        assert.equal(row40[c], null, `Cell [${r}][${c}] should be null`);
      }
    }
  }
  assert.ok(nullCount > 0, 'Must have tested null cells');
});

test('capacityFor lookup halves rated capacity for 40 t', () => {
  const sample = { boom_length_m: 38.0, radius_m: 12, load_t: 20 };
  const cap80 = capacityFor(sample, 80);
  const cap40 = capacityFor(sample, 40);
  assert.equal(cap80.capacityT, 47.5);
  assert.equal(cap40.capacityT, 23.75);
  assert.equal(cap40.capacityT / cap80.capacityT, 0.5);
});

test('capacityFor lookup returns null for not-permitted boom/radius in 40 t', () => {
  const sample = { boom_length_m: 52.4, radius_m: 8, load_t: 5 };
  const cap40 = capacityFor(sample, 40);
  assert.equal(cap40.capacityT, null);
  assert.equal(cap40.capacityInputsValid, true);
});


console.log('\n--- 2. Source field & UI label constraint ---');

test('CHART_40T source is labeled "ASSUMED, not manufacturer data"', () => {
  assert.equal(CHART_40T.source, 'ASSUMED, not manufacturer data');
});

test('CHART_40T config mentions "ASSUMED, not manufacturer data"', () => {
  assert.ok(CHART_40T.config.includes('ASSUMED, not manufacturer data'));
});

test('capacityFor exposes chartSource', () => {
  const res = capacityFor({ boom_length_m: 38, radius_m: 12 }, 40);
  assert.equal(res.chartSource, 'ASSUMED, not manufacturer data');
});


console.log('\n--- 3. Invalid config validation (throws RangeError) ---');

test('chartFor(80) returns 80 t chart', () => {
  assert.equal(chartFor(80), CHART);
});

test('chartFor(40) returns 40 t chart', () => {
  assert.equal(chartFor(40), CHART_40T);
});

test('chartFor throws RangeError for unsupported configs', () => {
  const invalidConfigs = [0, 50, 60, 100, -40, null, undefined, '80', NaN];
  for (const cwt of invalidConfigs) {
    assert.throws(
      () => chartFor(cwt),
      RangeError,
      `chartFor(${cwt}) should throw RangeError`
    );
  }
});

test('machineMassT returns 170 t for 80 t and 130 t for 40 t', () => {
  assert.equal(machineMassT(80), 170);
  assert.equal(machineMassT(40), 130);
  assert.equal(machineMassT(), 170); // default
});

test('machineMassT throws RangeError for invalid configs', () => {
  assert.throws(() => machineMassT(50), RangeError);
  assert.throws(() => machineMassT(0), RangeError);
});


console.log('\n--- 4. Recorded CSV DATA_QUALITY errors consistency (170 t vs 130 t) ---');

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvPath = join(__dirname, '..', 'data', 'mobile-telemetry-2026-09-16.csv');
const rawCSV = readFileSync(csvPath, 'utf8');
const rows = parseCSV(rawCSV);

console.log(`  Loaded ${rows.length} rows from recording`);

test('DATA_QUALITY error count on recording is identical between 80 t and 40 t', () => {
  let dq80Count = 0;
  let dq40Count = 0;
  let overload80Count = 0;
  let overload40Count = 0;

  const dq80Timestamps = [];
  const dq40Timestamps = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const prev = i > 0 ? rows[i - 1] : null;

    const res80 = detectFailures(row, prev, 80);
    const res40 = detectFailures(row, prev, 40);

    const hasDQ80 = res80.failures.some(f => f.type === 'DATA_QUALITY');
    const hasDQ40 = res40.failures.some(f => f.type === 'DATA_QUALITY');

    if (hasDQ80) {
      dq80Count++;
      dq80Timestamps.push(row.ts);
    }
    if (hasDQ40) {
      dq40Count++;
      dq40Timestamps.push(row.ts);
    }

    if (res80.failures.some(f => f.type === 'OVERLOAD')) overload80Count++;
    if (res40.failures.some(f => f.type === 'OVERLOAD')) overload40Count++;
  }

  console.log(`    80 t DATA_QUALITY errors: ${dq80Count}`);
  console.log(`    40 t DATA_QUALITY errors: ${dq40Count}`);
  console.log(`    80 t OVERLOAD errors:     ${overload80Count}`);
  console.log(`    40 t OVERLOAD errors:     ${overload40Count}`);

  // Constraint 6: recording par 40 t mein DATA_QUALITY errors 80 t jitne hi hon
  assert.equal(dq40Count, dq80Count, 'DATA_QUALITY error count must match exactly');
  assert.deepEqual(dq40Timestamps, dq80Timestamps, 'DATA_QUALITY timestamps must match exactly');

  // Prove that 40 t capacity reduction is active (more overloads detected)
  assert.ok(overload40Count > overload80Count, '40 t config must detect more overloads than 80 t');
});

console.log(`\n==============================================`);
console.log(` COUNTERWEIGHT CONFIG TEST RESULTS: ${passed} passed, ${failed} failed`);
console.log(`==============================================\n`);

process.exit(failed === 0 ? 0 : 1);
