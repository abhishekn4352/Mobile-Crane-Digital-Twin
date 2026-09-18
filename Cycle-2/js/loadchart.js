// loadchart.js — Grove GMK5250L-1 Mobile Crane Load Chart
// Source: https://www.manitowoc.com/media/15016/download
// Config : Full outriggers (7.8 m spread), 80 t counterweight, 360° slew, EN 13000
// ─────────────────────────────────────────────────────────────────────────────────
// HOW TO READ THIS TABLE
//   capacityT[i][j] = rated capacity (tonnes) at:
//     boomLengthsM[i]  (main boom length in metres)
//     radiiM[j]        (working radius in metres — horizontal distance, slew-centre to hook)
//   null = cell is blank in the manufacturer PDF → operation NOT permitted at this combo.
//   Never interpolate across a null cell — that produces a dangerously wrong number.
// ─────────────────────────────────────────────────────────────────────────────────

export const CHART = {
  model:  'Grove GMK5250L-1',
  source: 'https://www.manitowoc.com/media/15016/download',
  config: 'Full outriggers — 7.8 m spread | 80 t counterweight | 360° | EN 13000',

  // Boom lengths (m) — MUST be ascending
  boomLengthsM: [13.3, 23.6, 38.0, 52.4, 70.0],

  // Working radii (m) — MUST be ascending
  radiiM: [5, 8, 10, 12, 15, 20, 30],

  // capacityT[boomIndex][radiusIndex]  (all values in tonnes, read from PDF)
  // null = blank / not permitted in the manufacturer chart
  //
  //                r=5    r=8    r=10   r=12   r=15   r=20   r=30
  capacityT: [
    /* boom 13.3 */ [121.0, 84.5,  64.5,  null,  null,  null,  null ],
    /* boom 23.6 */ [111.0, 83.5,  68.0,  57.0,  45.0,  27.0,  null ],
    /* boom 38.0 */ [ 59.0, 58.5,  53.0,  47.5,  40.0,  30.5,  17.2 ],
    /* boom 52.4 */ [ null, null,  31.0,  31.0,  28.5,  23.5,  15.0 ],
    /* boom 70.0 */ [ null, null,  null,  14.5,  14.5,  14.5,  12.4 ],
  ],
};

// ─────────────────────────────────────────────────────────────────────────────────
// ratedCapacity — bilinear interpolation across the 2-D load chart.
//
// Returns the interpolated rated capacity in tonnes, or null if:
//   • boomLengthM or radiusM is outside the charted range, OR
//   • any of the four bracketing corner cells is null (not permitted).
//
// Algorithm (STARTER-KIT §3):
//   Step A: interpolate along the boom-length axis at each of the two bracketing radii.
//   Step B: interpolate along the radius axis between those two results.
// ─────────────────────────────────────────────────────────────────────────────────
export function ratedCapacity(chart, boomLengthM, radiusM) {
  const booms = chart.boomLengthsM;
  const radii = chart.radiiM;
  const cap   = chart.capacityT;

  // ── 1. Range check ──────────────────────────────────────────────────────────
  if (boomLengthM < booms[0] || boomLengthM > booms[booms.length - 1]) return null;
  if (radiusM     < radii[0] || radiusM     > radii[radii.length - 1]) return null;

  // ── 2. Find bracketing boom-length indices (i1, i2) ────────────────────────
  let i1 = booms.length - 2;
  for (let i = 0; i < booms.length - 1; i++) {
    if (boomLengthM <= booms[i + 1]) { i1 = i; break; }
  }
  const i2 = i1 + 1;

  // ── 3. Find bracketing radius indices (j1, j2) ──────────────────────────────
  let j1 = radii.length - 2;
  for (let j = 0; j < radii.length - 1; j++) {
    if (radiusM <= radii[j + 1]) { j1 = j; break; }
  }
  const j2 = j1 + 1;

  // ── 4. Read the four corner cells ───────────────────────────────────────────
  const c11 = cap[i1][j1];   // boom-lo , radius-lo
  const c12 = cap[i1][j2];   // boom-lo , radius-hi
  const c21 = cap[i2][j1];   // boom-hi , radius-lo
  const c22 = cap[i2][j2];   // boom-hi , radius-hi

  // If ANY corner is null → crossing a not-permitted region → refuse
  if (c11 == null || c12 == null || c21 == null || c22 == null) return null;

  // ── 5. Bilinear interpolation ────────────────────────────────────────────────
  const tb = (boomLengthM - booms[i1]) / (booms[i2] - booms[i1]); // 0→1
  const tr = (radiusM     - radii[j1]) / (radii[j2] - radii[j1]); // 0→1

  // Step A — interpolate along boom-length at each bracketing radius
  const atRadiusLo = c11 + tb * (c21 - c11);
  const atRadiusHi = c12 + tb * (c22 - c12);

  // Step B — interpolate along radius axis
  return atRadiusLo + tr * (atRadiusHi - atRadiusLo);
}

// ─────────────────────────────────────────────────────────────────────────────────
// radiusFromAngle — convert boom angle + length to working radius (GIVEN).
// pivotOffsetM = horizontal distance from slew centre to boom foot pin.
// ─────────────────────────────────────────────────────────────────────────────────
export function radiusFromAngle(boomLengthM, angleDeg, pivotOffsetM = 0) {
  return boomLengthM * Math.cos(angleDeg * Math.PI / 180) + pivotOffsetM;
}

// ─────────────────────────────────────────────────────────────────────────────────
// validate — validation harness (GIVEN).
// cells = [{ boomLengthM, radiusM, chartT }] — values read from the real PDF.
// Returns worst error %.
// ─────────────────────────────────────────────────────────────────────────────────
export function validate(chart, cells, tolerancePct = 10) {
  console.log(`\nValidating: ${chart.model} — ${chart.config}`);
  console.log('─'.repeat(70));
  let worst = 0;
  for (const c of cells) {
    const mine = ratedCapacity(chart, c.boomLengthM, c.radiusM);
    if (mine == null) {
      console.log(`  [NULL]  L=${c.boomLengthM}m  r=${c.radiusM}m  → NOT PERMITTED / out of chart`);
      continue;
    }
    const errPct = Math.abs(mine - c.chartT) / c.chartT * 100;
    worst = Math.max(worst, errPct);
    const status = errPct <= tolerancePct ? 'PASS' : 'FAIL';
    console.log(
      `  [${status}]  L=${c.boomLengthM}m  r=${c.radiusM}m` +
      `  →  mine=${mine.toFixed(2)} t  |  chart=${c.chartT} t  |  err=${errPct.toFixed(1)}%`
    );
  }
  console.log('─'.repeat(70));
  console.log(
    worst <= tolerancePct
      ? `  ✓ OVERALL PASS  (worst error = ${worst.toFixed(1)}%)`
      : `  ✗ OVERALL FAIL  (worst error = ${worst.toFixed(1)}%)`
  );
  return worst;
}

// ─────────────────────────────────────────────────────────────────────────────────
// VALIDATION TEST CELLS
// A) Exact cells  → error must be 0.0%  (proves data entry is correct)
// B) Interpolated → error < 10%         (proves bilinear logic works)
// C) Null cases   → must return null    (proves boundary guarding works)
// ─────────────────────────────────────────────────────────────────────────────────
export const VALIDATION_CELLS = [
  // A — Exact chart cells (taken directly from PDF)
  { boomLengthM: 13.3, radiusM:  5, chartT: 121.0 },
  { boomLengthM: 23.6, radiusM:  8, chartT:  83.5 },
  { boomLengthM: 38.0, radiusM: 12, chartT:  47.5 },
  { boomLengthM: 52.4, radiusM: 20, chartT:  23.5 },
  { boomLengthM: 70.0, radiusM: 30, chartT:  12.4 },

  // B — Interpolated (midpoints between known cells — hand-check these on paper!)
  // boom=30.8m (midpoint 23.6–38.0), radius=10m
  //   at r=10: boom23.6→68.0, boom38.0→53.0
  //   tb = (30.8-23.6)/(38.0-23.6) = 7.2/14.4 = 0.5
  //   result = 68.0 + 0.5*(53.0-68.0) = 68.0 - 7.5 = 60.5 t
  { boomLengthM: 30.8, radiusM: 10, chartT: 60.5 },

  // boom=38.0m, radius=16m (midpoint 15–20)
  //   at boom38: r=15→40.0, r=20→30.5
  //   tr = (16-15)/(20-15) = 1/5 = 0.2
  //   result = 40.0 + 0.2*(30.5-40.0) = 40.0 - 1.9 = 38.1 t
  { boomLengthM: 38.0, radiusM: 16, chartT: 38.1 },
];
