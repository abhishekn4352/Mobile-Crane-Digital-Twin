# Cycle 3 — Mobile Crane Digital Twin

## Module 1 — Playback & Clock

**Module Owner:** Ajit

### 1. Module Responsibility

The Playback & Clock module is responsible for loading, parsing, and streaming the crane telemetry data (CSV) across a time-based playback engine.

Key responsibilities include:

- Reading and parsing the recorded telemetry CSV file.
- Managing playback clock based on the telemetry timestamps (`ts`).
- Providing play/pause controls and speed multiplier adjustments (`1x`, `10x`, `50x`, `100x`).
- Maintaining the active Telemetry State for downstream modules.
- Handling the `LIVE` vs `MANUAL` operating mode toggle:
  - **LIVE Mode:** Crane state is driven strictly by telemetry timestamp progression.
  - **MANUAL Mode:** Telemetry stream pauses and user UI sliders gain control.

### 2. Telemetry Parsing & Clock Mechanics

- Parse incoming CSV row-by-row containing: `timestamp`, `load`, `boom_length`, `boom_angle`, `slew_angle`, `outrigger_state`, `hydraulic_pressure`.
- Step through telemetry data frame-by-frame aligned with standard timer intervals.
- Expose the active `currentTelemetrySample` state object to Failure Detector, Stability/Loadchart, and UI panels.

### 3. Playback Controls & Modes

- **Controls:** Play, Pause, Reset, Jump to Timestamp.
- **Playback Rates:** `1x` (Real-time), `10x`, `50x`, `100x` fast-forward.
- **Mode Toggle:**
  - `LIVE`: Read-only telemetry stream driving the simulator.
  - `MANUAL`: Interactive override using UI sliders.

### 4. Testing

A dedicated test file will be maintained:

`js/test_playbackClock.mjs`

Tests will cover:
- CSV parsing accuracy and error handling.
- Timestamp ordering and frame-stepping logic.
- Playback speed calculations and clock drift prevention.
- Seamless state switching between `LIVE` and `MANUAL` modes.

### 5. Module Integration

The Playback & Clock module serves as the central data provider (Telemetry Pipeline) for the entire Digital Twin architecture:

`CSV File -> Playback Engine -> Telemetry State -> Shared Calculations / Failure Detector / 3D & UI`

---

## Module 2 — Failure Detector

**Module Owner:** Rushikesh

### Module Responsibility

The Failure Detector monitors the crane telemetry data and identifies
abnormal operating conditions during playback.

The detector will check the failure modes specified for Cycle 3:

- Overload against the crane load chart
- Outrigger lift-off / loss of stability
- Hydraulic pressure loss
- Improper outrigger deployment

Each alarm will report:

- The type of failure
- The telemetry value that triggered it
- The rule or threshold that was violated
- The timestamp at which the failure occurred

## 2. Telemetry Inputs

The Failure Detector will use the telemetry values supplied by the
Cycle 3 recording:

- Load
- Boom length
- Boom angle
- Working radius
- Outrigger state
- Hydraulic pressure

The detector will use the existing tested chart and stability modules
where required instead of creating duplicate calculations.

## 3. Detection Rules

### Overload

Compare the current crane load with the rated capacity obtained from
the existing load-chart module.

**Rule:** To be implemented and validated against the Cycle 3 telemetry.

### Stability / Outrigger Lift-off

Use the existing stability calculation to determine whether the crane
remains within its supported/stable region.

**Rule:** To be implemented and validated against the Cycle 3 telemetry.

### Hydraulic Pressure Loss

Monitor hydraulic pressure from the telemetry stream and identify
pressure loss according to the defined operating threshold.

**Rule:** To be implemented and validated against the Cycle 3 telemetry.

### Improper Outrigger Deployment

Check the telemetry outrigger state and identify conditions where the
required outrigger deployment is not present.

**Rule:** To be implemented and validated against the Cycle 3 telemetry.

## 4. Alarm Output

When a failure is detected, the detector will provide information that
can be displayed by the Sensor and Alarm UI.

The alarm information will include:

- Failure type
- Triggering value
- Detection rule
- Telemetry timestamp

## 5. Testing

A dedicated test file will be maintained:

`js/test_failureDetector.mjs`

Tests will cover normal conditions and each supported failure mode.

Test results will be added here after implementation.

## 6. Real vs Faked

| Feature | Source | Status |
|---|---|---|
| Load | Cycle 3 telemetry | To be validated |
| Boom length | Cycle 3 telemetry | To be validated |
| Boom angle | Cycle 3 telemetry | To be validated |
| Working radius | Telemetry / calculation | To be validated |
| Outrigger state | Cycle 3 telemetry | To be validated |
| Hydraulic pressure | Cycle 3 telemetry | To be validated |
| Rated capacity | Existing load-chart module | To be validated |
| Stability result | Existing stability module | To be validated |
| Overload alarm | Failure Detector | To be implemented |
| Stability alarm | Failure Detector | To be implemented |
| Hydraulic pressure alarm | Failure Detector | To be implemented |
| Outrigger deployment alarm | Failure Detector | To be implemented |

## 7. Faults Found in Telemetry Recording

This section will be completed after running the Failure Detector
against the supplied Cycle 3 telemetry recording.

| Timestamp | Fault | Detection Rule | Result |
|---|---|---|---|
| To be determined | To be determined | To be determined | To be determined |

## 8. Missed Faults

Any faults that are present in the recording but not detected by the
Failure Detector will be documented here after validation.

## 9. Module Integration

The Failure Detector is designed as a separate module so that it can
receive telemetry data during playback and provide failure/alarm
information to the Sensor and Alarm UI.

The final integration will be performed with the Cycle 3 simulator
after the individual modules have been developed and tested.

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

### 1. Module Responsibility

The Sensor Panel & Alarm UI module shows the state of the crane and its alarms, and a 3D view of the crane. It only shows data. It does not calculate chart or stability values itself.

- Sensor panel from the active telemetry sample: load, boom angle, boom length, radius, slew, outrigger state, hydraulic pressure, wind, and the four pad reactions.
- Rated capacity, utilisation and stability verdict, taken from the failure detector's `derived` block, which gets them from Module 3 (`js/craneModel.js`, over the Cycle-2 chart and stability code). No second copy of chart or stability code: the kit constants, the radius formula, the support polygon and the ground position of the load are imported from `craneModel.js`.
- A **LIVE (telemetry) / MANUAL (override)** badge that is always visible. Touching a slider switches to MANUAL (badge turns amber, alarms are labelled SIMULATED). "Return to LIVE" switches back.
- A **data-quality** badge: `OK` / `STALE` (dropout or repeated timestamp) / `BAD DATA` (an impossible row). BAD DATA and STALE are shown as data problems, never as crane failures.
- An **alarm list**: one latched entry per alarm episode, with the alarm type, the triggering value, the rule that fired and the **first timestamp** at which it became true. Active alarms are highlighted, cleared ones greyed.
- Device chips from `status_word` and wind: WIND ALERT, LMI BYPASS, LMI PRE-WARN, A2B.
- **NOT PERMITTED** instead of a number when the chart has no capacity.
- A 3D view (`js/crane3d.js`) driven by the same sample: boom length and angle, slew, outrigger deployment, hook height, and a load that **sways with the wind**.
- A list of clock faults in the CSV (file order): the 15:20–15:25 dropout and the repeated / backwards timestamps.

Look and feel: dark graphite, off-white, crane yellow; the CSS variables `--dark-surface`, `--crane-yellow`, `--green-ok`, `--amber`, `--red-crit`.

### 2. Files

| File | What it does |
|---|---|
| `simulator.html` | The page: sensors, 3D view, playback controls, sliders, alarm list, clock faults |
| `js/panelModel.js` | Logic, no DOM: analyses a sample, keeps the alarm log, builds the text and colour of every element |
| `js/panel.js` | Draws the model into the page (`textContent` only) |
| `js/dataQuality.js` | OK / STALE / BAD DATA rules and the file-order clock-fault scan |
| `js/crane3d.js` | 3D crane (view only) and the wind sway |
| `crane3d-demo.html` | Stand-alone page for the 3D view |
| `js/test_sensorPanelUI.mjs`, `test_dataQuality.mjs`, `test_crane3d.mjs` | Tests |

### 3. Inputs (interfaces with other modules)

- Module 1 (Ajit): `PlaybackClock` (`currentIndex`, `playing`, `jumpTo`, `setManual`, `setLive`, `pushManualSample`).
- Module 2 (Rushikesh): `detectFailures(sample, previousSample)` and `expectedHydraulicPressure`. The panel uses its alarms as they are (OVERLOAD, STABILITY_LOSS, OUTRIGGER_LIFT_OFF / NEAR_LIFT_OFF, HYDRAULIC_PRESSURE_LOSS, IMPROPER_OUTRIGGER_DEPLOYMENT, NOT_PERMITTED, WIND_ALERT, LMI_BYPASS, LMI_PREWARNING, LMI_DIVERGENCE, DEVICE_OVERLOAD, A2B_ALERT, DATA_QUALITY) and only classifies and words them.
- Module 3 (Sujal): `craneModel.js` (`KIT`, `radiusFromAngle`, `supportPolygon`, `loadGroundPosition`); the chart and stability numbers themselves reach the panel through the detector.

What the panel does before calling the detector:

- A blank `lmi_pct` is passed as `NaN`. The shared `parseCSV` turns an empty cell into `0`, which the detector would read as "device LMI 0 %". Without this the 12:18–12:19 rows would raise 109 false LMI_DIVERGENCE alarms.
- The previous row is passed only if it is itself a valid row, so the row after a glitch (15:00:01, 17:00:01) is not blamed for the glitch.
- In MANUAL mode the pad columns are not simulated. The detector gets an even split of 170 t + load so its pad checks stay silent, and the panel shows the pads as "not simulated".

### 4. Behaviour Rules

- Every field is bound to the sample on screen. There are no static placeholders.
- Alarms are latched: one entry per episode, not one per second. When the playback arrives by a jump, the first timestamp is found by looking back to the true start of the episode, so it is the same at 1×, 10×, 50×, 100× and after a jump.
- A BAD DATA row suppresses crane alarms on that row and shows a data-problem entry instead; a STALE row (dropout, repeated timestamp) shows a STALE entry.
- `lmi_pct` blank and chart null → "NOT PERMITTED" in red, with no made-up percentage.
- MANUAL entries carry the tag SIMULATED.

### 5. Testing

```
node Cycle-3/js/test_sensorPanelUI.mjs     # 103 checks
node Cycle-3/js/test_dataQuality.mjs       # 37 checks
node Cycle-3/js/test_crane3d.mjs           # 51 checks
```

`test_sensorPanelUI.mjs` runs the real kit CSV through the real detector, and passes with the current `parseCSV` and with a fixed one. It checks that each field changes with the sample, the mode badge, the alarm list (type, value, rule, first timestamp, no repeats, same first timestamp at any playback speed), blank LMI, NOT PERMITTED, BAD DATA, STALE, device conditions, pads, the whole day at 3 rows per frame (21 entries), what is passed to the detector, and that nothing throws. The page itself was checked in a headless browser: no console errors, jump list, MANUAL ↔ LIVE, overload, BAD DATA, dropout, wind.

Whole-day alarm log (21 entries with the current `parseCSV`; 23 once blank cells parse to `NaN`, because two single-row LMI divergence entries then appear at 12:18:00 and 12:19:50, where the device is blank but the chart still gives 41.4 t): improper deployment 07:03:00 · overload 09:00:00 · overload + LMI divergence 09:50:00 · near lift-off 10:25:20 · overload 11:00:00 · hydraulic loss 11:00:01 · NOT PERMITTED 12:18:40 · wind 12:30:00 · LMI bypass 14:00:00 · pre-warning ×4 (14:09:58, 14:19:58, 14:39:58, 14:49:58) · BAD DATA ×4 (14:30:00, 15:00:00, 15:30:00, 17:00:00) · dropout 15:25:00 · repeated timestamp 15:59:49 · dropout 16:00:02.

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

- The clock plays 1 row = 1 s, so the dropout and the backwards timestamps are not visible in the playback itself. Module 4 finds them from the file in file order (`scanClockFaults`) and marks STALE.
- `parseCSV` sorts by `ts` and turns blank cells into 0. Module 4 compensates (see section 3), but the real fix is in `parseCSV`.
- The detector gets one row at a time, so it cannot see a dropout. See the fault list, class C.
