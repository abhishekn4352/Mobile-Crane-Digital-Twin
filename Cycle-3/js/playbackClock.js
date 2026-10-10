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
// Returns an array of telemetry objects, sorted by ts ascending.
// Throws if the file is empty or has no data rows.
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

  const rows = [];

  for (let i = 1; i < lines.length; i++) {

    const line = lines[i].trim();

    // Skip blank lines
    if (line === '') continue;

    const values = line.split(',');

    const row = {};

    headers.forEach((header, idx) => {
      const raw = values[idx] !== undefined ? values[idx].trim() : '';
      if (NUMERIC_FIELDS.includes(header)) {
        const n = Number(raw);
        row[header] = Number.isFinite(n) ? n : NaN;
      } else {
        row[header] = raw;
      }
    });

    // Validate required field
    if (!row.ts) continue;

    rows.push(row);
  }

  if (rows.length === 0) {
    throw new Error('parseCSV: no valid telemetry rows found after parsing');
  }

  // Sort ascending by timestamp string — ISO 8601 sorts lexicographically
  rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

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

    // Accumulated fractional seconds carried across frames
    this._accumSec = 0;

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
    this._accumSec = 0;
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
    this._accumSec = 0;
    this._publish();
  }

  /** Reset to the first row. */
  reset() {
    this.pause();
    this._index    = 0;
    this._accumSec = 0;
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

    // Convert elapsed wall time → simulated seconds at the current rate.
    // Cap the delta to 200 ms to prevent a huge jump if the browser tab
    // was backgrounded or the computer was sleeping.
    const deltaSimSec = Math.min(deltaMs, 200) / 1000 * this._rate;
    this._accumSec += deltaSimSec;

    // Step forward by as many 1-second rows as simulated time has advanced.
    // The CSV records at 1 sample per second, so each row = 1 simulated second.
    const steps = Math.floor(this._accumSec);
    this._accumSec -= steps;

    if (steps > 0) {
      this._index = Math.min(this._index + steps, this._rows.length - 1);
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
