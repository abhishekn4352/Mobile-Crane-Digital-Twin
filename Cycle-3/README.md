# Cycle 3 — Mobile Crane Digital Twin

## Module 1 — Playback & Clock

**Module Owner:** Ajit

### 1. Module Responsibility

The Playback & Clock module is responsible for loading, parsing, and streaming the crane telemetry data (CSV) across a time-based playback engine.

Key responsibilities include:

- Reading and parsing the recorded telemetry CSV file (`mobile-telemetry-2026-09-16.csv`, 39,301 rows).
- Managing a **ts-driven** playback clock that advances by the actual timestamp difference between consecutive rows — not by a fixed 1-second assumption — so that real dropout intervals are preserved faithfully.
- Providing play/pause controls and speed multiplier adjustments (`1x`, `10x`, `50x`, `100x`).
- Maintaining the active `currentTelemetrySample` state for downstream modules (Failure Detector, Stability/Load Chart, UI panels).
- Handling the `LIVE` vs `MANUAL` operating mode toggle:
  - **LIVE Mode:** Crane state is driven strictly by CSV timestamp progression.
  - **MANUAL Mode:** Telemetry stream pauses and user UI sliders gain control; the clock publishes a user-constructed sample on each slider change.

### 2. Telemetry Parsing & Clock Mechanics

**`parseCSV(csvText)`** returns a sorted array of telemetry objects. Each row contains the following fields:

| Field | Type | Notes |
|---|---|---|
| `ts` | string | ISO 8601 timestamp with timezone (`+05:30`) |
| `load_t` | number / NaN | Hook load in tonnes; NaN when cell is blank |
| `boom_length_m` | number / NaN | Boom length in metres |
| `boom_angle_deg` | number / NaN | Luff angle in degrees |
| `radius_m` | number / NaN | Working radius in metres |
| `slew_deg` | number / NaN | Slew angle in degrees |
| `hook_height_m` | number / NaN | Hook height in metres |
| `pad_fl_t … pad_rr_t` | number / NaN | Four outrigger pad reactions in tonnes |
| `hydraulic_pressure_bar` | number / NaN | Hydraulic pressure in bar |
| `wind_kmh` | number / NaN | Wind speed in km/h |
| `lmi_pct` | number / NaN | Device LMI percentage; **NaN when blank** (see §5) |
| `status_word` | number / NaN | Device status bitmask |
| `outrigger_state` | string | `DEPLOYED`, `DEPLOYING`, `RETRACTED`, etc. |
| `event` | string | Device event string |

The returned array also carries a non-enumerable `.fileOrder` property — the rows in the original file order before sorting — so clock-fault detection can find backwards or repeated timestamps that sorting would otherwise hide (see §5, Gap Fix 2).

**Clock stepping** uses the actual `ts` difference between the current row and the next:

```
tsGapMs = Date.parse(rows[i+1].ts) - Date.parse(rows[i].ts)
```

Each `_tick()` drains accumulated simulated milliseconds against the real gap, so a 300-second dropout (15:20:00–15:24:59) causes the clock to skip 300 s in one step rather than playing silently through it. Falls back to 1000 ms if consecutive timestamps are malformed.

### 3. Playback Controls & Modes

- **Controls:** `play()`, `pause()`, `togglePlay()`, `reset()`, `jumpTo(targetTs)`.
- **Playback Rates:** `1x` (real-time), `10x`, `50x`, `100x` fast-forward. Set with `setRate(rate)`.
- **Mode Toggle:**
  - `setManual()` — pauses the clock; UI sliders take control. Call `pushManualSample(sample)` to emit a user-built sample.
  - `setLive()` — resumes LIVE playback from the current position.

### 4. Testing

Test file: `js/test_playbackClock.mjs`

Run with:

```
node Cycle-3/js/test_playbackClock.mjs
```

**Results: 74 / 74 tests pass** (0 failures).

| Area | Tests |
|---|---|
| CSV parsing — headers, numeric casting, string fields | 7 |
| Timestamp sort (out-of-order input) + `fileOrder` preservation | 7 |
| Blank lines skipped | 1 |
| Non-finite numeric → NaN | 1 |
| Gap Fix 1 — blank cell → NaN (not 0) | 3 |
| Error handling (null, empty string, header-only) | 3 |
| Construction and public state | 7 |
| Construction error handling | 3 |
| `setRate` — valid and invalid rates | 6 |
| `jumpTo` and `reset` | 6 |
| LIVE / MANUAL mode toggle | 4 |
| `pushManualSample` (MANUAL and LIVE) | 4 |
| End-of-recording auto-stop | 3 |
| Gap Fix 3 — ts-driven stepping across a 300 s dropout | 4 |
| `destroy` | 3 |
| Real CSV smoke test (39,301 rows) | 10 |

### 5. Gap Fixes Applied (Oct 2026)

These fixes were identified in the project gap analysis and applied to `js/playbackClock.js`.

| Priority | Gap | Fix applied |
|---|---|---|
| **High** | `parseCSV` read blank numeric cells as `0` (`Number('') === 0`), causing 109 false `LMI_DIVERGENCE` alarms in the 12:18–12:19 window where `lmi_pct` is intentionally blank. | Blank cell → `NaN`: `const n = raw === '' ? NaN : Number(raw)`. All existing tests still pass; the 109 false alarms disappear. |
| **High** | `parseCSV` sorted all rows by `ts`, hiding the backwards timestamp step 15:59:59 → 15:59:49 from any code that received the array. | File order is preserved in a non-enumerable `.fileOrder` property on the returned array. The sorted copy is used by the clock; `.fileOrder` is used by clock-fault detection. |
| **High** | Clock assumed every row = 1 simulated second, making the 300-row dropout at 15:20:00–15:24:59 invisible during playback. | Clock is now **ts-driven**: each tick drains accumulated simulated ms against `Date.parse(next.ts) - Date.parse(curr.ts)`. A 300-second gap is traversed in a single step. |

### 6. Module Integration

The Playback & Clock module is the central data provider for the entire Cycle 3 Digital Twin pipeline:

```
CSV File (39,301 rows)
      ↓
parseCSV()  →  sorted rows  +  rows.fileOrder (original file order)
      ↓
PlaybackClock._tick()  →  currentTelemetrySample (one row per frame)
      ↓
Module 3 (craneModel.js)    →  ratedCapacity, stabilityVerdict
Module 2 (failureDetector)  →  alarm list
Module 4 (panelModel.js)    →  sensor panel + 3D view
```

Exported API:

| Export | Used by |
|---|---|
| `parseCSV(csvText)` | Module 4 simulator entry point |
| `PlaybackClock` (class) | Module 4 simulator entry point |
| `createPlaybackClock(url, onUpdate)` | Module 4 simulator entry point (browser) |
| `clock.currentTelemetrySample` | Modules 2, 3, 4 |
| `clock.setManual()` / `clock.setLive()` | Module 4 UI controls |
| `clock.pushManualSample(sample)` | Module 4 slider override |
| `clock.onUpdate(sample, clock)` callback | Module 4 re-render trigger |
| `rows.fileOrder` | Module 4 `dataQuality.js` clock-fault scan |

### 7. Real vs Faked

| Feature | Source | Status |
|---|---|---|
| Telemetry timestamps (`ts`) | CSV column — ISO 8601 strings | **Real** |
| Load, boom length / angle, radius, slew | CSV numeric columns | **Real** |
| Outrigger state | CSV string column | **Real** |
| Pad reactions (FL, FR, RL, RR) | CSV numeric columns | **Real** |
| Hydraulic pressure, wind speed | CSV numeric columns | **Real** |
| `lmi_pct` | CSV numeric column; blank when chart has no capacity | **Real** — blank correctly stored as `NaN` |
| `status_word` | CSV numeric column | **Real** — device bitmask |
| Clock advance interval | Actual `ts` difference between consecutive rows | **Real** — ts-driven, not assumed 1 s |
| File-order glitch detection | `.fileOrder` property on the parsed array | **Real** — preserves the true file sequence |
| Playback speed multipliers (1×–100×) | Wall-clock scaling of simulated time | **Scaled** — real data, compressed time |
| MANUAL mode sample | Constructed from UI slider values by Module 4 | **Simulated** — not from the recording |

---

## Module 2 — Failure Detector

**Module Owner:** Rushikesh

### Module Responsibility

The Failure Detector monitors crane telemetry during playback and
identifies abnormal operating conditions. It reports the failure type,
triggering telemetry or calculated value, violated rule/limit, and the
timestamp of the triggering row.

## 2. Telemetry Inputs

The detector uses the Cycle 3 recording's load, boom length, boom angle,
working radius, slew angle, hook height, outrigger state, four pad
reactions, hydraulic pressure, wind speed, device LMI percentage, and
status word. It uses `craneModel.js` for shared chart, kit, and stability
calculations rather than duplicating those calculations.

## 3. Detection Rules

### Load, LMI, and stability

- The current load is compared with the rated capacity from the shared
  load chart. A permitted chart capacity that is exceeded produces
  `OVERLOAD`. Valid chart inputs with no permitted capacity produce
  `NOT_PERMITTED` instead. Capacity lookup and interpolation are
  kit-derived Module 3 calculations.
- `LMI_DIVERGENCE` is produced when computed utilization differs from
  device `lmi_pct` by more than 2 percentage points, or exactly one of
  those inputs is present. The 2-point tolerance is a detector rule.
- Stability is calculated by the shared kit model using load, radius,
  slew angle, centre of gravity, load position, and the outrigger support
  polygon. A deployed row with a `tipping` verdict produces
  `STABILITY_LOSS`.
- A deployed pad reaction below 5 t produces
  `OUTRIGGER_NEAR_LIFT_OFF`; a non-positive reaction produces
  `OUTRIGGER_LIFT_OFF`. These thresholds are kit/model thresholds.

### Hydraulic and deployment rules

- Expected pressure is calculated as
  `20 + 0.35 * load_t * radius_m + 0.5 * boom_length_m`. Recorded
  pressure below 95% of that expected value produces
  `HYDRAULIC_PRESSURE_LOSS`. The formula is the implemented software
  model; 95% is the detector threshold.
- If any motion status bit 0-3 is active, or the load is positive, while
  `outrigger_state` is not `DEPLOYED`, the detector produces
  `IMPROPER_OUTRIGGER_DEPLOYMENT`. A parked retracted crane with no
  motion and no load is not reported as improper deployment.
- `WIND_ALERT` is produced above 36 km/h. This is the implemented team
  operating threshold.

### Status bits and data quality

- Status word bit 7 produces `DEVICE_OVERLOAD` when set and no calculated
  `OVERLOAD` is already present.
- Status word bit 8, or computed utilization from 90% up to but below
  100%, produces `LMI_PREWARNING`.
- Status word bit 9 produces `A2B_ALERT`; bit 12 produces `LMI_BYPASS`.
- `DATA_QUALITY` is produced for invalid required numeric values, negative
  load, boom angle outside 0-85 degrees, radius or hook-height geometry
  inconsistency, excessive rates, or invalid/unbalanced deployed pads.
  The implemented rate limits are 0.3 m/s telescope, 2 degrees/s luff,
  and 3 degrees/s slew. Geometry tolerance is 1 m; deployed pad balance
  must match the 170 t kit plus load within 3 t.

## 4. Alarm Output

`detectFailures` returns alarm objects with:

- `type`: the failure classification, such as `OVERLOAD` or
  `DATA_QUALITY`
- `timestamp`: the telemetry timestamp of the row that triggered it
- `triggerValue`: the recorded or calculated value that caused the alarm
- `limit`: the comparison limit, expected value, or required condition
- `rule`: a human-readable explanation of the detector rule

The detector reports the timestamp of the row that triggers an alarm. It
does not independently remember the entire recording or latch an episode.
The first timestamp for a continuing alarm episode is therefore
determined by the alarm log's aggregation/latching behavior.

## 5. Testing

The following tests have been run:

- `node Cycle-3/js/test_failureDetector.mjs`
  - Recording-based failure detector alarm regressions pass, including
    the requested first alarm timestamps/types and recovery-row checks.
  - The test prints `PASS: Recording-based failure detector alarm regressions`;
    no assertion count is claimed.
- `node Cycle-3/js/test_telemetry.mjs`
  - Input validation and telemetry acceptance checks pass.
- `node Cycle-3/js/test_craneModel.mjs`
  - **83 passed, 0 failed**.
- `node Cycle-3/js/test_playback_failure_integration.mjs`
  - Playback sample delivery, overload, pressure-loss, stability
    suppression, parked-crane, and invalid-row checks pass.
- `node Cycle-3/js/test_playbackClock.mjs`
  - **63 passed, 0 failed**.

## 6. Real vs Faked

| Feature | Source | Status/Notes |
|---|---|---|
| Load, boom length, boom angle | Cycle 3 telemetry CSV | Recorded telemetry |
| Radius, outrigger state, pad reactions | Cycle 3 telemetry CSV | Recorded telemetry |
| Hydraulic pressure, wind, device LMI | Cycle 3 telemetry CSV | Recorded telemetry |
| Status bits | Cycle 3 telemetry CSV | Recorded telemetry |
| Rated capacity | `craneModel.js` | Calculated/looked up by software |
| Computed utilization | `craneModel.js` | Calculated by software |
| Expected hydraulic pressure | `failureDetector.js` | Calculated by software |
| Geometry validation | Failure Detector/shared radius model | Calculated validation result |
| Stability result | `craneModel.js` shared kit model | Calculated by software |
| Alarm classifications | `failureDetector.js` | Calculated from recorded and derived values |
| Visual/simulated behavior | Other modules/UI | No additional simulated telemetry is claimed by Module 2 |

## 7. Faults Found in Telemetry Recording

The following real crane-related faults are identified when the detector
is run against the supplied recording:

| Timestamp | Fault | Detection Rule | Result |
|---|---|---|---|
| 07:03:00 | Improper outrigger deployment | Motion bit active and load carried while outriggers are `DEPLOYING` | `IMPROPER_OUTRIGGER_DEPLOYMENT` |
| 09:00:00 | Overload | Load exceeds rated chart capacity | `OVERLOAD` |
| 09:50:00 | Overload with LMI under-reading | Load remains over capacity and device LMI diverges from computed utilization | `OVERLOAD` and `LMI_DIVERGENCE` |
| 10:25:20 | Front-left pad near lift-off | FL pad reaction is below 5 t | `OUTRIGGER_NEAR_LIFT_OFF` |
| 11:00:00 | Severe overload | Load exceeds rated chart capacity | `OVERLOAD` |
| 11:00:01 | Hydraulic pressure loss | Pressure is below 95% of expected pressure | `HYDRAULIC_PRESSURE_LOSS` |
| 12:18:40 | Load on a not-permitted chart combination | Valid chart inputs return no permitted capacity | `NOT_PERMITTED` |

Device-reported conditions:

| Timestamp | Condition | Detection Rule | Result |
|---|---|---|---|
| 12:30:00 | Wind alert | Wind exceeds 36 km/h | `WIND_ALERT` |
| 14:00:00 | LMI bypass | Status word bit 12 is set | `LMI_BYPASS` |
| 14:09:58 | LMI pre-warning episode | Computed utilization/status pre-warning condition | `LMI_PREWARNING` |
| 14:19:58 | LMI pre-warning episode | Computed utilization/status pre-warning condition | `LMI_PREWARNING` |
| 14:39:58 | LMI pre-warning episode | Computed utilization/status pre-warning condition | `LMI_PREWARNING` |
| 14:49:58 | LMI pre-warning episode | Computed utilization/status pre-warning condition | `LMI_PREWARNING` |

These four rows are impossible or invalid telemetry, not confirmed crane
failures:

| Timestamp | Invalid condition | Rule/outcome |
|---|---|---|
| 14:30:00 | Radius inconsistent with boom geometry | `DATA_QUALITY`; normal failure classification stops |
| 15:00:00 | Impossible boom-length change and inconsistent geometry | `DATA_QUALITY`; normal failure classification stops |
| 15:30:00 | Negative load and invalid deployed pad balance | `DATA_QUALITY`; normal failure classification stops |
| 17:00:00 | Invalid angle and inconsistent geometry | `DATA_QUALITY`; normal failure classification stops |

## 8. Missed Faults and Limitations

Module 2 does not independently detect timestamp or data-stream
continuity faults:

- The telemetry gap from 15:20:00 through 15:24:59; the next row is
  15:25:00.
- Repeated or backwards timestamps around 15:59:49.
- The subsequent timestamp jump to 16:00:02.

These are timestamp/data-stream issues, not confirmed crane failures. No
timestamp or dropout rule has been implemented.

Rate checks compare a current row with the previous row only when that
previous row has valid physical geometry, angle, load, and deployed-pad
balance. This prevents a valid current row from inheriting a false
rate-based `DATA_QUALITY` alarm from an invalid preceding row. Tests
check recovery rows at 15:00:01 and 17:00:01.

The supplied CSV contains no A2B status-bit rows, so `A2B_ALERT` is not
validated against a recorded A2B episode. Status word bit 7 is present
in the recording and the detector has a `DEVICE_OVERLOAD` path, but the
supplied regression assertions do not separately validate an isolated
device-overload alarm when no calculated overload is present.

## 9. Module Integration

The Failure Detector receives rows from the Module 1 playback path and
returns failure/alarm information for the Sensor and Alarm UI. The
playback failure integration test demonstrates that this connection is
implemented and passes.

The detector imports `craneModel.js` for the shared load-chart, kit, and
stability calculations, keeping Module 3 as the calculation source of
truth rather than duplicating those rules in Module 2.

---
## Module 3 — Stability & Load Chart Module + Tests

**Module Owner:** Sujal

### 1. Module Responsibility

The Stability & Load Chart Module provides the validated crane load-capacity and stability calculations used by the Cycle 3 Digital Twin.

Key responsibilities:

* Look up rated capacity for the Grove GMK5250L-1.
* Determine rated capacity using boom length, boom angle, working radius, and outrigger configuration.
* Handle full-outrigger and on-rubber operating conditions using the existing load-chart data.
* Interpolate between available load-chart values where required.
* Calculate crane stability using the existing tested stability implementation.
* Maintain a single source of truth for load-chart and stability calculations.
* Provide rated capacity and stability results to the Failure Detector and Sensor Panel.
* Maintain tests for chart lookup, interpolation, and stability calculations.

### 2. Load Chart

The module uses the existing Grove GMK5250L-1 load-chart implementation.

The lookup uses:

* Boom length
* Boom angle
* Working radius
* Outrigger configuration

The module uses the existing chart data rather than hard-coded capacity values in the Cycle 3 UI.

Where required, interpolation is performed between available chart values.

If the operating condition is not permitted by the load chart, the module returns `null`. The Sensor Panel displays this condition as **NOT PERMITTED**.

### 3. Stability Calculation

The module uses the existing tested stability implementation to determine the crane's stability condition.

Inputs include:

* Current load
* Working radius
* Slew angle
* Outrigger configuration
* Crane Centre of Gravity (CoG)
* Load position
* Outrigger support polygon

Coordinate convention:

```text
x = radius × cos(slew angle)
z = radius × sin(slew angle)
```

where `slew = 0°` represents the positive X direction.

The combined Centre of Gravity is evaluated relative to the outrigger support polygon to determine the stability condition.

### 4. Existing Stability Functions

The module reuses the existing tested stability functions rather than creating a second calculation:

* `pointInPolygon`
* `loadGroundPosition`
* `edgeDistanceM`
* `stabilityVerdict`
* `combinedCoG`
* `outriggerPolygonForSpread`

These functions form the authoritative stability calculation used by the other Cycle 3 modules.

### 5. Inputs

The module receives the current crane operating state, including:

* Load
* Boom length
* Boom angle
* Working radius
* Slew angle
* Outrigger state/configuration

During Cycle 3 playback, these values are supplied by the Playback & Clock module through the active telemetry state.

### 6. Outputs

The module provides:

* **Rated capacity**

  * Returns the calculated/validated capacity.
  * Returns `null` when the operating condition is not permitted.

* **Stability verdict**

  * Provides the result from the tested stability calculation.

* **Utilisation**

```text
Utilisation = Load / Rated Capacity
```

The Sensor Panel uses the shared rated-capacity result and does not maintain a separate load-chart calculation.

### 7. Testing

Dedicated tests cover:

* Load-chart lookup
* Valid reference points
* Load-chart interpolation
* Invalid/not-permitted conditions
* Full-outrigger conditions
* On-rubber conditions
* Load ground position
* Combined Centre of Gravity
* Outrigger support polygon
* Point-in-polygon calculation
* Edge distance
* Final stability verdict

The tests ensure that the load-chart and stability calculations are validated before being used by the Cycle 3 Failure Detector and Sensor Panel.

### 8. Module Integration

The Cycle 3 data flow is:

```text
Telemetry CSV
      ↓
Playback & Clock
      ↓
currentTelemetrySample
      ↓
Stability & Load Chart Module
      ↓
Rated Capacity / Stability Verdict
      ↓
Failure Detector / Sensor Panel
```

Module 3 does not control playback. It receives the current telemetry state and provides the validated load-chart and stability results required by the other modules.

### 9. Single Source of Truth

Module 3 is the single source of truth for rated capacity and stability calculations.

No duplicate load-chart lookup, interpolation, outrigger geometry, Centre of Gravity calculation, or stability calculation should be implemented inside:

* Failure Detector
* Sensor Panel
* 3D UI
* Page-level code

All modules must use the tested Module 3 calculations.

### 10. Real vs Faked

| Item                      | Source / Implementation                          | Status                 |
| ------------------------- | ------------------------------------------------ | ---------------------- |
| Rated capacity            | Existing Grove GMK5250L-1 load-chart module      | Computed               |
| Load-chart lookup         | Existing chart data and lookup logic             | Computed               |
| Load-chart interpolation  | Existing interpolation logic                     | Computed               |
| Full-outrigger capacity   | Existing load-chart module                       | Computed               |
| On-rubber capacity        | Existing load-chart module                       | Computed               |
| Working radius            | Cycle 3 telemetry / existing radius calculation  | Data-driven / Computed |
| Load position             | Existing stability calculation                   | Computed               |
| Combined CoG              | Existing stability module                        | Computed               |
| Outrigger support polygon | Existing stability geometry                      | Computed               |
| Stability verdict         | Existing tested stability module                 | Computed               |
| Utilisation               | Load / shared rated capacity                     | Computed               |
| Chart tests               | Module 3 test suite                              | Tested                 |
| Stability tests           | Module 3 test suite                              | Tested                 |
| Overload decision         | Failure Detector using Module 3 capacity         | Cycle 3 Integration    |
| Stability decision        | Failure Detector using Module 3 stability result | Cycle 3 Integration    |

### 11. Cycle 3 Integration Status

| Component                    | Source                             | Status               |
| ---------------------------- | ---------------------------------- | -------------------- |
| Grove GMK5250L-1 chart       | Existing validated chart module    | Existing             |
| Capacity lookup              | Existing chart module              | Existing             |
| Interpolation                | Existing interpolation logic       | Existing             |
| Stability geometry           | Existing stability module          | Existing             |
| Stability verdict            | Existing stability module          | Existing             |
| Chart tests                  | Module 3 test suite                | Existing / Validated |
| Stability tests              | Module 3 test suite                | Existing / Validated |
| Telemetry-driven inputs      | Module 1 — Playback & Clock        | Cycle 3 Integration  |
| Failure Detector integration | Module 2 — Failure Detector        | Cycle 3 Integration  |
| Sensor Panel integration     | Module 4 — Sensor Panel & Alarm UI | Cycle 3 Integration  |

---
## Module 4 — Sensor Panel & Alarm UI

**Module Owner: Abhishek**

(Paste this over the existing "Module 4" section of `Cycle-3/README.md`.)

### 1. Module Responsibility

The Sensor Panel & Alarm UI module shows the state of the crane and its alarms, and a 3D view of the crane. It only shows data. It does not calculate chart or stability values itself.

- Sensor panel from the active telemetry sample: load, boom angle, boom length, radius, slew, outrigger state, hydraulic pressure, wind, and the four pad reactions.
- Rated capacity, utilisation and stability verdict, taken from the failure detector's `derived` block, which gets them from Module 3 (`js/craneModel.js`, over the Cycle-2 chart and stability code). No second copy of chart or stability code: the kit constants, the radius formula, the support polygon and the ground position of the load are imported from `craneModel.js`.
- A **LIVE / MANUAL switch** in the control dock, and a **LIVE (telemetry) / MANUAL (override)** badge that is always visible. In LIVE the dock shows only the playback controls (play / pause, speed, position, jump) and no sliders. In MANUAL it shows only the sliders and no playback controls; the recording is paused, the badge turns amber and alarms are labelled SIMULATED. The LIVE button (or "Return to LIVE" in the header) goes back and carries on from the same row.
- A **data-quality** badge: `OK` / `STALE` (dropout or repeated timestamp) / `BAD DATA` (an impossible row). BAD DATA and STALE are shown as data problems, never as crane failures.
- **NO DATA · dropout in progress**: the clock follows the CSV's own `ts`, so inside the 15:20:00–15:24:59 gap it publishes nothing. The panel then says NO DATA, counts the seconds up to the next sample, and greys the sensor values (they are the last ones received).
- An **alarm list**: one latched entry per alarm episode, with the alarm type, the triggering value, the rule that fired and the **first timestamp** at which it became true. Active alarms are highlighted, cleared ones greyed.
- Device chips from `status_word` and wind: WIND ALERT, LMI BYPASS, LMI PRE-WARN, A2B.
- **NOT PERMITTED** instead of a number when the chart has no capacity.
- A 3D view (`js/crane3d.js`) driven by the same sample: boom length and angle, slew, outrigger deployment, hook height, and a load that **sways with the wind**.
- A list of clock faults in the CSV (file order): the 15:20–15:25 dropout and the repeated / backwards timestamps.
- A **Jump to** list that is *derived*, not typed: when the page loads, the recording is scanned once with the same detector and alarm log as the playback, and every alarm episode is listed with its true first timestamp. (A live feed has no such list; there the alarm log simply fills as rows arrive.)

Look and feel: dark graphite, off-white, crane yellow; the CSS variables `--dark-surface`, `--crane-yellow`, `--green-ok`, `--amber`, `--red-crit`.

### 2. Files

| File | What it does |
|---|---|
| `simulator.html` | The page: sensors, 3D view, LIVE / MANUAL switch with its playback controls and sliders, alarm list, clock faults |
| `js/panelModel.js` | Logic, no DOM: analyses a sample, keeps the alarm log, builds the text and colour of every element, `dropoutStatus` (NO DATA), `buildEventIndex` (the Jump list) |
| `js/panel.js` | Draws the model into the page (`textContent` only) |
| `js/dataQuality.js` | OK / STALE / BAD DATA rules and the file-order clock-fault scan |
| `js/crane3d.js` | 3D crane (view only) and the wind sway |
| `crane3d-demo.html` | Stand-alone page for the 3D view |
| `js/test_sensorPanelUI.mjs`, `test_dataQuality.mjs`, `test_crane3d.mjs` | Tests |

### 3. Inputs (interfaces with other modules)

- Module 1 (Ajit): `PlaybackClock` (`currentIndex`, `playing`, `rate`, `jumpTo`, `setManual`, `setLive`, `pushManualSample`) and `parseCSV`. The clock advances by the real `ts` gap between rows.
- Module 2 (Rushikesh): `detectFailures(sample, previousSample)` and `expectedHydraulicPressure`. The panel uses its alarms as they are (OVERLOAD, STABILITY_LOSS, OUTRIGGER_LIFT_OFF / NEAR_LIFT_OFF, HYDRAULIC_PRESSURE_LOSS, IMPROPER_OUTRIGGER_DEPLOYMENT, NOT_PERMITTED, WIND_ALERT, LMI_BYPASS, LMI_PREWARNING, LMI_DIVERGENCE, DEVICE_OVERLOAD, A2B_ALERT, DATA_QUALITY) and only classifies and words them.
- Module 3 (Sujal): `craneModel.js` (`KIT`, `radiusFromAngle`, `supportPolygon`, `loadGroundPosition`); the chart and stability numbers themselves reach the panel through the detector.

What the panel does before calling the detector:

- A blank `lmi_pct` is `NaN`. The shared `parseCSV` now gives `NaN` for an empty cell. (It used to give `0`, which the detector read as "device LMI 0 %" and raised 109 false LMI_DIVERGENCE alarms at 12:18–12:19. The panel still treats a `0` with a real load on the hook as blank, so it works with either version of `parseCSV`.)
- The previous row is passed only if it is itself a valid row, so the row after a glitch (15:00:01, 17:00:01) is not blamed for the glitch.
- In MANUAL mode the pad columns are not simulated. The detector gets an even split of (machine mass `KIT.MACHINE_MASS_T` + load) so its pad checks stay silent, and the panel shows the pads as "not simulated".

### 4. Behaviour Rules

- Every field is bound to the sample on screen. There are no static placeholders.
- Alarms are latched: one entry per episode, not one per second. When the playback arrives by a jump, the first timestamp is found by looking back to the true start of the episode, so it is the same at 1×, 10×, 50×, 100× and after a jump.
- A BAD DATA row suppresses crane alarms on that row and shows a data-problem entry instead; a STALE row (dropout, repeated timestamp) shows a STALE entry.
- `lmi_pct` blank and chart null → "NOT PERMITTED" in red, with no made-up percentage.
- MANUAL entries carry the tag SIMULATED. While MANUAL is on, the real alarms of the row you left are greyed; back in LIVE the same entries carry on (one entry each, with the true first timestamp, no second copy). The SIMULATED entries stay greyed as history.
- The **Jump to** list comes from `buildEventIndex` (a scan of the recording by the detector), not from times typed into the page. Dropouts stop on the last row before the gap, so Play shows the NO DATA state.

### 5. Testing

```
node Cycle-3/js/test_sensorPanelUI.mjs     # 125 checks
node Cycle-3/js/test_dataQuality.mjs       # 37 checks
node Cycle-3/js/test_crane3d.mjs           # 51 checks
```

`test_sensorPanelUI.mjs` runs the real kit CSV through the real detector, and passes with the current `parseCSV` and with a fixed one. It checks that each field changes with the sample, the mode badge, the alarm list (type, value, rule, first timestamp, no repeats, same first timestamp at any playback speed), blank LMI, NOT PERMITTED, BAD DATA, STALE, device conditions, pads, the whole day at 3 rows per frame (23 entries), the NO DATA state during a dropout, the derived Jump list (true first timestamps), what is passed to the detector, and that nothing throws. The page itself was checked in a headless browser (26 checks, no console errors): what is visible in LIVE (playback only) and in MANUAL (sliders only), the derived Jump list, MANUAL ↔ LIVE, overload, BAD DATA, NOT PERMITTED, wind, and playing into the dropout.

Whole-day alarm log (23 entries; the two single-row LMI divergence entries at 12:18:00 and 12:19:50 are where the device is blank but our chart still gives 41.4 t, see the fault list, A6. With the old `parseCSV`, which read a blank as 0, the log had 21 entries): improper deployment 07:03:00 · overload 09:00:00 · overload + LMI divergence 09:50:00 · near lift-off 10:25:20 · overload 11:00:00 · hydraulic loss 11:00:01 · NOT PERMITTED 12:18:40 · wind 12:30:00 · LMI bypass 14:00:00 · pre-warning ×4 (14:09:58, 14:19:58, 14:39:58, 14:49:58) · BAD DATA ×4 (14:30:00, 15:00:00, 15:30:00, 17:00:00) · dropout 15:25:00 · repeated timestamp 15:59:49 · dropout 16:00:02.

### 6. Real vs Faked

| Feature | Source | Status |
|---|---|---|
| Load, boom length / angle, radius, slew | CSV row (Module 1) | **Real** |
| Outrigger state, pad reactions | CSV row | **Real** |
| Hydraulic pressure, wind speed | CSV row | **Real** |
| Rated capacity, utilisation | Cycle-2 chart via the detector | **Real** (the chart is ours; one cell, 70 m / 30 m, is unchecked against the PDF) |
| Stability verdict | Cycle-2 stability via the detector, kit centre of gravity | **Real** |
| Alarm list | Module 2 detector | **Real** |
| First timestamps, latching | computed from the recording | **Real** |
| Data quality (STALE, BAD DATA) | rules on the recording | **Real** (thresholds are our own: 2 s gap, 0.1 m radius, 0.5 m hook, 0–85° angle) |
| Device chips (bypass, pre-warn, A2B) | `status_word` | **Real** |
| MANUAL values | slider input | **Simulated.** Radius and hook height come from the boom formulas; pressure from the kit formula; pads, device LMI and status word are not simulated |
| 3D crane geometry, boom, slew, outriggers | drawn from the sample | **Visual only.** Proportions are approximate, not the Grove drawing |
| Hook / load position | drawn from the sample | **Visual only.** The hook hangs at the boom tip (the kit does not model rope pay-out) |
| **Wind sway of the load** | wind speed is real; the lean angle, swing period and direction are **assumed** | **Faked.** Lean grows with wind² (5° at the 36 km/h alert, 7.8° at 45 km/h, capped at 12°), a swing of 60 % of the lean around it with a 5 s period, a smaller cross-wind swing, direction fixed. It is a picture of "wind is strong", not a calculation of wind load |
| Pads in MANUAL | none | **Not simulated** (shown as "—") |

### 7. Known limits

- The NO DATA seconds are an estimate (wall time × playback rate): the clock does not publish its position inside a gap. It is for display only; the alarm log and the first timestamps never use it.
- The detector gets one row at a time and has no time rule, so it does not report a dropout, a repeated or a backwards timestamp. Module 4 reports them (`dataQuality.js`: STALE). See the fault list, class C.
- `parseCSV` sorts by `ts`, so the backwards step 15:59:59 → 15:59:49 is not visible in the sorted rows. Module 4 finds it from the raw file text in file order (`scanClockFaults`).
- The 12:18:00 and 12:19:50 rows (boom 45.6 m, radius 10.00 m): the chart gives 41.4 t, the device LMI is blank. Open question for Module 3: is r = 10 m permitted for this boom?
- In MANUAL the pads, the device LMI and the status word are not simulated.
