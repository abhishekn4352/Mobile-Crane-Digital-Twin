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

The Sensor Panel & Alarm UI module displays the live state of the crane and its alarms. It only shows data. It does not calculate chart or stability values itself.

Key responsibilities:

- Show the sensor panel from the active telemetry sample: load (t), boom angle (°), boom length (m), working radius (m), outrigger state, hydraulic pressure (bar). Also show wind (km/h), slew (°) and the four pad reactions.
- Show rated capacity and utilisation (load / rated capacity), taken from the shared chart module.
- Show the stability verdict from the shared stability module.
- Show a LIVE (telemetry) / MANUAL (override) badge that is always visible. In LIVE mode the sliders reflect incoming values. Touching a slider switches to MANUAL and the badge changes.
- Show a data-quality indicator: OK / STALE (dropout) / BAD DATA (impossible row).
- Show an alarm list. Each alarm displays failure type, triggering value, rule violated and the first telemetry timestamp at which it became true.
- Keep the existing visual style: dark graphite, warm off-white, crane yellow; no neon, no glassmorphism. Reuse the CSS variables `--dark-surface`, `--crane-yellow`, `--green-ok`, `--amber`, `--red-crit`.

### 2. Inputs (interfaces with other modules)

- Module 1 (Ajit): currentTelemetrySample, mode (LIVE/MANUAL), playback clock.
- Module 2 (Rushikesh): alarm objects `{type, value, rule, ts, severity}`.
- Module 3 (Sujal): `ratedCapacity(...)` and `stabilityVerdict(...)`.

The UI keeps no second copy of chart or stability code.

### 3. Behaviour Rules

- Every field is bound to live state. No static placeholders.
- Alarms are latched: one entry per alarm, stamped with the first timestamp. They are not repeated every second. Active alarms are highlighted and cleared alarms are greyed out.
- A STALE or BAD DATA sample is flagged as a data-quality problem, not shown as a crane failure.
- If the rated capacity is null (chart cell not permitted), show "NOT PERMITTED" and not a number.
- In MANUAL mode the badge turns amber and the telemetry-driven alarms are labelled as simulated.

### 4. Testing

Test file: `js/test_sensorPanelUI.mjs`

- Each panel field changes when the sample changes.
- Mode badge switches on slider touch, and back to LIVE on request.
- Alarm list shows type, value, rule and first timestamp, with no repeats.
- Null capacity renders "NOT PERMITTED".
- STALE and BAD DATA states render without throwing.

Test results will be added after implementation.

### 5. Real vs Faked

| Feature | Source | Status |
|---|---|---|
| Load, boom length/angle | Module 1 telemetry sample | To be validated |
| Working radius | Telemetry / radiusFromAngle | To be validated |
| Outrigger state, pads | Module 1 telemetry sample | To be validated |
| Hydraulic pressure | Module 1 telemetry sample | To be validated |
| Wind | Module 1 telemetry sample | To be validated |
| Rated capacity | Module 3 chart module | To be validated |
| Utilisation | load / Module 3 capacity | To be validated |
| Stability indicator | Module 3 stability module | To be validated |
| Alarm list | Module 2 detector | To be implemented |
| LIVE/MANUAL badge | Module 1 mode state | To be implemented |
| Data-quality indicator | Module 1 / Module 2 | To be implemented |
