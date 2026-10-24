// ============================================================
// Cycle 3 - Mobile Crane Digital Twin
// Visual layer - 3D crane model (view only)
//
// Source model: "Mobile Crane - Interactive 3D" shared by Ajit.
//
// This file is a VIEW. It never computes capacity, stability,
// alarms or pressure. It only receives numbers (a "pose") and
// moves the model. All numbers come from the telemetry sample.
//
// What was changed from the shared model, and why
//   1. Construction site removed (buildings, containers, sand,
//      bricks, fence, lamp posts): actual crane scenario only.
//   2. Demo work cycle, slider panel, labels, exploded view and
//      the built-in orbit UI removed. The model no longer moves
//      by itself; only setPose() moves it.
//   3. Wrapped in createCrane3D(THREE, scene) so it can be
//      imported (the original was one global script).
//   4. Boom stretched x3 along its own axis so the telescoping
//      range matches the data: pivot-to-head 23.35 .. 53.35 m
//      (CSV valid rows are 23.6 .. 52.4 m). Before: 8.4 .. 18.4 m.
//   5. Boom pivot moved to x = -0.05 m so the hook sits at
//      radius = L*cos(angle) + 0.8 (the kit radius formula)
//      from the slew axis. Before: about 1.5 m short.
//   6. Outrigger pads placed on the support-polygon corners
//      (+-3.9 m along the carrier, +-4.475 m sideways by default),
//      with the slew axis at the world origin, the same frame as
//      stability.js. Before: 7.6 x 6.6 m, off-centre. A middle
//      beam section was added so the beam stays connected.
//   7. Slew sign is mirrored inside setPose(): the original model
//      rotates the other way from stability.js loadGroundPosition().
//   8. Load block (beams + slings) can be hidden when load_t = 0.
//   9. Wind sway: the hook block and load swing from the rope anchor
//      as a pendulum. The WIND SPEED is real (wind_kmh from the CSV).
//      The AMPLITUDE, PERIOD and DIRECTION are illustrative only: the
//      kit gives no load area, rope length or wind direction, so
//      nothing here is a physical sway calculation. Listed as
//      "faked" in the README Real-vs-faked table.
//
// Frame (same as stability.js): slew axis at (0, 0, 0). Slew 0 =
// boom towards +x. loadGroundPosition(r, slew) = (r*cos, r*sin).
// ============================================================


// ------------------------------------------------------------
// Calibration constants
// ------------------------------------------------------------

import { SAFETY_LIMITS } from './craneModel.js';

export const BOOM_SCALE = 3;
export const BOOM_PIVOT_X_M = -0.05;

// Pivot-to-head distance = BOOM_L_MIN_M + BOOM_STROKE_M * extension
export const BOOM_L_MIN_M = BOOM_SCALE * 7.5 + 0.85;      // 23.35 m, fully retracted
export const BOOM_STROKE_M = BOOM_SCALE * 10;              // 30 m of telescoping
export const BOOM_L_MAX_M = BOOM_L_MIN_M + BOOM_STROKE_M;  // 53.35 m, fully extended

export const BOOM_ANGLE_MIN_DEG = 5;
export const BOOM_ANGLE_MAX_DEG = SAFETY_LIMITS.angleMaxDeg;

export const DEFAULT_PAD_HALF_X_M = 3.9;    // kit pads: x = +-3.9
export const DEFAULT_PAD_HALF_Z_M = 4.475;  // kit pads: z = +-4.475

const SLEW_AXIS_LOCAL_X = -1.4;             // slew axis inside the carrier frame of the model
const BOOM_PIVOT_Y = 1.95;                  // boom pivot height above the slew deck (model units)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));


// ------------------------------------------------------------
// Pure mapping (no THREE, no DOM) - unit-tested in node
// ------------------------------------------------------------

/** Boom length in metres (pivot to head) -> telescoping extension 0..1. null if not a number. */
export function boomExtensionFromLength(lengthM) {
  if (!Number.isFinite(lengthM)) return null;
  return clamp((lengthM - BOOM_L_MIN_M) / BOOM_STROKE_M, 0, 1);
}

const toSeconds = (ts) => Date.parse(ts) / 1000;

/**
 * Finds every DEPLOYING / RETRACTING run in the recording.
 * The CSV only says which state a row is in, not how far the
 * outriggers have travelled, so the extension is spread evenly
 * over the run using the rows' own ts.
 * rows: parsed telemetry rows (Ajit's parseCSV output).
 */
export function buildOutriggerTimeline(rows) {
  const runs = [];
  let cur = null;
  for (const row of rows) {
    const state = row.outrigger_state;
    if (state !== 'DEPLOYING' && state !== 'RETRACTING') { cur = null; continue; }
    const t = toSeconds(row.ts);
    if (!Number.isFinite(t)) continue;
    if (!cur || cur.state !== state) {
      cur = { state, t0: t, t1: t };
      runs.push(cur);
    } else {
      cur.t1 = Math.max(cur.t1, t);
    }
  }
  return runs;
}

/**
 * Outrigger extension 0 (retracted) .. 1 (fully out) for one sample.
 * DEPLOYED = 1, RETRACTED = 0, DEPLOYING / RETRACTING ramp across the run.
 * Returns null when the state is unknown, so the model keeps its last value.
 */
export function outriggerExtensionAt(timeline, sample) {
  const state = sample && sample.outrigger_state;
  if (state === 'DEPLOYED') return 1;
  if (state === 'RETRACTED') return 0;
  if (state !== 'DEPLOYING' && state !== 'RETRACTING') return null;

  const t = toSeconds(sample.ts);
  const run = (timeline || []).find((r) => r.state === state && t >= r.t0 && t <= r.t1);
  if (!run) return 0.5;                       // state is known, position inside the run is not
  const f = clamp((t - run.t0) / (run.t1 + 1 - run.t0), 0, 1);
  return state === 'DEPLOYING' ? f : 1 - f;
}

/** CSV sample -> pose. Values are in DATA conventions (the module mirrors slew itself). */
export function poseFromSample(sample, timeline) {
  return {
    boomAngleDeg: sample.boom_angle_deg,
    boomLengthM: sample.boom_length_m,
    slewDeg: sample.slew_deg,
    outriggerExt: outriggerExtensionAt(timeline, sample),
    loadT: sample.load_t,
    windKmh: sample.wind_kmh,
  };
}


// ------------------------------------------------------------
// Wind sway (VISUAL ONLY)
//
// Input that is real:   wind_kmh from the telemetry sample.
// Everything below is an illustration, not physics:
//   - the lean grows with wind speed squared (drag ~ v^2), scaled so
//     that the kit's 36 km/h wind-alert speed gives SWAY_LEAN_AT_ALERT_DEG;
//   - the period and the cross-wind part are chosen to look natural;
//   - the wind direction is not in the data, so the view assumes one.
// ------------------------------------------------------------

export const WIND_ALERT_KMH = 36;            // kit alert threshold (README column dictionary)
export const SWAY_LEAN_AT_ALERT_DEG = 5;     // visual scale, not a manufacturer figure
export const SWAY_LEAN_MAX_DEG = 12;         // keeps the picture sensible at extreme wind
export const SWAY_OSC_FRACTION = 0.6;        // swing around the lean = 60 % of the lean
export const SWAY_PERIOD_S = 5;              // seconds of real (screen) time, not telemetry time
export const SWAY_CROSS_FRACTION = 0.35;     // cross-wind swing relative to the along-wind swing

/**
 * Sway angles of the hanging load for one wind speed and one screen time.
 * Returns degrees along the wind direction (steady lean + swing) and across it,
 * or null when the wind speed is not a number (the model then keeps its last sway).
 * tSec only drives the swing animation; it is NOT the telemetry clock.
 */
export function swayFromWind(windKmh, tSec) {
  if (!Number.isFinite(windKmh) || !Number.isFinite(tSec)) return null;
  const w = Math.max(0, windKmh);
  const leanDeg = Math.min(SWAY_LEAN_MAX_DEG, SWAY_LEAN_AT_ALERT_DEG * (w / WIND_ALERT_KMH) ** 2);
  const oscDeg = SWAY_OSC_FRACTION * leanDeg;
  const w0 = 2 * Math.PI / SWAY_PERIOD_S;
  return {
    leanDeg,
    oscDeg,
    alongDeg: leanDeg + oscDeg * Math.sin(w0 * tSec),
    crossDeg: SWAY_CROSS_FRACTION * oscDeg * Math.sin(w0 * tSec / 1.27 + 1.1),
  };
}


// ------------------------------------------------------------
// The 3D crane
// ------------------------------------------------------------

/**
 * Builds the crane and adds it to `scene`.
 * @param THREE  the three.js namespace (r128)
 * @param scene  THREE.Scene (or any Object3D)
 * @param opts   { padHalfX, padHalfZ, hookFraction, windTowardDeg }
 *               windTowardDeg: direction the wind blows TOWARD, in data convention
 *               (0 = +x, 90 = +z). Not in the telemetry, so it is an assumption; default 90.
 * @returns { root, setPose, tick, swayDeg, headWorld, padWorld, isLoadVisible, dispose }
 */
export function createCrane3D(THREE, scene, opts = {}) {
  const T = THREE;
  const padHalfX = opts.padHalfX ?? DEFAULT_PAD_HALF_X_M;
  const padHalfZ = opts.padHalfZ ?? DEFAULT_PAD_HALF_Z_M;
  const hookFraction = clamp(opts.hookFraction ?? 0.9, 0, 1);   // 1 = hook right under the head
  const windRad = (opts.windTowardDeg ?? 90) * Math.PI / 180;
  const windDir = { x: Math.cos(windRad), z: Math.sin(windRad) };
  const k = BOOM_SCALE;
  const px = BOOM_PIVOT_X_M;

  const root = new T.Group();
  scene.add(root);

  // ---- materials
  const M = (c, r = .5, m = .2, o = {}) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: r, metalness: m }, o));
  const Y = M(0xf4b400, .38, .25), Yd = M(0xdc9c00, .45, .25), K = M(0x2a2d32, .6, .4), G = M(0x666b73, .4, .7),
        Cr = M(0xcfd3d8, .2, .95), Rb = M(0x0e0e0f, .95, 0),
        Gl = M(0x182633, .08, .7, { transparent: true, opacity: .85 }), Lt = M(0xffffff, .3, 0, { emissive: 0xffffee, emissiveIntensity: .6 }),
        Tr = M(0x19191a, .9, 0);

  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g2 = cv.getContext('2d');
  g2.fillStyle = '#fff'; g2.fillRect(0, 0, 64, 64); g2.fillStyle = '#d3221b';
  for (let i = -1; i < 3; i++) { g2.beginPath(); g2.moveTo(i * 32, 64); g2.lineTo(i * 32 + 16, 64); g2.lineTo(i * 32 + 48, 0); g2.lineTo(i * 32 + 32, 0); g2.fill(); }
  const stripeTex = new T.CanvasTexture(cv);
  stripeTex.encoding = T.sRGBEncoding;
  const Str = M(0xffffff, .5, .1, { map: stripeTex });

  // ---- helpers: box, cylinder, group
  const B = (p, w, h, d, m, x = 0, y = 0, z = 0) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; p.add(o); return o; };
  const Cy = (p, r, l, m, x = 0, y = 0, z = 0, ax = 'y', s = 24) => { const o = new T.Mesh(new T.CylinderGeometry(r, r, l, s), m); o.position.set(x, y, z); if (ax === 'z') o.rotation.x = Math.PI / 2; if (ax === 'x') o.rotation.z = Math.PI / 2; o.castShadow = o.receiveShadow = true; p.add(o); return o; };
  const Gp = (p, x = 0, y = 0, z = 0) => { const g = new T.Group(); g.position.set(x, y, z); p.add(g); return g; };

  // The slew axis goes to the world origin (stability.js frame).
  const crane = Gp(root, -SLEW_AXIS_LOCAL_X, 0, 0);

  // ---- chassis + carrier cab
  const padXs = [SLEW_AXIS_LOCAL_X + padHalfX, SLEW_AXIS_LOCAL_X - padHalfX];   // outrigger mounts, carrier frame
  B(crane, 12.4, .7, 1.6, K, -.2, 1, 0);
  padXs.forEach((x) => B(crane, .62, .55, 2.3, K, x, 1, 0));
  B(crane, 2.2, 1.9, 2.5, Y, 4.65, 2.15, 0); B(crane, 2.2, .1, 2.55, K, 4.65, 3.12, 0);
  B(crane, .05, 1, 2.1, Gl, 5.77, 2.55, 0);
  [1, -1].forEach((s) => {
    B(crane, 1.3, .9, .04, Gl, 4.7, 2.5, s * 1.26); B(crane, .04, .18, .35, Lt, 5.77, 1.6, s * .9);
    Cy(crane, .3, 1.6, K, .1, .8, s * .95, 'x'); B(crane, 2.5, .1, .6, Y, 2.95, 1.42, s * 1.3);
    B(crane, 2.4, .1, .6, Y, -2.85, 1.42, s * 1.3); B(crane, .2, .4, .12, K, 5.3, 2.3, s * 1.36);
  });
  B(crane, .45, .4, 2.6, K, 6, 1.05, 0); B(crane, .04, .5, 1.6, K, 5.77, 1.75, 0); B(crane, .6, .25, 2.2, Y, 5.1, 1.2, 0);
  for (let i = 0; i < 4; i++) B(crane, .05, .05, 1.5, G, 5.8, 1.55 + i * .12, 0);
  [1, -1].forEach((s) => {
    B(crane, .08, 1.1, .08, K, 5.78, 2.55, s * 1.06); B(crane, .1, .5, .12, K, 5.55, 2.7, s * 1.45);
    B(crane, .5, .08, .3, K, 4, 1.05, s * 1.2); B(crane, .04, .45, .55, Rb, -4.4, .55, s * 1.3);
    B(crane, .04, .2, .3, M(0xc01818, .4, 0, { emissive: 0x990000, emissiveIntensity: .6 }), -6.4, 1.3, s * .6);
  });
  Cy(crane, .1, .14, M(0xff8c00, .3, 0, { emissive: 0xff6a00, emissiveIntensity: .9 }), 4.2, 3.2, .6);
  [3.8, 2.1, -2, -3.7].forEach((x) => Cy(crane, .1, 2.6, K, x, .62, 0, 'z', 10));
  Cy(crane, .07, 8, K, -.5, .75, 0, 'x', 8);

  // ---- wheels
  [3.8, 2.1, -2, -3.7].forEach((x) => [1, -1].forEach((s) => {
    const e = Gp(Gp(crane, x, .62, s * 1.3));
    Cy(e, .62, .52, Rb, 0, 0, 0, 'z', 32); Cy(e, .38, .54, Y, 0, 0, 0, 'z'); Cy(e, .14, .58, G, 0, 0, 0, 'z', 12);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; Cy(e, .035, .58, Cr, Math.cos(a) * .26, Math.sin(a) * .26, 0, 'z', 6); }
    for (let i = 0; i < 5; i++) Cy(e, .64, .035, Tr, 0, 0, -.2 + i * .1, 'z', 32);
  }));

  // ---- outriggers (pads on the support-polygon corners)
  const OUT = [];
  const reachZ = padHalfZ - 1;                       // pad sits 1 m beyond the moving beam origin
  padXs.forEach((x) => [1, -1].forEach((s) => {
    const be = Gp(Gp(crane, x, 1, 0));
    const mid = Gp(be), sl = Gp(be);
    B(mid, .40, .34, 2.4, G);                        // middle section (keeps the beam connected)
    B(sl, .46, .4, 2.4, G); B(sl, .64, .5, .06, Str, 0, 0, s * 1.22);
    const cg = Gp(Gp(sl), 0, 0, s * 1);
    Cy(cg, .19, .9, Yd, 0, .1, 0);
    const rod = Cy(cg, .11, 1, Cr);
    const pg = Gp(Gp(cg));
    B(pg, .9, .14, .9, K); Cy(pg, .13, .14, G, 0, .12, 0);
    OUT.push({ mid, sl, s, rod, pg });
  }));

  // ---- ladder
  const ladder = Gp(Gp(crane, .6, .9, .85));
  [-.2, .2].forEach((x) => B(ladder, .05, 1, .05, G, x, 0, 0));
  for (let i = 0; i < 6; i++) B(ladder, .4, .04, .05, G, 0, -.42 + i * .17, 0);

  // ---- upper structure (rotates with slew)
  const up = Gp(crane, SLEW_AXIS_LOCAL_X, 1.35, 0);
  Cy(up, 1.3, .3, K, 0, .15, 0, 'y', 40); B(up, 3.4, 1, 2.2, Y, -.4, .8, 0); B(up, .04, .4, 1.8, Yd, 1.3, .7, 0);
  B(up, 1.2, .1, 1.6, K, -1.2, 1.35, 0); B(up, 3, .04, .04, G, -.4, 1.75, 1);
  [-1.6, -.4, .8].forEach((x) => B(up, .04, .45, .04, G, x, 1.52, 1));
  const cw = Gp(Gp(up, -2.6, .95, 0));
  B(cw, 1.4, 1.3, 2.3, K); B(cw, 1.45, .1, 2.35, G, 0, .7, 0); B(cw, .04, .3, 2, Y, -.72, 0, 0);
  B(cw, 1.45, .06, 2.35, Yd, 0, .28, 0); B(cw, 1.45, .06, 2.35, Yd, 0, -.28, 0);
  const cab = Gp(Gp(up, .5, 0, -1.25));
  B(cab, 1.7, 1.7, 1.1, Y, 0, 1.15, 0); B(cab, .05, 1.1, .95, Gl, .86, 1.35, 0);
  B(cab, 1.4, 1, .04, Gl, 0, 1.35, -.56); B(cab, 1.7, .08, 1.1, K, 0, 2.02, 0);

  // ---- boom (x-lengths multiplied by BOOM_SCALE, thickness unchanged)
  const tip = (x) => BOOM_SCALE * 7.5 + (x - 7.5);   // parts that sit beyond the end of the last section
  const bp = Gp(up, px, BOOM_PIVOT_Y, 0);
  const BE = Gp(bp);
  B(BE, 7.5 * k, .95, .9, Y, 3.75 * k, 0, 0); B(BE, 7.5 * k, .14, .94, Yd, 3.75 * k, -.4, 0);
  Cy(BE, .28, 1.1, K, 0, 0, 0, 'z');
  for (let i = 0; i < 7; i++) B(BE, .08, 1, .96, Yd, (.7 + i) * k, 0, 0);
  Cy(BE, .04, 7 * k, K, 3.75 * k, .2, -.47, 'x', 6);
  B(BE, .25, 1, .95, K, 7.4 * k, 0, 0);
  const t1 = Gp(Gp(BE));
  B(t1, 6.5 * k, .82, .76, Y, 4.25 * k, 0, 0); B(t1, .25, .88, .82, K, 7.4 * k, 0, 0);
  const t2 = Gp(Gp(t1));
  B(t2, 5.5 * k, .68, .62, Yd, 4.75 * k, 0, 0); B(t2, .2, .74, .68, K, 7.4 * k, 0, 0);
  const HE = Gp(t2);
  B(HE, .8, 1.1, 1, Yd, tip(7.9), 0, 0);
  [1, -1].forEach((s) => B(HE, .7, 1, .12, K, tip(8.2), -.15, s * .56));
  Cy(HE, .45, .1, G, tip(8.35), -.4, 0, 'z', 32);
  const ap = Gp(HE, tip(8.35), -.9, 0);              // rope leaves the boom head here
  const AE = Gp(HE);
  B(AE, .2, .28, .2, K, tip(8.1), -.8, .4); Cy(AE, .07, .45, Y, tip(8.1), -1.1, .4);
  const SE = Gp(BE);
  B(SE, .4, .32, .3, K, 2.8, .1, .62); Cy(SE, .17, .28, G, 2.8, .1, .85, 'z');

  // ---- lift cylinders
  const LCE = Gp(up);
  const LC = [-.3, .3].map((z) => { const cg = Gp(LCE, 0, 0, z); Cy(cg, .2, 2, Yd, 1, 0, 0, 'x'); return { cg, rod: Cy(cg, .11, 1, Cr, 0, 0, 0, 'x') }; });

  // ---- hook block, ropes, load (these live in world space, not on the boom)
  const hk = Gp(root);
  const HB = Gp(hk);
  B(HB, .6, .8, .42, K, 0, -.2, 0); B(HB, .66, .3, .46, M(0xc9241a, .5, .3), 0, -.52, 0);
  Cy(HB, .3, .5, G, 0, -.1, 0, 'z', 28); Cy(HB, .1, .3, G, 0, -.7, 0);
  const hookMesh = new T.Mesh(new T.TorusGeometry(.3, .08, 12, 24, Math.PI * 1.5), G);
  hookMesh.position.y = -1.05; hookMesh.rotation.z = Math.PI * .75; hookMesh.castShadow = true; HB.add(hookMesh);
  B(Gp(HB), .22, .05, .06, Y, .2, -.8, 0);

  const loadRig = Gp(hk);                              // load block + slings, hidden when load_t = 0
  const Gs = M(0x7b8590, .4, .8);
  const ld = Gp(loadRig, 0, -3.5, 0);
  for (let i = 0; i < 3; i++) B(ld, 3.6, .2, .26, Gs, 0, i * .21, 0);
  B(ld, .1, .6, .9, K, -1.2, .2, 0); B(ld, .1, .6, .9, K, 1.2, .2, 0);
  [1, -1].forEach((s) => { const c = Cy(loadRig, .025, 2.4, K, s * .7, -2.35, 0); c.rotation.z = s * .62; });

  const ropes = [0, 1].map(() => { const m = new T.Mesh(new T.CylinderGeometry(.035, .035, 1, 8), K); m.castShadow = true; root.add(m); return m; });

  // ---- state + update
  const V = { boom: 70, ext: 0.5, slew: 0, out: 1, hook: hookFraction,
              wind: 0, windSmooth: 0, tLast: null, swayAlongDeg: 0, swayCrossDeg: 0 };
  const Pw = new T.Vector3(), Q = new T.Quaternion(), dir = new T.Vector3();
  const Y_AXIS = new T.Vector3(0, 1, 0);
  const qYaw = new T.Quaternion(), qTilt = new T.Quaternion();
  const vUp = new T.Vector3(), vTop = new T.Vector3(), vBot = new T.Vector3();
  let hookY = 4.4;      // hook height with no sway
  let hookDrop = 0;     // rope length from the boom head to the hook block with no sway

  // Hangs the hook block + load from the rope anchor as a pendulum.
  // With no sway (wind 0, or a very short rope) it is exactly the old fixed placement.
  function placeHook() {
    const Le = hookDrop;
    let ox = 0, oz = 0, drop = Le;
    if (Le > 0.3) {
      const a = V.swayAlongDeg * Math.PI / 180, c = V.swayCrossDeg * Math.PI / 180;
      ox = Le * (Math.sin(a) * windDir.x - Math.sin(c) * windDir.z);
      oz = Le * (Math.sin(a) * windDir.z + Math.sin(c) * windDir.x);
      drop = Math.sqrt(Math.max(Le * Le - ox * ox - oz * oz, 0));
    }
    const y = Le > 0.3 ? Pw.y - drop : hookY;
    hk.position.set(Pw.x + ox, y, Pw.z + oz);
    qYaw.setFromAxisAngle(Y_AXIS, Math.atan2(-dir.z, dir.x));
    if (Le > 0.3 && (ox !== 0 || oz !== 0)) {
      vUp.set(-ox, drop, -oz).normalize();                  // from the hook back to the anchor
      qTilt.setFromUnitVectors(Y_AXIS, vUp);
      hk.quaternion.copy(qTilt).multiply(qYaw);
    } else {
      hk.quaternion.copy(qYaw);
    }
    ropes.forEach((m, i) => {
      const sg = i ? 1 : -1;
      vTop.set(Pw.x + dir.x * .25 * sg, Pw.y, Pw.z + dir.z * .25 * sg);
      vBot.set(.25 * sg, .2, 0).applyQuaternion(hk.quaternion).add(hk.position);
      const len = Math.max(.01, vTop.distanceTo(vBot));
      m.position.copy(vTop).add(vBot).multiplyScalar(.5);
      m.quaternion.setFromUnitVectors(Y_AXIS, vUp.copy(vTop).sub(vBot).normalize());
      m.scale.y = len;
    });
  }

  function update() {
    const ang = V.boom * Math.PI / 180, c = Math.cos(ang), s = Math.sin(ang);
    up.rotation.y = V.slew * Math.PI / 180;
    bp.rotation.z = ang;
    t1.position.x = V.ext * 5.2 * k;
    t2.position.x = V.ext * 4.8 * k;

    OUT.forEach((o) => {
      const d = V.out, padY = .62 - .55 * d, Lr = Math.max(.01, -.04 + .55 * d);
      o.sl.position.z = o.s * d * reachZ;
      o.mid.position.z = o.s * d * reachZ / 2;
      o.pg.position.y = padY - 1;
      o.rod.scale.y = Lr; o.rod.position.y = -.35 - Lr / 2; o.rod.visible = Lr > .03;
    });

    const Ux = px + 3.2 * c + .5 * s, Uy = BOOM_PIVOT_Y + 3.2 * s - .5 * c, Lx = -.6, Ly = 1.3;
    LC.forEach((l) => {
      l.cg.position.x = Lx; l.cg.position.y = Ly;
      l.cg.rotation.z = Math.atan2(Uy - Ly, Ux - Lx);
      const d = Math.hypot(Ux - Lx, Uy - Ly), Lr = d - 1.7;
      l.rod.scale.y = Lr; l.rod.position.x = 1.7 + Lr / 2;
    });

    root.updateMatrixWorld(true);
    ap.getWorldPosition(Pw); ap.getWorldQuaternion(Q);
    dir.set(1, 0, 0).applyQuaternion(Q); dir.y = 0; dir.normalize();
    const len = 1.5 + (1 - V.hook) * 9;
    hookY = Math.max(Pw.y - len, 4.4);
    hookDrop = Math.max(Pw.y - hookY, 0);
    placeHook();
  }

  /**
   * Moves the model. Any field that is missing or not a finite number is ignored
   * (the model keeps its last value). Angles in degrees, lengths in metres,
   * in DATA conventions (same as the CSV / stability.js).
   *   boomAngleDeg   luff angle, clamped to 5..85
   *   boomLengthM    pivot-to-head length, clamped to the model's 23.35..53.35 m
   *   slewDeg        slew angle; 0 = +x, 90 = +z (mirrored internally)
   *   outriggerExt   0 retracted .. 1 fully out
   *   loadT          tonnes; the load block is shown only when > 0.05
   *   windKmh        wind speed; drives the sway of the hanging load (see tick)
   */
  function setPose(p = {}) {
    if (Number.isFinite(p.windKmh)) V.wind = Math.max(0, p.windKmh);
    if (Number.isFinite(p.boomAngleDeg)) V.boom = clamp(p.boomAngleDeg, BOOM_ANGLE_MIN_DEG, BOOM_ANGLE_MAX_DEG);
    const ext = boomExtensionFromLength(p.boomLengthM);
    if (ext !== null) V.ext = ext;
    if (Number.isFinite(p.slewDeg)) V.slew = -p.slewDeg;
    if (Number.isFinite(p.outriggerExt)) V.out = clamp(p.outriggerExt, 0, 1);
    if (Number.isFinite(p.loadT)) loadRig.visible = p.loadT > 0.05;
    if (Number.isFinite(p.hookFraction)) V.hook = clamp(p.hookFraction, 0, 1);
    update();
  }

  /**
   * Call once per screen frame with a screen-time clock in seconds (for example
   * performance.now() / 1000). It animates the wind sway only; it does not touch the
   * telemetry clock and is not used as time anywhere in the logic.
   * The wind speed is eased (about 0.7 s) so a step in the data does not make the load jump.
   */
  function tick(tSec) {
    if (!Number.isFinite(tSec)) return;
    const dt = V.tLast === null ? 0 : clamp(tSec - V.tLast, 0, 0.1);
    V.tLast = tSec;
    V.windSmooth += (V.wind - V.windSmooth) * (1 - Math.exp(-dt / 0.7));
    const s = swayFromWind(V.windSmooth, tSec);
    if (!s) return;
    V.swayAlongDeg = s.alongDeg;
    V.swayCrossDeg = s.crossDeg;
    placeHook();
  }

  /** Current sway of the load in degrees (along the wind, across it). */
  function swayDeg() { return { along: V.swayAlongDeg, cross: V.swayCrossDeg }; }

  /** World position of the boom head (where the rope leaves). The hook hangs below it. */
  function headWorld() { return { x: Pw.x, y: Pw.y, z: Pw.z }; }

  /** World position of the hook block (moves with the sway). */
  function hookWorld() { return { x: hk.position.x, y: hk.position.y, z: hk.position.z }; }

  /** World positions of the four pads, in the order +x/+z, +x/-z, -x/+z, -x/-z. */
  function padWorld() {
    const v = new T.Vector3();
    return OUT.map((o) => { o.pg.getWorldPosition(v); return { x: v.x, y: v.y, z: v.z }; });
  }

  function dispose() {
    scene.remove(root);
    root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    [Y, Yd, K, G, Cr, Rb, Gl, Lt, Tr, Str, Gs].forEach((m) => m.dispose());
    stripeTex.dispose();
  }

  setPose({});   // place everything once

  return { root, setPose, tick, swayDeg, headWorld, hookWorld, padWorld, isLoadVisible: () => loadRig.visible, dispose };
}


// ------------------------------------------------------------
// Ground overlay: support polygon + load ground point
// Both are drawn from DATA (stability.js polygon, loadGroundPosition),
// never from the model, so the view cannot disagree with the logic
// without it being visible.
// ------------------------------------------------------------

/**
 * @param polygon  [{x, z}, ...] from stability.js outriggerPolygonForSpread()
 * @returns { setLoadPoint(x, z), setPolygonColor(hex), dispose() }
 */
export function createGroundOverlay(THREE, scene, polygon) {
  const T = THREE;
  const group = new T.Group();
  scene.add(group);

  const edgeMat = new T.MeshBasicMaterial({ color: 0xf4b400 });
  const edges = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const m = new T.Mesh(new T.BoxGeometry(len, .02, .18), edgeMat);
    m.position.set((a.x + b.x) / 2, .07, (a.z + b.z) / 2);
    m.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    group.add(m);
    edges.push(m);
  }

  const markMat = new T.MeshBasicMaterial({ color: 0x2ecc71, side: T.DoubleSide, transparent: true, opacity: .95 });
  const ring = new T.Mesh(new T.RingGeometry(.6, .9, 40), markMat);
  const dot = new T.Mesh(new T.CircleGeometry(.25, 20), markMat);
  [ring, dot].forEach((m) => { m.rotation.x = -Math.PI / 2; m.position.y = .08; group.add(m); });

  return {
    setLoadPoint(x, z) { ring.position.x = dot.position.x = x; ring.position.z = dot.position.z = z; },
    setPolygonColor(hex) { edgeMat.color.setHex(hex); },
    dispose() {
      scene.remove(group);
      edges.forEach((m) => m.geometry.dispose());
      ring.geometry.dispose(); dot.geometry.dispose(); edgeMat.dispose(); markMat.dispose();
    },
  };
}
