// panel.js — Abhishek's Sensor Panel (Cycle 2)
// Consumes Ajit's loadchart.js and Sujal's stability.js UNCHANGED — this file only
// wires their functions to live inputs and a readout. No load-chart or stability
// logic is duplicated or reimplemented here.

import { CHART, ratedCapacity, radiusFromAngle } from './loadchart.js';
import { stabilityVerdict, loadGroundPosition, outriggerPolygonForSpread, combinedCoG } from './stability.js';

// Real outrigger footprint from the Grove GMK5250L-1 product guide (page 13/17):
// "8,95 x 7,8 m". Longitudinal x lateral spread, centred on the slew axis.
const OUTRIGGER_SPREAD_X = 8.95;
const OUTRIGGER_SPREAD_Z = 7.8;

// ASSUMPTION, not a manufacturer figure: the raw hook-load ground position alone
// (STARTER-KIT §4 step 2) sits outside an 8.95x7.8m footprint at almost any real
// working radius — the outriggers are metres wide, the boom reaches tens of metres.
// Sujal's stability.js explicitly documents combinedCoG() as "a truer tipping check"
// for exactly this reason. We assume the crane's own unladen mass and centre it on
// the slew axis; state this assumption if asked in the Q&A, it is not from the PDF.
const MACHINE_MASS_T = 72;
const MACHINE_X = 0;
const MACHINE_Z = 0;

// Thresholds (stated assumption, not manufacturer data): warn at 85% of rated
// capacity, critical at/over 100%. This is what the "sensor panel" reads off
// the load chart — it does not change ratedCapacity()'s own logic.
const WARN_UTILIZATION = 0.85;
const WARN_MARGIN_M = 1.5; // matches stability.js DEFAULT_WARN_MARGIN_M

const state = {
  boomLengthM: 30,
  boomAngleDeg: 60,
  slewDeg: 0,
  loadT: 15,
  outriggerDeployed: true,
};

let demoTimer = null;
let demoStartedAt = 0;
const DEMO_SCRIPT = [
  // 1. Short radius, light load — normal.
  { t: 0,      boomLengthM: 20, boomAngleDeg: 75, slewDeg: 0,  loadT: 8,  outriggerDeployed: true },
  // 2. Boom out, load up — still normal, heading toward warning.
  { t: 4500,   boomLengthM: 38, boomAngleDeg: 50, slewDeg: 20, loadT: 22, outriggerDeployed: true },
  // 3. Long radius, moderate load — approaching the rated limit (warning).
  { t: 9500,   boomLengthM: 55, boomAngleDeg: 35, slewDeg: 30, loadT: 32, outriggerDeployed: true },
  // 4. Push the load further at that same long radius — overload (chart) and likely tipping (geometry) together.
  { t: 14500,  boomLengthM: 55, boomAngleDeg: 35, slewDeg: 30, loadT: 46, outriggerDeployed: true },
  // 5. Back to the short, light configuration from step 1 — but outriggers stowed.
  //    Isolates the stability check: the load chart alone would call this fine.
  { t: 19500,  boomLengthM: 20, boomAngleDeg: 75, slewDeg: 0,  loadT: 8,  outriggerDeployed: false },
  // 6. Redeploy and reset to the default baseline.
  { t: 24000,  boomLengthM: 30, boomAngleDeg: 60, slewDeg: 0,  loadT: 15, outriggerDeployed: true },
  { t: 28000,  boomLengthM: 30, boomAngleDeg: 60, slewDeg: 0,  loadT: 15, outriggerDeployed: true },
];
const DEMO_DURATION = DEMO_SCRIPT[DEMO_SCRIPT.length - 1].t;

function lerp(a, b, f) { return a + (b - a) * f; }

function demoFrameAt(elapsed) {
  const t = elapsed % DEMO_DURATION;
  let i = 0;
  while (i < DEMO_SCRIPT.length - 2 && DEMO_SCRIPT[i + 1].t <= t) i++;
  const a = DEMO_SCRIPT[i], b = DEMO_SCRIPT[i + 1];
  const span = b.t - a.t;
  const f = span > 0 ? (t - a.t) / span : 0;
  return {
    boomLengthM: lerp(a.boomLengthM, b.boomLengthM, f),
    boomAngleDeg: lerp(a.boomAngleDeg, b.boomAngleDeg, f),
    slewDeg: lerp(a.slewDeg, b.slewDeg, f),
    loadT: lerp(a.loadT, b.loadT, f),
    // outrigger state switches at the earlier keyframe, no interpolation for a boolean
    outriggerDeployed: a.outriggerDeployed,
  };
}

// ---- DOM refs ----
const el = (id) => document.getElementById(id);
const refs = {
  boomLength: el('inBoomLength'), boomLengthVal: el('valBoomLength'),
  boomAngle: el('inBoomAngle'), boomAngleVal: el('valBoomAngle'),
  slew: el('inSlew'), slewVal: el('valSlew'),
  load: el('inLoad'), loadVal: el('valLoad'),
  outrigger: el('inOutrigger'),
  demoBtn: el('btnDemo'), resetBtn: el('btnReset'),
  clock: el('clock'),
  alertBanner: el('alertBanner'), alertLabel: el('alertLabel'), alertReason: el('alertReason'),
  tileLoad: el('tileLoad'), tileAngle: el('tileAngle'), tileLength: el('tileLength'),
  tileRadius: el('tileRadius'), tileOutrigger: el('tileOutrigger'), tilePressure: el('tilePressure'),
  capVal: el('capVal'), capNote: el('capNote'),
  utilVal: el('utilVal'), utilFill: el('utilFill'),
  stabVal: el('stabVal'), stabFill: el('stabFill'),
  lastUpdated: el('lastUpdated'),
};

function fmt(n, d = 1) { return Number.isFinite(n) ? n.toFixed(d) : '—'; }

// ---- Hydraulic pressure: MODELLED, not measured. Assumption stated in the UI. ----
function hydraulicPressureBar(loadT, capacityT, nowMs) {
  const util = capacityT ? Math.min(loadT / capacityT, 1.4) : 1.2;
  const base = 60, span = 260;
  const jitter = Math.sin(nowMs / 900) * 2 + (Math.sin(nowMs / 233) * 0.8);
  return Math.max(0, base + span * Math.min(util, 1) + jitter);
}

function classifyOverall(capacityT, utilization, verdict) {
  if (capacityT == null) {
    return { level: 'critical', label: 'NOT RATED', reason: 'Boom length + radius fall outside the charted region (or cross a blank cell) — this configuration is not permitted. Refusing to report a capacity rather than guessing.' };
  }
  const overloaded = utilization >= 1.0;
  const tipping = verdict === 'tipping';
  if (overloaded && tipping) {
    return { level: 'critical', label: 'CRITICAL', reason: `Load exceeds rated capacity (${Math.round(utilization * 100)}%) and the load position is outside the outrigger support polygon.` };
  }
  if (overloaded) {
    return { level: 'critical', label: 'CRITICAL — OVERLOAD', reason: `Load is ${Math.round(utilization * 100)}% of rated capacity for this radius/boom length.` };
  }
  if (tipping) {
    return { level: 'critical', label: 'CRITICAL — TIPPING', reason: 'Load position is outside the outrigger support polygon (or outriggers are not deployed).' };
  }
  if (utilization >= WARN_UTILIZATION || verdict === 'warn') {
    return { level: 'warning', label: 'WARNING', reason: utilization >= WARN_UTILIZATION ? `Approaching rated capacity (${Math.round(utilization * 100)}%).` : 'Load position is close to the edge of the outrigger support polygon.' };
  }
  return { level: 'ok', label: 'NORMAL OPERATION', reason: 'Within rated capacity and inside the outrigger support polygon.' };
}

function render(nowMs) {
  const { boomLengthM, boomAngleDeg, slewDeg, loadT, outriggerDeployed } = state;

  // Reflect current control values (also used when demo mode drives sliders)
  refs.boomLength.value = boomLengthM;
  refs.boomAngle.value = boomAngleDeg;
  refs.slew.value = slewDeg;
  refs.load.value = loadT;
  refs.outrigger.value = outriggerDeployed ? 'full' : 'stowed';
  refs.boomLengthVal.textContent = `${fmt(boomLengthM, 1)} m`;
  refs.boomAngleVal.textContent = `${fmt(boomAngleDeg, 1)}°`;
  refs.slewVal.textContent = `${fmt(slewDeg, 0)}°`;
  refs.loadVal.textContent = `${fmt(loadT, 1)} t`;

  // ---- Ajit's module: radius + rated capacity ----
  const radiusM = radiusFromAngle(boomLengthM, boomAngleDeg, 0);
  const capacityT = ratedCapacity(CHART, boomLengthM, radiusM);
  const utilization = capacityT ? loadT / capacityT : null;

  // ---- Sujal's module: support-polygon stability ----
  const polygon = outriggerDeployed ? outriggerPolygonForSpread(OUTRIGGER_SPREAD_X, OUTRIGGER_SPREAD_Z) : null;
  const pos = loadGroundPosition(radiusM, slewDeg);
  const cog = combinedCoG(MACHINE_X, MACHINE_Z, MACHINE_MASS_T, pos.x, pos.z, loadT);
  const verdict = stabilityVerdict(cog.x, cog.z, polygon, { warnMarginM: WARN_MARGIN_M });

  const pressureBar = hydraulicPressureBar(loadT, capacityT, nowMs);

  // ---- 6-field sensor readout ----
  refs.tileLoad.querySelector('.tile-value').innerHTML = `${fmt(loadT, 1)}<span class="unit">t</span>`;
  refs.tileAngle.querySelector('.tile-value').innerHTML = `${fmt(boomAngleDeg, 1)}<span class="unit">°</span>`;
  refs.tileLength.querySelector('.tile-value').innerHTML = `${fmt(boomLengthM, 1)}<span class="unit">m</span>`;
  refs.tileRadius.querySelector('.tile-value').innerHTML = `${fmt(radiusM, 2)}<span class="unit">m</span>`;
  refs.tileOutrigger.querySelector('.tile-value').textContent = outriggerDeployed ? 'DEPLOYED' : 'STOWED';
  refs.tilePressure.querySelector('.tile-value').innerHTML = `${fmt(pressureBar, 0)}<span class="unit">bar</span>`;

  refs.tileOutrigger.classList.toggle('state-crit', !outriggerDeployed);
  refs.tileOutrigger.classList.toggle('state-warn', false);

  // ---- Derived status ----
  if (capacityT == null) {
    refs.capVal.textContent = 'NOT RATED';
    refs.capVal.className = 'status-item-val crit';
    refs.capNote.textContent = 'Query is outside the charted boom-length / radius region.';
  } else {
    refs.capVal.textContent = `${fmt(capacityT, 2)} t`;
    refs.capVal.className = 'status-item-val ok';
    refs.capNote.textContent = `Grove GMK5250L-1 · ${CHART.config}`;
  }

  const utilPct = utilization == null ? 0 : Math.min(utilization * 100, 140);
  const utilLevel = utilization == null ? 'crit' : utilization >= 1 ? 'crit' : utilization >= WARN_UTILIZATION ? 'warn' : 'ok';
  refs.utilVal.textContent = utilization == null ? '—' : `${Math.round(utilization * 100)}%`;
  refs.utilVal.className = `status-item-val ${utilLevel}`;
  refs.utilFill.style.width = `${Math.min(utilPct, 100)}%`;
  refs.utilFill.className = `status-fill ${utilLevel}`;

  const stabLevel = verdict === 'ok' ? 'ok' : verdict === 'warn' ? 'warn' : 'crit';
  refs.stabVal.textContent = verdict.toUpperCase();
  refs.stabVal.className = `status-item-val ${stabLevel}`;
  const stabPct = verdict === 'ok' ? 85 : verdict === 'warn' ? 45 : 8;
  refs.stabFill.style.width = `${stabPct}%`;
  refs.stabFill.className = `status-fill ${stabLevel}`;

  // ---- Overall banner ----
  const overall = classifyOverall(capacityT, utilization, verdict);
  refs.alertBanner.className = `alert-banner level-${overall.level}`;
  refs.alertLabel.textContent = overall.label;
  refs.alertReason.textContent = overall.reason;

  refs.lastUpdated.textContent = new Date(nowMs).toLocaleTimeString();
}

function readControlsIntoState() {
  state.boomLengthM = parseFloat(refs.boomLength.value);
  state.boomAngleDeg = parseFloat(refs.boomAngle.value);
  state.slewDeg = parseFloat(refs.slew.value);
  state.loadT = parseFloat(refs.load.value);
  state.outriggerDeployed = refs.outrigger.value === 'full';
}

function stopDemo() {
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
  refs.demoBtn.classList.remove('active');
  refs.demoBtn.textContent = 'Run demo sequence';
}

function startDemo() {
  demoStartedAt = Date.now();
  refs.demoBtn.classList.add('active');
  refs.demoBtn.textContent = 'Stop demo sequence';
  demoTimer = setInterval(() => {
    const elapsed = Date.now() - demoStartedAt;
    Object.assign(state, demoFrameAt(elapsed));
    render(Date.now());
  }, 100);
}

function wireEvents() {
  ['boomLength', 'boomAngle', 'slew', 'load'].forEach((key) => {
    refs[key].addEventListener('input', () => {
      stopDemo();
      readControlsIntoState();
      render(Date.now());
    });
  });
  refs.outrigger.addEventListener('change', () => {
    stopDemo();
    readControlsIntoState();
    render(Date.now());
  });
  refs.demoBtn.addEventListener('click', () => {
    if (demoTimer) stopDemo(); else startDemo();
  });
  refs.resetBtn.addEventListener('click', () => {
    stopDemo();
    Object.assign(state, { boomLengthM: 30, boomAngleDeg: 60, slewDeg: 0, loadT: 15, outriggerDeployed: true });
    render(Date.now());
  });
}

// Independent tick so hydraulic pressure + clock look "live" even with no input change
function startClock() {
  setInterval(() => { if (!demoTimer) render(Date.now()); }, 700);
}

export function initSensorPanel() {
  wireEvents();
  render(Date.now());
  startClock();
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initSensorPanel);
}
