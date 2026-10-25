# Cycle 3 — Mobile Crane Digital Twin

## Consolidated Real vs Faked and source-verification status

| Area | Source or implementation | Status |
|---|---|---|
| Recorded telemetry | `data/mobile-telemetry-2026-09-16.csv` | Real recording; pad reactions retain the legacy 8.9 m Z fixture |
| Load chart | [Local official PDF](../Cycle-2/js/Grove-GMK5250L-1-load-chart.pdf), page 17; [official Manitowoc source](https://www.manitowoc.com/media/15016/download) | The 70 m / 30 m cell is 12.1 t on PDF page 17; other cells are not all independently verified |
| Outrigger geometry | Manufacturer PDF, page 13; `js/craneModel.js` | Verified: X = 7.8 m, Z = 8.95 m; pads X ±3.9 m, Z ±4.475 m |
| Stability, pad reactions, alarms, data quality | Cycle 3 model and detector rules | Computed from the current implementation and tested |
| Manual controls and wind sway | Cycle 3 UI assumptions | Simulated or visual-only; not manufacturer telemetry |
| Frozen-sensor detection | `createProductionFrozenSensorTracker()` in `js/dataQuality.js` and the sequential panel path | Enabled for the documented provisional mappings; the sensor-to-motion mapping and 3 s interval remain TEAM assumptions pending authoritative confirmation |
| Critical / near-lift-off thresholds | `KIT.PAD_LIFT_OFF_T` and `KIT.PAD_NEAR_LIFT_T` in `js/craneModel.js` | 0.1 t is the mentor-requested critical boundary; 5 t remains the existing warning rule; neither is claimed as manufacturer-approved |

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

### 7. Module 1 source notes

Telemetry fields and status words are read from the recording. Playback uses
the recorded timestamps and preserves file order for clock-fault analysis;
playback-rate scaling and MANUAL samples are simulated UI behavior. The
consolidated Real vs Faked and source-verification table at the top is the
authoritative summary for these classifications.

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
- A finite deployed pad reaction at or below 0.1 t produces critical
  `OUTRIGGER_LIFT_OFF`; a finite reaction above 0.1 t and below 5 t produces
  warning `OUTRIGGER_NEAR_LIFT_OFF`. Missing or non-finite reactions produce
  `DATA_QUALITY`, not a confirmed lift-off. These are team/model thresholds,
  with 0.1 t requested by the mentor and not claimed as manufacturer-approved.

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

- The shared `statusBitSet()` helper in `js/craneModel.js` is the only status-word decoder.
  The detector and panel use it for the existing device bits. Bits 0–3 are verified
  only as a coarse motion-active group for the outrigger-deployment rule; the
  repository does not identify which bit belongs to boom telescope, luff, slew,
  hoist, or another sensor.
- Frozen-sensor detection is enabled in the production panel/data-quality path.
  `createFrozenSensorTracker()` accepts an explicit bit-to-field mapping and
  duration, then safely resets on inactive motion, value changes, invalid values,
  invalid/duplicate timestamps, and gaps, and emits one `FROZEN_SENSOR` issue per
  continuing candidate. The production factory uses only the provisional
  one-to-one mappings in `KIT.FROZEN_SENSOR_MAPPINGS` (boom length → bit 0,
  boom angle → bit 1, slew → bit 2) and the 3 s TEAM interval.
- The supplied CSV contains status values and event labels but no authoritative
  mapping from bits 0–3 to sensor fields and no approved frozen interval/noise
  threshold. The provisional configuration deliberately does not assume every
  sensor changes for every active motion bit. Mentor/module-owner confirmation
  is still required before treating those mappings or duration as verified.
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
  - **86 passed, 0 failed**.
- `node Cycle-3/js/test_playback_failure_integration.mjs`
  - Playback sample delivery, overload, pressure-loss, stability
    suppression, parked-crane, and invalid-row checks pass.
- `node Cycle-3/js/test_playbackClock.mjs`
  - **74 passed, 0 failed**.

## 6. Module 2 source notes

The detector consumes recorded telemetry and shared Module 3 calculations.
It classifies overload, stability, pad, hydraulic, deployment, device, and
data-quality conditions; it does not create additional simulated telemetry.
The consolidated table at the top is the single Real vs Faked summary.

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

#### Cross-check against the manufacturer PDF (review items 1 and 2)

`loadchart.js` cites `https://www.manitowoc.com/media/15016/download`. The original
response is stored beside the chart as
`../Cycle-2/js/Grove-GMK5250L-1-load-chart.pdf`. The 70 m / 30 m cell is
12.1 t on PDF page 17. Other cells are not all independently verified.

* Page 17 — *Telescopic boom*, `13,3 – 70,0 m | 7,8 m | 360 ° | 80 t | EN 13000`, which is exactly the configuration `CHART.config` declares.
* The repository explicitly records the 70 m / 30 m cross-check below.
  The remaining chart cells should not be treated as independently verified
  solely from this project documentation.

**Item 1 — radius 10.00 m at boom 45.6 m (12:18:00 and 12:19:50).** Yes, r = 10 m **is** allowed for this boom length.

| PDF, radius 10 m | 42,3 m | **45,4 m** | **48,9 m** | 52,4 m | 56,2 m | 60,5 m | 64,6 m → 70,0 m |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Rated capacity | 47.5 t | **42.5 t** | **37.0 t** | 31.0 t | 26.0 t | 21.5 t | blank |

* 45.6 m lies between the PDF's 45,4 m and 48,9 m boom columns, and **both** have a value at r = 10 m, so the combination is inside the permitted region — no blank cell is interpolated across.
* The PDF's own minimum permitted radius grows with boom length: 45,4 m boom → 7 m, 48,9 m → 8 m, 52,4 m → 9 m. At 10 m there is margin.
* Our coarser 5-row table interpolates between 38 m (53.0 t) and 52,4 m (31.0 t) and returns **41.4 t**; interpolating the PDF's finer columns gives 42.2 t. Both say *permitted*; the 0.8 t difference is only the boom-grid coarseness.
* The detector therefore reports **NORMAL** on both rows: capacity 41.4 t, load 0 t, utilisation 0 %.

The blank device LMI on those two rows is a reporting artefact, not a chart restriction. Over the whole 39,301-row recording the device and our chart agree on *permitted* in 39,189 rows and on *not permitted* in 109 rows, and disagree in exactly **2** rows — 12:18:00 and 12:19:50, both at exactly r = 10.00 m with load 0. The device blanks its LMI for the whole excursion 12:18:00 → 12:19:50 (111 rows), which drives in from boom 45,60 m / r 10,00 m to boom 52,40 m / r 8,00 m and back out; the two permitted boundary rows are blanked together with the 109 genuinely not-permitted rows. The only window the PDF also refuses is 12:18:40 – 12:19:10 (31 rows, boom 52,40 m, r < 10 m), and it raises `NOT_PERMITTED` (F5) as intended.

**Item 2 — 70 m boom / 30 m radius.** The PDF gives **12.1 t**, our table had 12.4 t. The number sits in the `70,0 m` column of the `30,0 m` radius row (12,3 t at 66,9 m, 11,4 t at 32 m), so 12,1 is unambiguous. The table cell and its validation cell were corrected **12.4 t → 12.1 t** — the old value was 0.3 t (2.5 %) optimistic, which is the dangerous direction for a rated capacity. No alarm changes: the only boom-70 row in the recording is the impossible 15:00 row, which is outside the chart radius range anyway. Only the checked cell is claimed as verified; remaining cells require independent source review.

Two honest limitations of the 5 × 7 table, both *conservative* (they can only under-state capacity, never over-state it):

* The null at 52,4 m / 8 m makes the whole 8–10 m radius band not-permitted for booms above 38 m, because we never interpolate across a null cell. The device agrees on all 109 of those rows; the PDF's finer grid would allow some of them (e.g. 45,4 m boom permits down to 7 m).
* The only row where the chart says `null` but the device still shows an LMI is 14:30:00 — one of the three impossible rows (radius 40 m with a 32 m boom).

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

### 7. Files

| File | Purpose |
| --- | --- |
| `js/craneModel.js` | The module itself: kit constants, chart lookup, centre of gravity, pad reactions, stability verdict. |
| `js/test_craneModel.mjs` | Its test suite (`node js/test_craneModel.mjs`). |

`craneModel.js` re-exports the Cycle 2 primitives (`CHART`, `ratedCapacity`, `radiusFromAngle`, `pointInPolygon`, `loadGroundPosition`, `edgeDistanceM`, `stabilityVerdict`, `combinedCoG`, `outriggerPolygonForSpread`) and adds the sample-level API the rest of Cycle 3 calls:

```text
capacityFor(sample)       -> { capacityT, capacityInputsValid, utilization }
stabilityFor(sample)      -> { stability, stabilityInputsValid, cog, polygon }
padReactionsFor(sample)   -> { FL, FR, RL, RR, deployed, computed }
kitCombinedCoG(sample)    -> { x, z, totalT }
supportPolygon()          -> the four pad positions as a ring
craneStateFor(sample)     -> all of the above in one call
```

### 8. Testing

`js/test_craneModel.mjs` imports **only** from `craneModel.js` — the same module the Failure Detector imports — and checks the model against the real recording instead of against hand-typed numbers.

| # | Check | Result |
| --- | --- | --- |
| 1 | Chart: exact cells, interpolation, null / not-permitted cells, out-of-range, `F1` (38 m / 12 m → 47.5 t, 109.47 %), `F5` (52.4 m / 8 m → `null`) | PASS |
| 2 | Geometry: `radiusFromAngle` vs the recorded `radius_m` on all 39,301 rows — only the 3 impossible rows (14:30, 15:00, 17:00) disagree; every other row matches within 0.01 m | PASS |
| 3 | Pad model vs recorded pads on all 31,860 `DEPLOYED` rows — 31,804 rows match within 0.05 t, worst residual **0.02427 t**; the 56 outliers are exactly the 54-row 10:25:01–10:25:54 window plus the impossible rows 14:30 and 15:30 | PASS |
| 4 | Pad sum balances `170 t + load` on every row except the impossible 15:30 row | PASS |
| 5 | Stability verdict: idle → `ok`, retracted → `ok`, missing geometry → `null`, 100 t at 30 m → `tipping`, and the five former `STABILITY_LOSS` false-alarm rows → not `tipping` | PASS |
| 6 | `craneStateFor` returns capacity, utilisation, verdict, CoG, pads and polygon together; `F5` returns `null` capacity and `null` utilisation | PASS |
| 7 | Single source of truth: `failureDetector.js` imports `./craneModel.js`, has no direct Cycle 2 import, no local CoG / chart / spread copy, and no other Cycle 3 file reaches past Module 3 | PASS |

Run the whole suite:

```bash
cd Cycle-3/js
node test_craneModel.mjs
node test_failureDetector.mjs
node test_telemetry.mjs
node test_playbackClock.mjs
node test_playback_failure_integration.mjs
```

Latest run: **83 passed, 0 failed** for Module 3; the Module 1, Module 2 and integration suites still pass, and the full-recording alarm counts are unchanged by this module (1,019 alarm instances over 707 flagged samples, out of 39,301 rows).

### 9. Module Integration

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

### 10. Single Source of Truth

Module 3 is the single source of truth for rated capacity and stability calculations.

No duplicate load-chart lookup, interpolation, outrigger geometry, Centre of Gravity calculation, or stability calculation is implemented inside:

* Failure Detector
* Sensor Panel
* 3D UI
* Page-level code

This is enforced, not just intended. `failureDetector.js` imports `KIT`, `capacityFor`, `stabilityFor`, `padReactionsFor` and `radiusFromAngle` from `./craneModel.js`; it no longer imports Cycle 2 directly and no longer keeps its own centre-of-gravity, chart or outrigger-spread copy. Test 7 in `test_craneModel.mjs` fails if any Cycle 3 module reaches around Module 3.

### 11. Module 3 source notes

The chart, stability, geometry, pad-reaction, and interpolation details are
implemented and tested in `js/craneModel.js` and the Cycle 2 primitives it
re-exports. The checked manufacturer cells and all unverified-source caveats
are listed in the consolidated table at the top; this section retains the
technical implementation and integration explanations without repeating the
classification table.

### 12. Cycle 3 Integration Status

| Component | Source | Status |
| ---------------------------- | ---------------------------------- | -------------------- |
| Grove GMK5250L-1 chart | `Cycle-2/js/loadchart.js` via `craneModel.js` | Done |
| Capacity lookup + interpolation | `capacityFor()` | Done, tested |
| Null / not-permitted handling | `capacityFor()` | Done, tested |
| Kit centre of gravity | `kitCombinedCoG()` | Done, tested against the recording |
| Pad reactions | `padReactionsFor()` | Done, tested against the recording |
| Stability geometry + verdict | `supportPolygon()`, re-exported `stabilityVerdict()` | Done, tested |
| Chart tests | `js/test_craneModel.mjs` | 86 passed / 0 failed |
| Stability tests | `js/test_craneModel.mjs` | 86 passed / 0 failed |
| Telemetry-driven inputs | Module 1 — Playback & Clock | Done — `currentTelemetrySample` → `capacityFor()` / `stabilityFor()` |
| Failure Detector integration | Module 2 — Failure Detector | Done — uses `capacityFor()`, `stabilityFor()`, `padReactionsFor()` from `./craneModel.js` |
| Sensor Panel integration | Module 4 — Sensor Panel & Alarm UI | Done — panel interface is `KIT`, `radiusFromAngle()`, `supportPolygon()`, `loadGroundPosition()` |

Notes on the two integration rows:

* The Failure Detector also imports `KIT` and `radiusFromAngle()` from the same module: `KIT` for the kit constants in its validation rules and `radiusFromAngle()` for the radius-consistency check. Its deployment-dependent pad rules are gated on `padReactionsFor(sample).deployed`, and it exposes the twin's computed reactions as `derived.padsModel` next to the recorded `derived.pads`, so recorded and modelled pads can be compared.
* The four names in the Sensor Panel row are exactly what `craneModel.js` exports for Module 4 — none of them is renamed or duplicated anywhere in Cycle 3. Panel wiring itself lives in Module 4.

---
## Module 4 — Sensor Panel & Alarm UI

**Module Owner: Abhishek**

### 1. Module Responsibility

The Sensor Panel & Alarm UI module shows the state of the crane and its alarms, and a 3D view of the crane. It only shows data. It does not calculate chart or stability values itself.

- Sensor panel from the active telemetry sample: load, boom angle, boom length, radius, slew, outrigger state, hydraulic pressure, wind, and the four pad reactions.
- Rated capacity, utilisation and stability verdict, taken from the failure detector's `derived` block, which gets them from Module 3 (`js/craneModel.js`, over the Cycle-2 chart and stability code). No second copy of chart or stability code: the kit constants, the radius formula, the support polygon and the ground position of the load are imported from `craneModel.js`.
- A **LIVE / MANUAL switch** in the control dock, and a **LIVE (telemetry) / MANUAL (override)** badge that is always visible. In LIVE the dock shows only the playback controls (play / pause, speed, position, jump) and no sliders. In MANUAL it shows only the sliders and no playback controls; the recording is paused, the badge turns amber and alarms are labelled SIMULATED. The LIVE button (or "Return to LIVE" in the header) goes back and carries on from the same row.
- A **data-quality** badge: `OK` / `STALE` (dropout, repeated timestamp, or a frozen sensor) / `BAD DATA` (an impossible row). BAD DATA and STALE are shown as data problems, never as crane failures.
- **NO DATA · dropout in progress**: the clock follows the CSV's own `ts`, so inside the 15:20:00–15:24:59 gap it publishes nothing. The panel then says NO DATA, counts the seconds up to the next sample, and greys the sensor values (they are the last ones received).
- An **alarm list**: one latched entry per alarm episode, with the alarm type, the triggering value, the rule that fired and the **first timestamp** at which it became true. Active alarms are highlighted, cleared ones greyed.
- Device chips from `status_word` and wind: WIND ALERT, LMI BYPASS, LMI PRE-WARN, A2B.
- Every alarm is classed as **critical** (a crane failure), **warning** (a device condition or an early warning) or **data** (a problem with the data, not the crane). See the table in §4.
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
| `js/dataQuality.js` | OK / STALE / BAD DATA rules and the file-order clock-fault scan. Also holds the frozen-sensor tracker (`createFrozenSensorTracker`, `createProductionFrozenSensorTracker`): written by Rushikesh (`ab5e6b6`, `81d84cc`); in this commit it reports a frozen sensor as a STALE data issue, on every row while the freeze lasts, using the bits and duration in `KIT` |
| `js/crane3d.js` | 3D crane (view only) and the wind sway |
| `crane3d-demo.html` | Stand-alone page for the 3D view |
| `js/test_sensorPanelUI.mjs`, `test_dataQuality.mjs`, `test_crane3d.mjs` | Tests |

### 3. Inputs (interfaces with other modules)

- Module 1 (Ajit): `PlaybackClock` (`currentIndex`, `playing`, `rate`, `jumpTo`, `setManual`, `setLive`, `pushManualSample`) and `parseCSV`. The clock advances by the real `ts` gap between rows.
- Module 2 (Rushikesh): `detectFailures(sample, previousSample)` and `expectedHydraulicPressure`. The panel uses the alarms as they are (OVERLOAD, STABILITY_LOSS, OUTRIGGER_LIFT_OFF / NEAR_LIFT_OFF, HYDRAULIC_PRESSURE_LOSS, IMPROPER_OUTRIGGER_DEPLOYMENT, NOT_PERMITTED, FROZEN_SENSOR, WIND_ALERT, LMI_BYPASS, LMI_PREWARNING, LMI_DIVERGENCE, DEVICE_OVERLOAD, A2B_ALERT, DATA_QUALITY) and only classifies and words them.
- Module 3 (Sujal): `craneModel.js` (`KIT`, `SAFETY_LIMITS`, `expectedHookHeightM`, `radiusFromAngle`, `supportPolygon`, `loadGroundPosition`); the chart and stability numbers themselves reach the panel through the detector. The data-quality limits (85° angle limit, motion-rate limits, hook-height formula and minimum, radius / hook / pad-sum tolerances) are `SAFETY_LIMITS` constants in `craneModel.js`: `dataQuality.js` and the detector both import them, so neither keeps its own copy.

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
node Cycle-3/js/test_sensorPanelUI.mjs     # 144 checks
node Cycle-3/js/test_dataQuality.mjs       # 51 checks
node Cycle-3/js/test_crane3d.mjs           # 51 checks
```

`test_sensorPanelUI.mjs` runs the real kit CSV through the real detector, and passes with the current `parseCSV` and with a fixed one. It checks that each field changes with the sample, the mode badge, the alarm list (type, value, rule, first timestamp, no repeats, same first timestamp at any playback speed), blank LMI, NOT PERMITTED, BAD DATA, STALE, device conditions, pads (the 0.02 t pad at 10:25:27 is red), the whole day at 3 rows per frame (35 entries), the NO DATA state during a dropout, the derived Jump list (true first timestamps), the classification of the review alarms (a frozen sensor is STALE and the real alarm on the same row stays, lift-off keeps one near-lift-off entry, blank LMI, with a stub detector), the frozen-sensor tracker on the real file (11 windows, none at 07:03 or in the dropout), and that nothing throws. The page itself was checked by hand in a browser (LIVE shows playback only, MANUAL shows sliders only, the Jump list, MANUAL and back, overload, BAD DATA, NOT PERMITTED, wind, the lift-off at 10:25:27, the LMI blank at 12:18:00, playing into the dropout); that check is not automated and is not part of the repo.

Whole-day alarm log (35 entries): improper deployment 07:03:00 · overload 09:00:00 · overload + LMI divergence 09:50:00 · near lift-off 10:25:20 · lift-off 10:25:27 · overload 11:00:00 · hydraulic loss 11:00:01 · NOT PERMITTED 12:18:40 · wind 12:30:00 · LMI bypass 14:00:00 · pre-warning ×4 (14:09:58, 14:19:58, 14:39:58, 14:49:58) · data problems: BAD DATA ×4 (14:30:00, 15:00:00, 15:30:00, 17:00:00), LMI BLANK ×2 (12:18:00, 12:19:50), dropout 15:25:00, repeated timestamp 15:59:49, dropout 16:00:02, frozen sensor ×11 (09:00:10, 09:50:10, 10:25:10, 11:00:10, 12:18:50, 12:30:10, 14:00:10, 14:10:10, 14:20:10, 14:40:10, 14:50:10). With the old `parseCSV` (blank read as 0) the two LMI BLANK entries are missing.

### 6. Real vs Faked

See the single table at the top of this README. The Module 4 rows are: panel fields (real), alarm list (real), classification (our own rule), data-quality limits (from `SAFETY_LIMITS`), MANUAL values (simulated), 3D geometry and hook position (visual only), wind sway (faked, assumed numbers).

### 7. Known limits

- The NO DATA seconds are an estimate (wall time × playback rate): the clock does not publish its position inside a gap. It is for display only; the alarm log and the first timestamps never use it.
- The detector gets one row at a time and has no time rule, so it does not report a dropout, a repeated or a backwards timestamp. Module 4 reports them (`dataQuality.js`: STALE). See the fault list, class C.
- `parseCSV` sorts by `ts`, so the backwards step 15:59:59 → 15:59:49 is not visible in the sorted rows. Module 4 finds it from the raw file text in file order (`scanClockFaults`).
- The 12:18:00 and 12:19:50 rows (boom 45.6 m, radius 10.00 m): the chart gives 41.4 t, the device LMI is blank. Module 3 §2 says r = 10 m is a charted cell for this boom, so the chart is right and the device is at an edge; the panel shows it as a data issue (LMI BLANK).
- The 11 frozen-sensor windows all lie inside the lift windows of the real events (09:00, 09:50, 10:25, 11:00, 12:18:40, 12:30, 14:00, 14:10, 14:20, 14:40, 14:50): the status word says telescope, luff and slew are running while the three readings do not change. In this synthetic file we cannot tell a deliberate sensor freeze from the generator holding the boom still while it keeps the motion bits on. The rule is justified by what it separates (ordinary stalls last at most 2 s, these windows 30 s or more), and it is reported as a data problem, not as a crane failure.
- In MANUAL the pads, the device LMI and the status word are not simulated.
