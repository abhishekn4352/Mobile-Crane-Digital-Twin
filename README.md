[README.md](https://github.com/user-attachments/files/32410138/README.md)
# Mobile Crane Digital Twin

An interactive web-based **Mobile Crane Digital Experience + Digital Twin Simulator** built as a college engineering visualization project.

The project combines a realistic crane model, interactive engineering anatomy, component intelligence, crane operating concepts, sensor/instrumentation visualization, a live sensor panel, manufacturer load-chart calculations, and support-polygon stability checks.

> **Project focus:** make a visitor understand a mobile crane as a real machine while also demonstrating how selected crane operating parameters can be represented and calculated in a digital twin.

---

## Contents

- [Project Overview](#project-overview)
- [Project Versions](#project-versions)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [How to Run](#how-to-run)
- [Cycle 2 Calculation Flow](#cycle-2-calculation-flow)
- [Load Chart Module](#load-chart-module)
- [Stability Module](#stability-module)
- [Sensor & Instrumentation Panel](#sensor--instrumentation-panel)
- [Testing](#testing)
- [Important Implementation Notes](#important-implementation-notes)
- [Limitations and Future Improvements](#limitations-and-future-improvements)
- [Credits / Team Work](#credits--team-work)

---

## Project Overview

The **Mobile Crane Digital Twin** project is divided into two major stages:

### Cycle 1 — Digital Crane Experience

Cycle 1 focuses on the educational and visual side of the project:

- Hero experience using the crane 3D model
- Introduction to mobile cranes
- Interactive crane anatomy
- Exploded / engineering disassembly visualization
- Component intelligence
- Crane operating sequence
- Hydraulic power flow visualization
- Sensor and instrumentation overview
- Mobile crane type comparison
- Crane safety systems
- Industry overview

### Cycle 2 — Engineering / Digital Twin Layer

Cycle 2 extends the experience with working engineering logic:

- Grove **GMK5250L-1** load-chart data
- Working-radius calculation from boom length and boom angle
- Bilinear load-chart interpolation
- Rated-capacity lookup
- Null / unpermitted chart-cell protection
- Outrigger support-polygon generation
- Load ground-position calculation using slew angle
- Combined machine + load center-of-gravity calculation
- Stability verdict: `ok`, `warn`, or `tipping`
- Live sensor/instrumentation panel
- Load utilization monitoring
- Simulated hydraulic-pressure telemetry
- Demo sequence for changing operating conditions
- Automated validation tests

---

## Features

### 1. Interactive 3D Crane Experience

The main Cycle 2 experience uses **Three.js** and loads the supplied GLB crane model for the hero scene.

Supported interactions include:

- Orbit rotation
- Zoom and pan
- Camera reset
- Interactive component highlighting
- Component selection
- Anatomy information panels
- Engineering/exploded-view style visualization

The visual design uses a dark industrial theme with crane yellow as the technical accent.

### 2. Crane Anatomy

The anatomy section divides the crane into logical engineering groups such as:

- Chassis & Base
- Outrigger Assembly
- Cabin & Counterweight
- Boom Assembly
- Rigging & Hook Block

Component information includes function, mechanical role, related systems, sensors, and visual references where available.

### 3. Sensor & Instrumentation

The website documents sensor concepts commonly associated with crane monitoring, including:

- Boom angle sensor
- Boom length sensor
- Load sensor
- Hydraulic pressure sensor
- Outrigger position sensor
- Temperature monitoring
- Wind-speed monitoring
- Other operator/system instrumentation

### 4. Live Sensor Panel

The Cycle 2 panel exposes simulated controls for:

- Boom length
- Boom angle
- Slew angle
- Load
- Outrigger condition

It then calculates/displays:

- Working radius
- Rated capacity
- Load utilization
- Support-polygon stability
- Hydraulic pressure estimate
- Overall operating status

### 5. Load Chart Calculation

The implementation contains a structured load chart for the **Grove GMK5250L-1** configuration documented in `Cycle-2/js/loadchart.js`.

The current embedded configuration is:

- Full outriggers — 7.8 m spread
- 80 t counterweight
- 360° slew
- EN 13000 configuration

The module refuses to produce a capacity when:

- Boom length is outside the charted range
- Working radius is outside the charted range
- Any bracketing load-chart cell is `null` / not permitted

This avoids interpolating through blank manufacturer-chart regions.

### 6. Stability Check

The stability module models the crane support area using an outrigger polygon.

The calculation chain is:

1. Convert working radius + slew angle into ground position.
2. Combine machine mass and suspended load position into a weighted center of gravity.
3. Check whether the resulting point lies inside the support polygon.
4. Calculate the distance to the nearest polygon edge.
5. Return:
   - `ok` — safely inside the polygon
   - `warn` — inside, but close to the edge
   - `tipping` — outside the support polygon or no valid support polygon

This is a digital-twin approximation for the project and is **not a certified crane safety calculation**.

---

## Technology Stack

### Frontend

- HTML5
- CSS3
- Vanilla JavaScript
- ES Modules
- Three.js `0.158.0`
- GLTFLoader
- OrbitControls

### Engineering Logic

- JavaScript modules
- Trigonometric radius calculation
- Bilinear interpolation
- Point-in-polygon calculation
- Point-to-edge distance calculation
- Weighted combined center of gravity

### Tooling

- Python `http.server` for local development
- Node.js for module/test execution

There is **no npm build step** and no backend/database dependency in the current repository.

---

## Repository Structure

```text
Mobile-Crane-Digital-Twin-main/
│
├── README.md
├── Calculation.jpeg
├── Load chart calculation.jpeg
├── Real_Data_Table.jpeg
├── Failure Mode.pdf
│
├── Cycle-1/
│   ├── index.html
│   ├── task.md
│   ├── command to run.txt
│   └── assets/
│       ├── 3D_model/
│       │   └── mobile_crane.glb
│       ├── components/
│       ├── crane-types/
│       └── video/
│
└── Cycle-2/
    ├── index.html
    ├── simulator.html
    ├── css/
    │   ├── digital-twin.css
    │   └── panel.css
    ├── js/
    │   ├── digital-twin.js
    │   ├── loadchart.js
    │   ├── panel.js
    │   ├── stability.js
    │   ├── test_loadchart.mjs
    │   └── test_stability.mjs
    ├── reference/
    │   └── panel.html
    └── assets/
        ├── 3D_model/
        │   └── mobile_crane.glb
        ├── components/
        ├── crane-types/
        └── video/
```

---

## How to Run

Because the project uses ES modules and local 3D assets, run it through a local HTTP server rather than opening `index.html` directly with `file://`.

### Option 1 — Python HTTP Server

Open a terminal in the required folder.

#### Cycle 2 (recommended)

```bash
cd Cycle-2
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/index.html
```

The main page loads the live simulator from:

```text
http://localhost:8000/simulator.html
```

#### Cycle 1

```bash
cd Cycle-1
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/index.html
```

### Option 2 — VS Code Live Server

Open the project in VS Code and launch the relevant `index.html` through a local server extension such as Live Server.

---

## Cycle 2 Calculation Flow

The main sensor panel follows this data flow:

```text
User Controls
    │
    ├── Boom Length
    ├── Boom Angle
    ├── Slew Angle
    ├── Load
    └── Outrigger Condition
           │
           ▼
    Working Radius
    radius = boomLength × cos(angle) + offset
           │
           ├─────────────────────────┐
           ▼                         ▼
    Load Chart Lookup          Load Ground Position
           │                         │
           ▼                         ▼
    Rated Capacity              x / z Position
           │                         │
           ▼                         ▼
    Load Utilization           Combined CoG
                                     │
                                     ▼
                              Support Polygon
                                     │
                                     ▼
                              Stability Verdict
                                     │
                                     ▼
                              Overall Status
```

---

## Load Chart Module

File:

```text
Cycle-2/js/loadchart.js
```

The module exports:

```javascript
CHART
ratedCapacity()
radiusFromAngle()
validate()
VALIDATION_CELLS
```

### Working Radius

```text
radius = boomLength × cos(boomAngle) + pivotOffset
```

The current panel uses a pivot offset of `0 m`.

### Rated Capacity

`ratedCapacity()` performs **bilinear interpolation** between the four surrounding chart cells.

It returns `null` rather than guessing when a configuration is outside the chart or crosses a blank (`null`) chart cell.

### Embedded Chart Range

Boom lengths:

```text
13.3 m
23.6 m
38.0 m
52.4 m
70.0 m
```

Working radii:

```text
5 m
8 m
10 m
12 m
15 m
20 m
30 m
```

The source URL referenced by the code is the Manitowoc load-chart document:

```text
https://www.manitowoc.com/media/15016/download
```

The source PDF itself is **not included inside this ZIP**; the numerical chart data is embedded in `loadchart.js`.

---

## Stability Module

File:

```text
Cycle-2/js/stability.js
```

Key exported functions:

```javascript
pointInPolygon()
loadGroundPosition()
edgeDistanceM()
stabilityVerdict()
combinedCoG()
outriggerPolygonForSpread()
```

The current integrated panel uses:

- Outrigger spread: `8.95 m × 7.8 m`
- Warning margin: `1.5 m`
- Weighted combined machine/load CoG

The stability result is independent of the load-chart capacity result. This means a configuration can be within rated chart capacity but still be flagged by the simplified support-polygon model when its calculated CoG falls outside the modeled support area.

---

## Sensor & Instrumentation Panel

Main file:

```text
Cycle-2/js/panel.js
```

The panel connects the load-chart and stability modules without modifying their core calculation logic.

Displayed fields include:

1. Load
2. Boom Angle
3. Boom Length
4. Working Radius
5. Outrigger Condition
6. Hydraulic Pressure

Additional indicators:

- Rated Capacity
- Load Utilization
- Support-Polygon Stability
- Overall operating state

### Hydraulic Pressure Note

Hydraulic pressure is **modelled**, not measured from a physical sensor.

The code explicitly treats it as a derived/simulated value based on load and capacity. It should therefore be presented as simulated telemetry in demonstrations.

---

## Testing

Cycle 2 includes two Node.js test modules.

### Load Chart Test

From `Cycle-2/js`:

```bash
node test_loadchart.mjs
```

The test covers:

- Exact manufacturer-chart cells
- Interpolated cells
- Out-of-range values
- Blank/null chart regions

Current verification result:

```text
OVERALL PASS
Worst error: 0.0%
```

### Stability Test

```bash
node test_stability.mjs
```

The test covers:

- Point-in-polygon behaviour
- Radius/slew position conversion
- Edge-distance calculation
- OK / warning / tipping states
- Combined CoG calculation

Current verification result:

```text
19 passed, 0 failed
```

---

## Important Implementation Notes

### 1. Main Experience vs Simulator

The primary Cycle 2 entry point is:

```text
Cycle-2/index.html
```

It contains the editorial/3D experience and embeds:

```text
Cycle-2/simulator.html
```

as the live digital-twin area.

### 2. Actual GLB Model vs Procedural 3D Elements

The hero section loads the supplied GLB model:

```text
Cycle-2/assets/3D_model/mobile_crane.glb
```

Some interactive anatomy/exploded visual elements are constructed procedurally in Three.js inside `index.html` rather than coming directly from the GLB's internal mesh hierarchy.

### 3. `digital-twin.js` Integration Layer

`Cycle-2/js/digital-twin.js` is intentionally lightweight. Its role is to load the sensor-panel integration layer and indicate that the load-chart, stability, and panel modules are connected.

### 4. Legacy / Standalone Simulator Logic

`Cycle-2/simulator.html` contains a self-contained simulator implementation and its own simplified calculations. Its settings text explicitly describes some of its load-chart figures as placeholders.

For the validated Cycle 2 engineering logic, use the modular files:

```text
Cycle-2/js/loadchart.js
Cycle-2/js/stability.js
Cycle-2/js/panel.js
```

These are the modules covered by the included automated tests.

### 5. No Physical Sensor Hardware

All live sensor values in this repository are simulated through UI controls and JavaScript calculations. There is no physical crane, PLC, IoT device, CAN bus, or real-time telemetry feed connected in the current version.

---

## Limitations and Future Improvements

The current project is a **demonstration / educational digital twin**, not an operational crane control or certification system.

Potential next steps:

- Connect the sensor panel to real hardware or a telemetry API
- Replace the remaining simulated telemetry with sensor-backed values
- Synchronize the live sensor values with the animated 3D crane state
- Drive boom extension/angle directly from the 3D scene
- Visualize the calculated support polygon under the crane in real time
- Add a true crane load-moment calculation layer
- Add manufacturer-specific configuration switching
- Add more complete load-chart datasets/configurations
- Attach the original manufacturer PDFs and page references to the repository
- Add automated browser/UI tests
- Separate shared data from the HTML file into dedicated JSON/JS modules
- Add deployment configuration for static hosting

---

## Credits / Team Work

The Cycle 2 integration follows the project team responsibilities represented in the codebase:

- **Load Chart module** — load-chart data, lookup, interpolation, and validation
- **Stability module** — support polygon, ground position, edge-distance and combined CoG calculations
- **Sensor Panel** — live controls, readouts, utilization/status logic, and simulated hydraulic telemetry
- **Integration layer** — connects the engineering modules to the digital-twin experience

---

## Safety & Disclaimer

This project is for **education, demonstration, visualization, and engineering-software experimentation**.

The calculations in this repository must not be used to operate a real crane, determine an actual safe working load, override a crane manufacturer's rated load chart, or replace a qualified engineer/operator, approved load chart, inspection procedure, or safety system.

The support-polygon stability model is a simplified project model and does not represent a complete certified crane stability analysis.

---

## Quick Start

```bash
# 1. Open the project
cd Mobile-Crane-Digital-Twin-main/Cycle-2

# 2. Start a local server
python -m http.server 8000

# 3. Open in browser
# http://localhost:8000/index.html

# 4. Optional: run engineering tests
cd js
node test_loadchart.mjs
node test_stability.mjs
```

---

**Built with:** HTML5 · CSS3 · JavaScript · Three.js · GLTF/GLB · Engineering calculation modules
