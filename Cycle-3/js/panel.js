// ============================================================
// Cycle 3 - Mobile Crane Digital Twin
// Module 4 - Sensor Panel & Alarm UI : the drawing (DOM only)
//
// Owner: Abhishek
//
// Draws the view-model made by panelModel.js. It has no crane, chart or
// stability logic and keeps no state of its own about the crane.
//
// The page gives it a root element that contains elements marked with
//   data-f="<name>"      text + colour class of one value
//   data-slider="<name>" a range input (load, boomLength, boomAngle, slew, wind)
//   data-outriggers      the outrigger select
// (see Cycle-3/simulator.html).
//
// Sliders:
//   LIVE   -> setSliders() makes them mirror the incoming telemetry
//   touch  -> onManualInput(controls) is called: the page switches to MANUAL
// ============================================================

const SLIDERS = {
  loadT: 'load',
  boomLengthM: 'boomLength',
  boomAngleDeg: 'boomAngle',
  slewDeg: 'slew',
  windKmh: 'wind',
};

const FIELD_FORMAT = { loadT: [1, 't'], boomLengthM: [1, 'm'], boomAngleDeg: [1, '°'], slewDeg: [0, '°'], windKmh: [0, 'km/h'] };

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * @param root      element that contains the panel markup
 * @param handlers  { onManualInput(controls), onReturnLive() }
 */
export function createSensorPanel(root, handlers = {}) {
  const $f = (name) => root.querySelector(`[data-f="${name}"]`);
  const sliders = {};
  for (const [key, name] of Object.entries(SLIDERS)) sliders[key] = root.querySelector(`[data-slider="${name}"]`);
  const outriggers = root.querySelector('[data-outriggers]');
  const alarmList = root.querySelector('[data-f="alarms"]');
  const utilFill = root.querySelector('[data-f="utilFill"]');
  const returnBtn = root.querySelector('[data-return-live]');

  const set = (name, item) => {
    const e = $f(name);
    if (!e || !item) return;
    e.textContent = item.text;
    e.dataset.cls = item.cls || 'ok';
    // long words (NOT PERMITTED, NOT EVALUATED) are shown smaller instead of being cut off
    if (e.classList.contains('v')) e.dataset.long = item.text.length > 9 ? '1' : '0';
  };
  const setText = (name, text) => { const e = $f(name); if (e) e.textContent = text; };

  function labels() {
    for (const [key, s] of Object.entries(sliders)) {
      if (!s) continue;
      const out = root.querySelector(`[data-slider-val="${SLIDERS[key]}"]`);
      const [d, u] = FIELD_FORMAT[key];
      if (out) out.textContent = `${Number(s.value).toFixed(d)} ${u}`;
    }
  }

  function readSliders() {
    return {
      loadT: Number(sliders.loadT.value),
      boomLengthM: Number(sliders.boomLengthM.value),
      boomAngleDeg: Number(sliders.boomAngleDeg.value),
      slewDeg: Number(sliders.slewDeg.value),
      windKmh: Number(sliders.windKmh.value),
      outriggerState: outriggers.value,
    };
  }

  /** Make the sliders mirror a set of control values (LIVE mode). Does not fire input events. */
  function setSliders(c) {
    for (const [key, s] of Object.entries(sliders)) {
      if (s && Number.isFinite(c[key])) s.value = String(c[key]);
    }
    if (outriggers && c.outriggerState) {
      // the select only offers the two states a person can choose; show the real one as a label
      const has = [...outriggers.options].some((o) => o.value === c.outriggerState);
      if (has) outriggers.value = c.outriggerState;
    }
    labels();
  }

  // user touches a slider -> MANUAL
  const touched = () => { labels(); if (handlers.onManualInput) handlers.onManualInput(readSliders()); };
  Object.values(sliders).forEach((s) => s && s.addEventListener('input', touched));
  if (outriggers) outriggers.addEventListener('change', touched);
  if (returnBtn) returnBtn.addEventListener('click', () => handlers.onReturnLive && handlers.onReturnLive());

  function renderAlarms(list) {
    if (!alarmList) return;
    alarmList.textContent = '';
    if (!list.length) {
      alarmList.appendChild(el('li', 'alarm empty', 'No alarms yet.'));
      return;
    }
    for (const a of list) {
      const li = el('li', `alarm sev-${a.severity} ${a.active ? 'is-active' : 'is-cleared'}`);
      li.title = a.firstTs || '';
      const head = el('div', 'a-head');
      head.appendChild(el('span', 'a-type', a.type));
      const tags = el('span', 'a-tags');
      if (a.kind === 'device') tags.appendChild(el('span', 'tag', 'DEVICE'));
      if (a.kind === 'panel') tags.appendChild(el('span', 'tag', 'CHART'));
      if (a.kind === 'data') tags.appendChild(el('span', 'tag', 'DATA'));
      if (a.simulated) tags.appendChild(el('span', 'tag sim', 'SIMULATED'));
      tags.appendChild(el('span', 'tag state', a.active ? 'ACTIVE' : `cleared ${a.clearedAt || ''}`.trim()));
      head.appendChild(tags);
      li.appendChild(head);
      const meta = el('div', 'a-meta');
      meta.appendChild(el('span', 'a-val', a.valueText));
      meta.appendChild(el('span', 'a-since', `first at ${a.first}`));
      li.appendChild(meta);
      li.appendChild(el('div', 'a-rule', a.rule));
      if (a.note) li.appendChild(el('div', 'a-note', a.note));
      alarmList.appendChild(li);
    }
  }

  function render(vm) {
    set('mode', vm.mode);
    const manual = vm.mode.key === 'MANUAL';
    root.dataset.mode = vm.mode.key;
    root.dataset.dropout = vm.dropout ? '1' : '0';          // NO DATA: the sensor values are greyed (held)
    if (returnBtn) returnBtn.hidden = !manual;
    set('quality', { text: vm.quality.level === 'OK' ? 'DATA OK' : vm.quality.text, cls: vm.quality.cls });
    setText('qualityDetail', vm.quality.detail);
    setText('time', vm.time.text);

    for (const k of Object.keys(vm.fields)) set(k, vm.fields[k]);
    setText('pressureSub', vm.fields.pressure.sub);
    for (const k of ['FL', 'FR', 'RL', 'RR']) set('pad' + k, vm.pads[k]);
    setText('padNote', vm.pads.note);

    set('capacity', vm.capacity);
    setText('capacitySub', vm.capacity.sub);
    set('utilisation', vm.utilisation);
    if (utilFill) { utilFill.style.width = `${vm.utilisation.pct}%`; utilFill.dataset.cls = vm.utilisation.cls; }
    set('stability', vm.stability);
    setText('stabilitySub', vm.stability.sub);
    set('lmiDevice', { text: vm.lmi.text, cls: vm.lmi.cls });
    setText('lmiChart', vm.lmi.computed);
    const lm = $f('lmiMismatch');
    if (lm) lm.hidden = !vm.lmi.mismatch;

    for (const chip of vm.chips) {
      const c = root.querySelector(`[data-chip="${chip.key}"]`);
      if (c) c.dataset.on = chip.on ? '1' : '0';
    }
    root.querySelectorAll('[data-chip]').forEach((c) => {
      if (!vm.chips.some((x) => x.key === c.dataset.chip)) c.dataset.on = 'na';   // not available in MANUAL
    });

    set('bannerLabel', { text: vm.banner.label, cls: vm.banner.cls });
    setText('bannerReason', vm.banner.reason);
    const banner = $f('banner');
    if (banner) banner.dataset.cls = vm.banner.cls;

    setText('countCritical', String(vm.counts.critical));
    setText('countWarning', String(vm.counts.warning));
    setText('countData', String(vm.counts.data));
    renderAlarms(vm.alarms);
  }

  labels();
  return { render, setSliders, readSliders };
}
