// ============================================================
// Cycle 3 — Mobile Crane Digital Twin
// Module 1 — Playback & Clock
//
// Module Owner: Ajit
//
// Responsibilities:
//   1. Parse the telemetry CSV into a typed, ordered array
//   2. Drive a precision clock that steps through the data
//      at configurable playback rates (1×, 10×, 50×, 100×)
//   3. Publish currentTelemetrySample each frame
//   4. Manage LIVE / MANUAL mode toggle
//   5. Notify downstream modules via an event callback
// ============================================================


// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

export const PLAYBACK_RATES = [1, 10, 50, 100];

export const MODE = {
  LIVE:   'LIVE',
  MANUAL: 'MANUAL',
};

// Numeric CSV fields — cast to float; everything else stays string.
const NUMERIC_FIELDS = [
  'load_t',
  'boom_length_m',
  'boom_angle_deg',
  'radius_m',
  'slew_deg',
  'hook_height_m',
  'pad_fl_t',
  'pad_fr_t',
  'pad_rl_t',
  'pad_rr_t',
  'hydraulic_pressure_bar',
  'wind_kmh',
  'lmi_pct',
  'status_word',
];


// ------------------------------------------------------------
// CSV Parser
//
// Accepts raw CSV text (string).
// Returns an object with two arrays:
//   .rows      — sorted by ts ascending (used by the playback clock)
//   .fileOrder — rows in the original file order (used by clock-fault
//                detection to find backwards/duplicate timestamps)
// Throws if the file is empty or has no data rows.
//
// Fix (blank → NaN): a blank numeric cell is stored as NaN, not 0.
// Number('') === 0 is a JS gotcha; we guard against it explicitly so
// that a blank lmi_pct does not look like "device LMI 0 %" to the
// Failure Detector (which would generate 109 false LMI_DIVERGENCE rows
// in the 12:18–12:19 window where the chart has no capacity).
// ------------------------------------------------------------

export function parseCSV(csvText) {

  if (!csvText || typeof csvText !== 'string') {
    throw new Error('parseCSV: csvText must be a non-empty string');
  }

  const lines = csvText.trim().split(/\r?\n/);

  if (lines.length < 2) {
    throw new Error('parseCSV: CSV has no data rows (only header or empty)');
  }

  const headers = lines[0].split(',').map(h => h.trim());

  const fileOrder = [];

  for (let i = 1; i < lines.length; i++) {

    const line = lines[i].trim();

    // Skip blank lines
    if (line === '') continue;

    const values = line.split(',');

    const row = {};

    headers.forEach((header, idx) => {
      const raw = values[idx] !== undefined ? values[idx].trim() : '';
      if (NUMERIC_FIELDS.includes(header)) {
        // GAP FIX 1: blank cell must become NaN, not 0.
        // Number('') === 0 in JavaScript, which is misleading for optional
        // fields like lmi_pct that are intentionally left blank by the device.
        const n = raw === '' ? NaN : Number(raw);
        row[header] = Number.isFinite(n) ? n : NaN;
      } else {
        row[header] = raw;
      }
    });

    // Validate required field
    if (!row.ts) continue;

    fileOrder.push(row);
  }

  if (fileOrder.length === 0) {
    throw new Error('parseCSV: no valid telemetry rows found after parsing');
  }

  // GAP FIX 2: keep the original file order separately so clock-fault
  // detection (Module 4 dataQuality.js, and the clock itself) can see
  // backwards / duplicate timestamps before they are hidden by sorting.
  // The playback clock uses the sorted copy; fault detection uses fileOrder.
  const rows = fileOrder.slice().sort(
    (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)
  );

  // Attach fileOrder as a non-enumerable property so the return value
  // is still array-compatible (length, indexing) while carrying the
  // unsorted sequence for callers that need it.
  Object.defineProperty(rows, 'fileOrder', {
    value: fileOrder,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return rows;
}


// ------------------------------------------------------------
// PlaybackClock
//
// Core class for Module 1.
//
// Usage:
//   const clock = new PlaybackClock(parsedRows, onUpdate);
//   clock.play();
//   clock.setRate(10);
//   clock.pause();
//   clock.setManual();   // switches to MANUAL mode
//   clock.setLive();     // resumes LIVE mode
//   clock.jumpTo('2026-09-16T09:00:00+05:30');
//   clock.reset();
//   clock.destroy();
//
// onUpdate(sample, clock) is called every time the active
// sample changes. sample is the currentTelemetrySample.
// ------------------------------------------------------------

export class PlaybackClock {

  constructor(rows, onUpdate) {

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('PlaybackClock: rows must be a non-empty array');
    }

    if (typeof onUpdate !== 'function') {
      throw new Error('PlaybackClock: onUpdate must be a function');
    }

    this._rows     = rows;
    this._onUpdate = onUpdate;

    // Current index into this._rows
    this._index    = 0;

    // Playback state
    this._playing  = false;
    this._rate     = 1;
    this._mode     = MODE.LIVE;

    // Performance-clock tracking for drift-free stepping
    // _lastPerfNow holds the performance.now() / Date.now() value
    // at which the last frame was processed.
    this._lastTime = null;

    // GAP FIX 3 (ts-driven clock): Instead of assuming every row
    // represents exactly 1 simulated second, we advance by the actual
    // difference between consecutive ts values.  This means:
    //   - a 300-row dropout (15:20:00–15:24:59) causes the clock to
    //     skip 300 s in one step, making the gap visible in playback.
    //   - the clock is correct even if the recording density changes.
    // _accumMs tracks fractional milliseconds of simulated time that
    // have not yet been consumed by a row advance.
    this._accumMs  = 0;

    // Animation frame handle (browser) or interval handle (Node)
    this._handle   = null;

    // Expose current sample as a public property
    this.currentTelemetrySample = rows[0];

    // Expose state for UI binding
    this.mode      = MODE.LIVE;
    this.rate      = 1;
    this.playing   = false;
  }


  // ----------------------------------------------------------
  // Playback control API
  // ----------------------------------------------------------

  /** Start or resume the clock. No-op in MANUAL mode. */
  play() {
    if (this._mode === MODE.MANUAL) return;
    if (this._playing) return;
    this._playing = true;
    this.playing  = true;
    this._lastTime = this._now();
    this._accumMs  = 0;
    this._scheduleNext();
  }

  /** Pause the clock. Does not change mode. */
  pause() {
    this._playing = false;
    this.playing  = false;
    this._cancelNext();
  }

  /** Toggle between play and pause. */
  togglePlay() {
    this._playing ? this.pause() : this.play();
  }

  /**
   * Set playback rate.
   * @param {number} rate — must be one of PLAYBACK_RATES (1, 10, 50, 100)
   */
  setRate(rate) {
    if (!PLAYBACK_RATES.includes(rate)) {
      throw new Error(`setRate: rate must be one of ${PLAYBACK_RATES.join(', ')}`);
    }
    this._rate = rate;
    this.rate  = rate;
  }

  /**
   * Jump the playback cursor to the row whose ts >= targetTs.
   * Pauses the clock; call play() to resume.
   */
  jumpTo(targetTs) {
    this.pause();
    const idx = this._rows.findIndex(r => r.ts >= targetTs);
    this._index = idx === -1 ? this._rows.length - 1 : idx;
    this._accumMs  = 0;
    this._publish();
  }

  /** Reset to the first row. */
  reset() {
    this.pause();
    this._index    = 0;
    this._accumMs  = 0;
    this._publish();
  }

  /**
   * Switch to MANUAL mode.
   * The clock stops and the UI sliders take control.
   * Call pushManualSample() to update the active sample.
   */
  setManual() {
    this.pause();
    this._mode = MODE.MANUAL;
    this.mode  = MODE.MANUAL;
  }

  /**
   * Switch back to LIVE (telemetry-driven) mode.
   * Resumes from the current position.
   */
  setLive() {
    this._mode = MODE.LIVE;
    this.mode  = MODE.LIVE;
    this.play();
  }

  /**
   * In MANUAL mode, let the UI push an overridden sample
   * (e.g. constructed from slider values) without touching the clock.
   * @param {object} sample — must match the telemetry object shape
   */
  pushManualSample(sample) {
    if (this._mode !== MODE.MANUAL) {
      console.warn('PlaybackClock.pushManualSample: ignored — not in MANUAL mode');
      return;
    }
    this.currentTelemetrySample = sample;
    this._onUpdate(this.currentTelemetrySample, this);
  }

  /** Stop the clock and free all resources. */
  destroy() {
    this.pause();
    this._rows     = null;
    this._onUpdate = null;
  }


  // ----------------------------------------------------------
  // Read-only accessors
  // ----------------------------------------------------------

  get totalRows()     { return this._rows ? this._rows.length : 0; }
  get currentIndex()  { return this._index; }
  get firstTimestamp(){ return this._rows ? this._rows[0].ts : null; }
  get lastTimestamp() { return this._rows ? this._rows[this._rows.length - 1].ts : null; }

  /** Progress 0.0 → 1.0 */
  get progress() {
    if (!this._rows || this._rows.length < 2) return 0;
    return this._index / (this._rows.length - 1);
  }


  // ----------------------------------------------------------
  // Internal: timing loop
  // ----------------------------------------------------------

  _now() {
    // Works in both browser (performance.now) and Node (Date.now)
    return (typeof performance !== 'undefined')
      ? performance.now()
      : Date.now();
  }

  _scheduleNext() {
    if (!this._playing) return;

    if (typeof requestAnimationFrame !== 'undefined') {
      // Browser: use rAF for smooth 60fps
      this._handle = requestAnimationFrame(() => this._tick());
    } else {
      // Node (tests): use setImmediate for a tight event loop
      this._handle = setImmediate(() => this._tick());
    }
  }

  _cancelNext() {
    if (this._handle == null) return;
    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this._handle);
    } else {
      clearImmediate(this._handle);
    }
    this._handle = null;
  }

  _tick() {
    if (!this._playing) return;

    const now     = this._now();
    const deltaMs = now - this._lastTime;
    this._lastTime = now;

    // GAP FIX 3 (ts-driven clock):
    // Convert elapsed wall time → simulated milliseconds at the current rate.
    // Cap the raw delta to 200 ms so a backgrounded tab or sleeping computer
    // does not cause a massive single-frame jump in wall time.
    const deltaSimMs = Math.min(deltaMs, 200) * this._rate;
    this._accumMs += deltaSimMs;

    // Step forward using the ACTUAL timestamp gap between consecutive rows
    // instead of assuming every row = 1 s.  This makes the playback clock
    // honour real dropout intervals (e.g. the 300-row / 300-second gap at
    // 15:20:00–15:24:59) so downstream modules see the correct elapsed time.
    let published = false;
    while (this._index < this._rows.length - 1) {
      const curr = this._rows[this._index];
      const next = this._rows[this._index + 1];

      // Gap between this row and the next, in simulated milliseconds.
      // If timestamps are malformed, fall back to 1000 ms (1 s).
      const tsGapMs = (() => {
        const d = Date.parse(next.ts) - Date.parse(curr.ts);
        return Number.isFinite(d) && d > 0 ? d : 1000;
      })();

      if (this._accumMs >= tsGapMs) {
        this._accumMs -= tsGapMs;
        this._index++;
        published = true;
      } else {
        break;
      }
    }

    if (published) {
      this._publish();
    }

    // Stop automatically at the end of the recording
    if (this._index >= this._rows.length - 1) {
      this._playing = false;
      this.playing  = false;
      this._cancelNext();
      return;
    }

    this._scheduleNext();
  }

  _publish() {
    if (!this._rows) return;
    this.currentTelemetrySample = this._rows[this._index];
    this._onUpdate(this.currentTelemetrySample, this);
  }
}


// ------------------------------------------------------------
// Factory helper
//
// Convenience function for browser use.
// Fetches the CSV from a URL, parses it, and returns a ready
// PlaybackClock. Use this in the main simulator entry point.
//
// Example:
//   const clock = await createPlaybackClock(
//     '../data/mobile-telemetry-2026-09-16.csv',
//     (sample, clock) => { updateUI(sample); }
//   );
//   clock.play();
// ------------------------------------------------------------

export async function createPlaybackClock(csvUrl, onUpdate) {
  const response = await fetch(csvUrl);

  if (!response.ok) {
    throw new Error(
      `createPlaybackClock: failed to fetch CSV — ` +
      `${response.status} ${response.statusText}`
    );
  }

  const csvText = await response.text();
  const rows    = parseCSV(csvText);

  return new PlaybackClock(rows, onUpdate);
}
