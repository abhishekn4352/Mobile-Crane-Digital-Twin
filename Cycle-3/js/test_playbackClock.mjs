// ============================================================
// Cycle 3 — Module 1 Test Suite
// test_playbackClock.mjs
//
// Module Owner: Ajit
//
// Covers:
//   1. parseCSV — header parsing, numeric casting, sorting,
//      blank-line skipping, error handling
//   2. PlaybackClock — construction, play/pause, rate setting,
//      jumpTo, reset, LIVE/MANUAL mode toggle, pushManualSample,
//      end-of-recording auto-stop, progress, destroy
//   3. Real CSV smoke test — load the actual telemetry file and
//      verify row count, first/last timestamp, field types
// ============================================================

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';

import {
  parseCSV,
  PlaybackClock,
  PLAYBACK_RATES,
  MODE,
} from './playbackClock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH  = join(__dirname, '../data/mobile-telemetry-2026-09-16.csv');


// ------------------------------------------------------------
// Tiny test harness
// ------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${label}`);
    console.log(`         expected : ${JSON.stringify(expected)}`);
    console.log(`         actual   : ${JSON.stringify(actual)}`);
    failed++;
  }
}

function checkTrue(label, value) {
  if (value) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${label} — was falsy`);
    failed++;
  }
}

function checkThrows(label, fn) {
  try {
    fn();
    console.log(`  [FAIL] ${label} — expected a throw but none occurred`);
    failed++;
  } catch (e) {
    console.log(`  [PASS] ${label} — threw: ${e.message}`);
    passed++;
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}


// ============================================================
// SECTION 1 — parseCSV
// ============================================================

section('parseCSV — basic header & row parsing');

const MINIMAL_CSV = [
  'ts,load_t,boom_length_m,outrigger_state',
  '2026-09-16T07:00:00+05:30,10.5,32.0,DEPLOYED',
  '2026-09-16T07:00:01+05:30,11.0,33.0,DEPLOYING',
].join('\n');

const rows = parseCSV(MINIMAL_CSV);

check('row count', rows.length, 2);
check('first ts', rows[0].ts, '2026-09-16T07:00:00+05:30');
check('load_t is number', typeof rows[0].load_t, 'number');
check('load_t value', rows[0].load_t, 10.5);
check('boom_length_m value', rows[0].boom_length_m, 32.0);
check('outrigger_state is string', typeof rows[0].outrigger_state, 'string');
check('outrigger_state value', rows[0].outrigger_state, 'DEPLOYED');

section('parseCSV — timestamp sort (out-of-order input)');

const UNSORTED_CSV = [
  'ts,load_t',
  '2026-09-16T07:00:02+05:30,3',
  '2026-09-16T07:00:00+05:30,1',
  '2026-09-16T07:00:01+05:30,2',
].join('\n');

const sorted = parseCSV(UNSORTED_CSV);
check('sorted row 0 ts', sorted[0].ts, '2026-09-16T07:00:00+05:30');
check('sorted row 1 ts', sorted[1].ts, '2026-09-16T07:00:01+05:30');
check('sorted row 2 ts', sorted[2].ts, '2026-09-16T07:00:02+05:30');

section('parseCSV — blank lines skipped');

const BLANK_LINES_CSV = [
  'ts,load_t',
  '2026-09-16T07:00:00+05:30,5',
  '',
  '2026-09-16T07:00:01+05:30,6',
  '',
].join('\n');

const noBlank = parseCSV(BLANK_LINES_CSV);
check('blank lines skipped — row count', noBlank.length, 2);

section('parseCSV — non-finite numeric becomes NaN');

const NAN_CSV = [
  'ts,load_t',
  '2026-09-16T07:00:00+05:30,BAD_VALUE',
].join('\n');

const nanRows = parseCSV(NAN_CSV);
checkTrue('NaN for bad numeric', Number.isNaN(nanRows[0].load_t));

section('parseCSV — error handling');

checkThrows('throws on null input',    () => parseCSV(null));
checkThrows('throws on empty string',  () => parseCSV(''));
checkThrows('throws on header-only',   () => parseCSV('ts,load_t'));


// ============================================================
// SECTION 2 — PlaybackClock construction
// ============================================================

section('PlaybackClock — construction');

const SAMPLE_ROWS = parseCSV(MINIMAL_CSV);
let callbackCount = 0;
let lastSample = null;

const onUpdate = (sample) => {
  callbackCount++;
  lastSample = sample;
};

const clock = new PlaybackClock(SAMPLE_ROWS, onUpdate);

check('initial index',    clock.currentIndex, 0);
check('initial playing',  clock.playing,      false);
check('initial mode',     clock.mode,         MODE.LIVE);
check('initial rate',     clock.rate,         1);
check('totalRows',        clock.totalRows,    2);
check('progress at 0',    clock.progress,     0);
checkTrue('currentTelemetrySample is set', clock.currentTelemetrySample !== null);

section('PlaybackClock — construction error handling');

checkThrows('throws on empty rows',      () => new PlaybackClock([], onUpdate));
checkThrows('throws on null rows',       () => new PlaybackClock(null, onUpdate));
checkThrows('throws on missing callback',() => new PlaybackClock(SAMPLE_ROWS, null));


// ============================================================
// SECTION 3 — Rate setting
// ============================================================

section('PlaybackClock — setRate');

clock.setRate(10);
check('rate updated to 10', clock.rate, 10);

clock.setRate(1);
check('rate reset to 1',    clock.rate, 1);

checkThrows('throws on invalid rate 7', () => clock.setRate(7));
checkThrows('throws on rate 0',         () => clock.setRate(0));

// Verify all valid rates are accepted
for (const r of PLAYBACK_RATES) {
  clock.setRate(r);
  check(`setRate(${r}) accepted`, clock.rate, r);
}
clock.setRate(1);


// ============================================================
// SECTION 4 — jumpTo and reset
// ============================================================

section('PlaybackClock — jumpTo');

clock.jumpTo('2026-09-16T07:00:01+05:30');
check('jumped to correct index', clock.currentIndex, 1);
check('still paused after jump', clock.playing, false);
checkTrue('currentTelemetrySample updated after jump',
  clock.currentTelemetrySample.ts === '2026-09-16T07:00:01+05:30'
);

section('PlaybackClock — reset');

clock.reset();
check('reset index to 0',    clock.currentIndex, 0);
check('still paused',        clock.playing,      false);
check('progress after reset',clock.progress,     0);


// ============================================================
// SECTION 5 — LIVE / MANUAL mode toggle
// ============================================================

section('PlaybackClock — LIVE / MANUAL mode');

check('starts in LIVE mode', clock.mode, MODE.LIVE);

clock.setManual();
check('mode is MANUAL after setManual', clock.mode, MODE.MANUAL);
check('paused when switching to MANUAL', clock.playing, false);

// play() must be a no-op in MANUAL mode
clock.play();
check('play() ignored in MANUAL mode', clock.playing, false);

section('PlaybackClock — pushManualSample');

const manualSample = {
  ts:                    '2026-09-16T10:00:00+05:30',
  load_t:                25,
  boom_length_m:         40,
  boom_angle_deg:        60,
  radius_m:              20,
  slew_deg:              45,
  hook_height_m:         15,
  outrigger_state:       'DEPLOYED',
  pad_fl_t:              40,
  pad_fr_t:              40,
  pad_rl_t:              40,
  pad_rr_t:              40,
  hydraulic_pressure_bar:200,
  wind_kmh:              12,
  lmi_pct:               85,
  status_word:           0,
  event:                 '',
};

const before = callbackCount;
clock.pushManualSample(manualSample);
check('callback fired on pushManualSample', callbackCount, before + 1);
check('currentTelemetrySample updated', clock.currentTelemetrySample.load_t, 25);

section('PlaybackClock — pushManualSample ignored in LIVE mode');

clock.setLive();
check('mode restored to LIVE', clock.mode, MODE.LIVE);

const beforeLive = callbackCount;
clock.pause(); // stop the auto-play that setLive() started
clock.pushManualSample(manualSample); // should be ignored
check('pushManualSample ignored in LIVE mode', callbackCount, beforeLive);


// ============================================================
// SECTION 6 — End-of-recording auto-stop (Node timing)
// ============================================================

section('PlaybackClock — end-of-recording auto-stop');

// Build a 3-row clock and let it run to the end via jumpTo
const THREE_ROWS = parseCSV([
  'ts,load_t',
  '2026-09-16T07:00:00+05:30,1',
  '2026-09-16T07:00:01+05:30,2',
  '2026-09-16T07:00:02+05:30,3',
].join('\n'));

const endClock = new PlaybackClock(THREE_ROWS, () => {});

endClock.jumpTo('2026-09-16T07:00:02+05:30');
check('at last row', endClock.currentIndex, 2);
check('progress = 1', endClock.progress, 1);

// Auto-stop is verified by the fact that play() with setImmediate
// immediately stops when _index >= rows.length - 1. We test
// the boundary condition directly:
endClock._playing = true;
endClock.playing  = true;
endClock._tick();  // should stop itself
check('auto-stopped at end of recording', endClock.playing, false);


// ============================================================
// SECTION 7 — destroy
// ============================================================

section('PlaybackClock — destroy');

const dClock = new PlaybackClock(SAMPLE_ROWS, () => {});
dClock.destroy();
check('rows nulled after destroy',    dClock._rows,     null);
check('callback nulled after destroy',dClock._onUpdate, null);
check('playing false after destroy',  dClock.playing,   false);


// ============================================================
// SECTION 8 — Real CSV smoke test
// ============================================================

section('Real CSV smoke test — mobile-telemetry-2026-09-16.csv');

const csvText  = fs.readFileSync(CSV_PATH, 'utf8');
const realRows = parseCSV(csvText);

check('row count = 39301',
  realRows.length,
  39301
);

check('first timestamp',
  realRows[0].ts,
  '2026-09-16T07:00:00+05:30'
);

check('last timestamp',
  realRows[realRows.length - 1].ts,
  '2026-09-16T18:00:00+05:30'
);

checkTrue('load_t is number on first row',
  typeof realRows[0].load_t === 'number'
);

checkTrue('boom_length_m is number on first row',
  typeof realRows[0].boom_length_m === 'number'
);

checkTrue('outrigger_state is string on first row',
  typeof realRows[0].outrigger_state === 'string'
);

checkTrue('unit_id is non-empty string',
  typeof realRows[0].unit_id === 'string' &&
  realRows[0].unit_id.length > 0
);

// Verify the PlaybackClock can be constructed with the real data
const realClock = new PlaybackClock(realRows, () => {});
check('real clock totalRows', realClock.totalRows, 39301);
checkTrue('first sample ts matches',
  realClock.currentTelemetrySample.ts === '2026-09-16T07:00:00+05:30'
);
realClock.jumpTo('2026-09-16T09:00:00+05:30');
checkTrue('jumpTo 09:00 works',
  realClock.currentTelemetrySample.ts >= '2026-09-16T09:00:00+05:30'
);


// ============================================================
// Final summary
// ============================================================

console.log('\n==============================================');
console.log(' MODULE 1 TEST RESULTS');
console.log('==============================================');
console.log(`  PASSED : ${passed}`);
console.log(`  FAILED : ${failed}`);
console.log('==============================================');

if (failed > 0) process.exit(1);
