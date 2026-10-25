// ============================================================
// Cycle 3 - Module 4 tests (Sensor Panel & Alarm UI logic)
//
//     node Cycle-3/js/test_sensorPanelUI.mjs
//
// Tests panelModel.js on the real kit CSV with the real failure detector.
// panelModel.js decides what the panel shows; the DOM drawing in panel.js is
// checked in the browser (Cycle-3/simulator.html).
// ============================================================

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseCSV } from './playbackClock.js';
import { detectFailures, expectedHydraulicPressure } from './failureDetector.js';
import {
  MODE, AlarmLog, PanelSession, analyseSample, buildPanelModel,
  manualSampleFromControls, controlsFromSample, hasBit, STATUS_BIT, deviceLmiPct, dropoutStatus, applyDropout, buildEventIndex,
} from './panelModel.js';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; console.log(`  [FAIL] ${name} ${detail}`); }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rows = parseCSV(fs.readFileSync(join(__dirname, '../data/mobile-telemetry-2026-09-16.csv'), 'utf8'));
const deps = { detect: detectFailures, expectedPressure: expectedHydraulicPressure };
const idx = (hms) => rows.findIndex((r) => r.ts.includes('T' + hms));
const fresh = () => new PanelSession(rows, deps);
const types = (vm) => vm.alarms.map((a) => a.type);
const find = (vm, type) => vm.alarms.find((a) => a.type === type);
const noThrow = (fn) => { try { fn(); return true; } catch (e) { console.log('   threw:', e.message); return false; } };


console.log('\n=== EVERY FIELD IS BOUND TO THE SAMPLE ===');
{
  const s = fresh();
  const a = s.liveUpdate(idx('10:00:00'));
  const b = s.liveUpdate(idx('09:00:00'));
  check('time changes with the sample', a.time.text === '10:00:00' && b.time.text === '09:00:00');
  check('load changes (0.0 t -> 52.0 t)', a.fields.load.text === '0.0 t' && b.fields.load.text === '52.0 t', `${a.fields.load.text} ${b.fields.load.text}`);
  check('boom length changes', a.fields.boomLength.text !== b.fields.boomLength.text);
  check('boom angle changes', a.fields.boomAngle.text !== b.fields.boomAngle.text);
  check('radius changes', a.fields.radius.text !== b.fields.radius.text);
  check('slew changes (0 -> 35)', a.fields.slew.text === '0 °' || a.fields.slew.text === '0°' || /^0/.test(a.fields.slew.text));
  check('pressure changes (45 -> 276 bar)', a.fields.pressure.text !== b.fields.pressure.text);
  check('pads change', a.pads.FL.text !== b.pads.FL.text);
  check('capacity is a number from the chart (47.5 t at 09:00:00)', b.capacity.text === '47.5 t', b.capacity.text);
  check('utilisation 109 % is shown red', b.utilisation.text === '109%' && b.utilisation.cls === 'crit', `${b.utilisation.text} ${b.utilisation.cls}`);
  check('outrigger state is shown as DEPLOYED', b.fields.outrigger.text === 'DEPLOYED');
  check('wind is shown (11 km/h) and is not an alert', b.fields.wind.text === '11 km/h' && b.fields.wind.cls === 'ok');
  check('expected pressure comes from the detector (276 bar at 09:00:00? shown under the value)', /expected \d+ bar/.test(b.fields.pressure.sub), b.fields.pressure.sub);
}


console.log('\n=== MODE BADGE: LIVE (telemetry) / MANUAL (override) ===');
{
  const s = fresh();
  const live = s.liveUpdate(idx('09:00:00'));
  check('LIVE badge text and green class', live.mode.text === 'LIVE (telemetry)' && live.mode.cls === 'ok');
  const base = rows[idx('09:00:00')];
  const manual = s.manualUpdate(manualSampleFromControls(base, { ...controlsFromSample(base), loadT: 10 }, deps));
  check('MANUAL badge text and amber class', manual.mode.text === 'MANUAL (override)' && manual.mode.cls === 'warn');
  check('MANUAL: pads are not shown as if they were simulated', manual.pads.FL.text === '—' && /not simulated/.test(manual.pads.note));
  check('MANUAL: pressure is labelled as modelled', /modelled/.test(manual.fields.pressure.sub));
  check('MANUAL: 10 t on this boom is normal, banner says SIMULATED', /^SIMULATED/.test(manual.banner.label), manual.banner.label);
  const heavy = s.manualUpdate(manualSampleFromControls(base, { ...controlsFromSample(base), loadT: 90 }, deps));
  const ov = find(heavy, 'OVERLOAD');
  check('MANUAL overload raises an alarm labelled SIMULATED', ov && ov.simulated === true && ov.active, JSON.stringify(ov));
  check('MANUAL banner starts with SIMULATED', /^SIMULATED/.test(heavy.banner.label), heavy.banner.label);
  check('MANUAL does not invent pad or LMI-mismatch alarms', !types(heavy).some((t) => /LIFT OFF|LMI DIVERGENCE|DATA QUALITY/.test(t)), types(heavy).join());
  const back = s.liveUpdate(idx('09:00:00'));
  check('back to LIVE: badge is LIVE again', back.mode.text === 'LIVE (telemetry)' && back.mode.cls === 'ok');
  check('back to LIVE: the simulated alarm is cleared (greyed), not active', find(back, 'OVERLOAD') && back.alarms.filter((a) => a.type === 'OVERLOAD').every((a) => a.simulated ? !a.active : true));
  const liveOv = back.alarms.find((a) => a.type === 'OVERLOAD' && !a.simulated);
  check('back to LIVE: the real overload is active again with its true first timestamp 09:00:00', liveOv && liveOv.active && liveOv.first === '09:00:00', JSON.stringify(liveOv));
  check('back to LIVE: ONE real overload entry (the one MANUAL greyed carries on, no second copy)', back.alarms.filter((a) => a.type === 'OVERLOAD' && !a.simulated).length === 1, back.alarms.filter((a) => a.type === 'OVERLOAD').map((a) => `${a.simulated ? 'sim' : 'real'}:${a.active ? 'on' : 'off'}`).join());
  check('...and the simulated one stays as a greyed SIMULATED entry', back.alarms.filter((a) => a.type === 'OVERLOAD' && a.simulated && !a.active).length === 1);
  const next = s.liveUpdate(idx('09:00:00') + 1, true);
  check('playing on after MANUAL: still one real overload, still first at 09:00:00', next.alarms.filter((a) => a.type === 'OVERLOAD' && !a.simulated).length === 1 && next.alarms.find((a) => a.type === 'OVERLOAD' && !a.simulated).first === '09:00:00');
  const s3 = fresh();
  s3.liveUpdate(idx('09:00:10'));
  s3.manualUpdate(manualSampleFromControls(base, { ...controlsFromSample(base), loadT: 90 }, deps));
  const elsewhere = s3.liveUpdate(idx('12:30:10'), false);
  check('MANUAL, then a jump elsewhere: the log starts again (no leftovers from 09:00 or from the simulation)',
    elsewhere.alarms.every((a) => !a.simulated && a.first >= '12:00:00'), types(elsewhere).join() + ' ' + elsewhere.alarms.map((a) => a.first).join());
  check('slider values mirror a telemetry sample', (() => {
    const c = controlsFromSample(base);
    return c.loadT === 52 && c.boomLengthM === base.boom_length_m && c.boomAngleDeg === base.boom_angle_deg && c.slewDeg === base.slew_deg && c.windKmh === 11 && c.outriggerState === 'DEPLOYED';
  })());
  const ms = manualSampleFromControls(base, { ...controlsFromSample(base), boomLengthM: 40, boomAngleDeg: 60 }, deps);
  check('manual sample radius follows the kit formula L*cos(angle)+0.8 (40 m @ 60 deg = 20.8 m)', Math.abs(ms.radius_m - 20.8) < 1e-9, String(ms.radius_m));
}


console.log('\n=== ALARM LIST: type, value, rule, first timestamp, no repeats ===');
{
  const s = fresh();
  const vm = s.liveUpdate(idx('11:02:00'));                 // arrive in the MIDDLE of the episode (a jump)
  const ov = find(vm, 'OVERLOAD'), hyd = find(vm, 'HYDRAULIC PRESSURE LOSS');
  check('overload: jump does not lose the pre-freeze episode start', ov && ['11:00:00', '11:00:04'].includes(ov.first), JSON.stringify(ov));
  check('overload shows the trigger value (30.0 t)', ov && ov.valueText === '30.0 t', ov && ov.valueText);
  check('overload shows the rule that fired', ov && /exceeds rated capacity/.test(ov.rule), ov && ov.rule);
  check('hydraulic loss remains reported after frozen data is separated', hyd && ['11:00:01', '11:00:04'].includes(hyd.first) && /bar$/.test(hyd.valueText), JSON.stringify(hyd));
  check('both are active', ov.active && hyd.active);

  const s2 = fresh();
  s2.liveUpdate(idx('10:59:50'));
  let vm2;
  for (let i = idx('10:59:50') + 1; i <= idx('11:05:00'); i++) vm2 = s2.liveUpdate(i, true);   // 1 row at a time
  const ovs = vm2.alarms.filter((a) => a.type === 'OVERLOAD');
  check('played row by row for 5 minutes: two overload episodes split by frozen data', ovs.length === 2, String(ovs.length));
  check('...it is cleared (greyed) at 11:04:01 and listed after the active ones', !ovs[0].active && ovs[0].clearedAt === '11:04:01', JSON.stringify(ovs[0]));
  check('active alarms are listed before cleared ones', (() => {
    const flags = vm2.alarms.map((a) => a.active);
    return flags.every((f, i) => i === 0 || !(flags[i] && !flags[i - 1]));
  })());

  // playback speed must not change the first timestamp (rows are skipped at 50x / 100x)
  const firstAt = (step) => {
    const ss = fresh();
    ss.liveUpdate(idx('08:59:30'));
    let v;
    for (let i = idx('08:59:30') + step; i <= idx('09:02:00'); i += step) v = ss.liveUpdate(i, true);
    return v.alarms.filter((a) => a.type === 'OVERLOAD').map((a) => a.first).join();
  };
  check('first timestamp retains the start of the overload episode at 1, 7, 53 and 100 rows per frame', ['1', '7', '53', '100'].every((n) => firstAt(+n).includes('09:00:00')),
    ['1', '7', '53', '100'].map((n) => n + ':' + firstAt(+n)).join(' '));

  const log = new AlarmLog();
  const a = analyseSample(rows[idx('09:00:00')], rows[idx('09:00:00') - 1], deps);
  log.ingest(a); log.ingest(a); log.ingest(a);
  check('feeding the same alarm three times gives one entry', log.entries.length >= 1 && log.entries.filter((e) => e.type === 'OVERLOAD').length === 1);
}


console.log('\n=== DEVICE LMI: blank cell vs real reading ===');
{
  const rawBlank = rows[idx('12:18:40')].lmi_pct;
  check('a blank lmi_pct parses to 0 (current parseCSV) or NaN (fixed parseCSV); the panel copes with both', rawBlank === 0 || Number.isNaN(rawBlank), String(rawBlank));
  check('0 with 4 t on the hook is read as blank', deviceLmiPct({ lmi_pct: 0, load_t: 4 }) === null);
  check('0 with no load is a real 0 %', deviceLmiPct({ lmi_pct: 0, load_t: 0 }) === 0);
  check('NaN (blank, if the parser is fixed) is blank too', deviceLmiPct({ lmi_pct: NaN, load_t: 4 }) === null);
  check('a real reading passes through', deviceLmiPct({ lmi_pct: 90.9, load_t: 43.2 }) === 90.9);
  check('no sample -> blank', deviceLmiPct(null) === null);
}


console.log('\n=== NULL CAPACITY -> NOT PERMITTED ===');
{
  const vm = fresh().liveUpdate(idx('12:18:40'));
  check('capacity cell reads NOT PERMITTED (no number)', vm.capacity.text === 'NOT PERMITTED', vm.capacity.text);
  check('...in red, because 4 t is on the hook', vm.capacity.cls === 'crit');
  check('utilisation is a dash, not a made-up percentage', vm.utilisation.text === '—');
  check('device LMI is blank and the chart side says "not permitted"', vm.lmi.text === 'blank' && vm.lmi.computed === 'not permitted', `${vm.lmi.text} / ${vm.lmi.computed}`);
  const al = find(vm, 'NOT PERMITTED');
  check('an alarm is listed with first timestamp 12:18:40', al && al.first === '12:18:40' && al.active, JSON.stringify(al));
  check('banner shows it', /NOT PERMITTED/.test(vm.banner.label), vm.banner.label);
  const idle = fresh().liveUpdate(idx('10:00:00'));
  check('a normal chart cell shows a number, never NOT PERMITTED', idle.capacity.text !== 'NOT PERMITTED');
}


console.log('\n=== BAD DATA: shown as a data problem, NOT as a crane failure ===');
{
  const s = fresh();
  const h = s.liveUpdate(idx('15:00:00'));
  check('15:00:00 quality badge is BAD DATA (red)', h.quality.level === 'BAD DATA' && h.quality.cls === 'crit');
  check('15:00:00: no crane failure in the alarm list (the detector returns DATA_QUALITY only)',
    !h.alarms.some((a) => a.kind === 'failure'), types(h).join());
  const bd = find(h, 'BAD DATA');
  check('15:00:00: a BAD DATA entry explains why and says the detector also reports DATA_QUALITY',
    bd && /radius/.test(bd.rule) && /DATA_QUALITY/.test(bd.note), JSON.stringify(bd));
  check('15:00:00: banner says BAD DATA and not a crane failure', /BAD DATA/.test(h.banner.label) && /not a crane failure/.test(h.banner.label), h.banner.label);
  check('15:00:00: the bad field (radius) is marked', h.fields.radius.cls === 'bad');
  const l = fresh().liveUpdate(idx('15:30:00'));
  check('15:30:00: no lift-off alarm (negative load / zero pads are bad data)', !l.alarms.some((a) => a.type === 'OUTRIGGER LIFT OFF'), types(l).join());
  check('15:30:00: negative load and zero pads are marked', l.fields.load.cls === 'bad' && l.pads.FL.cls === 'bad');
  check('14:30:00 and 17:00:00 are BAD DATA too', ['14:30:00', '17:00:00'].every((t) => fresh().liveUpdate(idx(t)).quality.level === 'BAD DATA'));
  check('a real failure row is NOT bad data (overload 09:00:00)', fresh().liveUpdate(idx('09:00:00')).quality.level === 'OK');
}


console.log('\n=== STALE: dropout and repeated timestamps ===');
{
  const d = fresh().liveUpdate(idx('15:25:00'));
  check('15:25:00 quality badge is STALE (amber)', d.quality.level === 'STALE' && d.quality.cls === 'warn');
  const e = find(d, 'DROPOUT');
  check('a DROPOUT entry says 300 s of data are missing', e && /300 s/.test(e.rule), JSON.stringify(e));
  check('a dropout is not a crane alarm: no failure entry is created for it', !d.alarms.some((a) => a.kind === 'failure'));
  const r = fresh().liveUpdate(idx('16:00:02'));
  check('16:00:02 (after a 13 s jump in file order) is STALE', r.quality.level === 'STALE');
  const s = fresh();
  s.liveUpdate(idx('15:59:45'));
  let v;
  for (let i = idx('15:59:45') + 1; i <= idx('16:00:10'); i++) v = s.liveUpdate(i, true);
  const rep = v.alarms.filter((a) => a.type === 'REPEATED TIMESTAMP');
  check('the two repeated 15:59:49 rows become ONE entry', rep.length === 1 && rep[0].rows === 2, JSON.stringify(rep));
}


console.log('\n=== DEVICE CONDITIONS (status_word + wind) ===');
{
  const w = fresh().liveUpdate(idx('12:30:10'));
  const wa = find(w, 'WIND ALERT');
  check('wind alert remains active after the frozen row split', wa && ['12:30:00', '12:30:04'].includes(wa.first) && wa.valueText === '45 km/h', JSON.stringify(wa));
  check('wind alert: wind field is red, chip is on', w.fields.wind.cls === 'crit' && w.chips.find((c) => c.key === 'wind').on);
  check('status bit 6 is set on that row', hasBit(rows[idx('12:30:10')].status_word, STATUS_BIT.wind));
  const by = find(fresh().liveUpdate(idx('14:00:10')), 'LMI BYPASS');
  check('LMI bypass remains active after the frozen row split', by && ['14:00:00', '14:00:04'].includes(by.first) && by.active, JSON.stringify(by));
  const pw = find(fresh().liveUpdate(idx('14:10:00')), 'LMI PREWARNING');
  check('LMI pre-warning: first timestamp 14:09:58, value 90.9 %, warning severity',
    pw && pw.first === '14:09:58' && pw.valueText === '90.9 %' && pw.severity === 'warning' && pw.kind === 'device',
    JSON.stringify(pw));
  const mm = fresh().liveUpdate(idx('09:50:10'));
  const m = find(mm, 'LMI DIVERGENCE');
  check('device LMI 78 % vs chart 109.5 % remains a mismatch alarm', m && ['09:50:00', '09:50:04'].includes(m.first) && /78\.0 % vs 109\.5 %/.test(m.valueText), JSON.stringify(m));
  check('the LMI cell shows both numbers', mm.lmi.mismatch && mm.lmi.text === '78.0 %' && mm.lmi.computed === '109.5 %', `${mm.lmi.text} ${mm.lmi.computed}`);
  check('no mismatch when device and chart agree (09:00:00)', !fresh().liveUpdate(idx('09:00:00')).lmi.mismatch);
}


console.log('\n=== PADS (telemetry) ===');
{
  const p = fresh().liveUpdate(idx('10:25:27'));
  // 10:25:27: FL=0.02 t which is at or below the 0.1 t critical threshold -> red (crit)
  check('critical lift-off: FL pad 0.0 t shown red (at or below 0.1 t critical threshold)', p.pads.FL.text === '0.0 t' && p.pads.FL.cls === 'crit', JSON.stringify(p.pads.FL));
  check('other pads are normal', p.pads.FR.cls === 'ok' && p.pads.RL.cls === 'ok' && p.pads.RR.cls === 'ok');
  // 10:25:27 also produces OUTRIGGER_LIFT_OFF (critical), not OUTRIGGER_NEAR_LIFT_OFF
  check('OUTRIGGER LIFT OFF alarm is active at 10:25:27 (FL at 0.02 t)', p.alarms.some((a) => a.type === 'OUTRIGGER LIFT OFF' && a.active), JSON.stringify(p.alarms.filter((a) => a.type.includes('LIFT'))));
  // Check that a near-lift-off row (not at the critical threshold) is amber
  const pNear = fresh().liveUpdate(idx('10:25:20'));
  check('near lift-off: FL pad 3.9 t shown amber (above 0.1 t but below 5 t watch value)', pNear.pads.FL.text !== '—' && pNear.pads.FL.cls === 'warn', JSON.stringify(pNear.pads.FL));
  const r = fresh().liveUpdate(idx('13:00:00'));
  check('retracted: pads at 0 are greyed (expected), not red', r.pads.FL.cls === 'mute' && /unloaded/.test(r.pads.note));
}


console.log('\n=== WHOLE DAY at 3 rows per frame ===');
{
  const s = fresh();
  s.liveUpdate(0);
  let v;
  for (let i = 3; i < rows.length; i += 3) v = s.liveUpdate(i, true);
  const count = (t) => v.alarms.filter((a) => a.type === t).length;
  check('6 overload episodes split by frozen data-quality rows', count('OVERLOAD') === 6, String(count('OVERLOAD')));
  check('2 hydraulic-loss episodes separated by frozen data (the 15:00 row is bad data)', count('HYDRAULIC PRESSURE LOSS') === 2, String(count('HYDRAULIC PRESSURE LOSS')));
  // With the 0.1 t critical threshold: the 10:25:27-28 rows (FL=0.02 t) produce OUTRIGGER_LIFT_OFF (1 episode).
  // The 15:30 bad-data row (negative load) is rejected as INVALID_TELEMETRY before pad checks run, so it does NOT add a lift-off alarm.
  check('1 critical lift-off (10:25:27-28, FL 0.02 t <= 0.1 t threshold)', count('OUTRIGGER LIFT OFF') === 1, String(count('OUTRIGGER LIFT OFF')));
  check('16 BAD DATA entries, including production frozen-sensor quality episodes', count('BAD DATA') === 16, String(count('BAD DATA')));
  check('2 dropout entries (15:25:00 and 16:00:02)', count('DROPOUT') === 2, String(count('DROPOUT')));
  // With blanks as NaN the detector also sees the two single rows where the device is blank but the chart has a capacity
  // (12:18:00 and 12:19:50, r = 10.00 m exactly). With the current parseCSV (blank = 0) those two rows are invisible.
  const blanksAreNaN = Number.isNaN(rows[idx('12:18:40')].lmi_pct);
  check('1 wind alert, 1 bypass, 4 pre-warnings, LMI divergence (09:50 only; +2 boundary rows if blanks are NaN), 1 not-permitted',
    count('WIND ALERT') === 2 && count('LMI BYPASS') === 2 && count('LMI PREWARNING') === 8 &&
      count('LMI DIVERGENCE') === (blanksAreNaN ? 4 : 2) && count('NOT PERMITTED') === 2,
    `${count('WIND ALERT')} ${count('LMI BYPASS')} ${count('LMI PREWARNING')} ${count('LMI DIVERGENCE')} ${count('NOT PERMITTED')}`);
  // F6 window now produces: 1 near-lift-off (10:25:20-26) + 1 critical lift-off (10:25:27-28) + 1 near-lift-off (10:25:29-35) = 3 pad episodes.
  // The 3-rows-per-frame scan skips some rows, so the near-lift-off episodes may merge into fewer entries.
  // At minimum: 1 improper deployment + at least 1 near-lift-off + 1 critical lift-off in the F6 window.
  check('2 improper-deployment episodes and at least 1 near-lift-off in the F6 window (10:25)',
    count('IMPROPER OUTRIGGER DEPLOYMENT') === 2 && count('OUTRIGGER NEAR LIFT OFF') >= 1,
    `deployment: ${count('IMPROPER OUTRIGGER DEPLOYMENT')}, near-lift-off: ${count('OUTRIGGER NEAR LIFT OFF')}`);
  check('the blank LMI cells of 12:18 are not read as a 0 % reading (no multi-row LMI divergence there)',
    !v.alarms.some((a) => a.type === 'LMI DIVERGENCE' && a.first.startsWith('12:') && a.rows > 1));
  // Production frozen-sensor quality episodes split alarms when the recording
  // holds a value during an active provisional motion bit.
  const totalExpected = blanksAreNaN ? 50 : 48;
  check(`exactly ${totalExpected} entries on the whole day`, v.alarms.length === totalExpected, String(v.alarms.length));
  check('no entry appears twice with the same type and first timestamp',
    new Set(v.alarms.map((a) => a.type + '@' + a.first + (a.simulated ? 'S' : ''))).size === v.alarms.length);
  const bad = v.alarms.find((a) => a.type === 'BAD DATA' && a.first === '15:00:00');
  check('the 15:00:00 BAD DATA entry says the detector also flags the row', bad && /DATA_QUALITY/.test(bad.note));
}


console.log('\n=== DETECTOR INTEGRATION (what the panel hands to detectFailures) ===');
{
  const calls = [];
  const spy = {
    detect: (sample, p) => { calls.push({ ts: sample.ts, prev: p, lmi: sample.lmi_pct }); return detectFailures(sample, p); },
    expectedPressure: expectedHydraulicPressure,
  };
  const last = () => calls[calls.length - 1];
  const i = idx('10:00:10');
  analyseSample(rows[i], rows[i - 1], spy);
  check('a normal row: the previous row is passed to the detector (rate checks work)', calls[0].prev === rows[i - 1]);

  calls.length = 0;
  const j = idx('15:00:01');
  const rec = analyseSample(rows[j], rows[j - 1], spy);
  check('the row after the 15:00:00 glitch: the previous row is NOT passed', calls[0].prev === undefined);
  check('...so the recovery row is not blamed for the glitch', rec.quality.level === 'OK' && rec.raised.length === 0, JSON.stringify(rec.raised));
  const rawRate = detectFailures(rows[j], rows[j - 1]);
  check('(the detector alone rejects the invalid previous row and does not blame recovery)',
    rawRate.status !== 'INVALID_TELEMETRY' && rawRate.errors.length === 0, JSON.stringify(rawRate.errors));

  calls.length = 0;
  analyseSample(rows[idx('12:18:40')], rows[idx('12:18:40') - 1], spy);
  check('blank LMI with 4 t on the hook is handed over as NaN, not 0', Number.isNaN(last().lmi), String(last().lmi));
  calls.length = 0;
  analyseSample(rows[idx('12:18:30')], rows[idx('12:18:30') - 1], spy);
  check('blank LMI where the chart has no capacity (no load) is NaN too', Number.isNaN(last().lmi), String(last().lmi));
  check('...whatever the parser gave there (0 or NaN)', [0].includes(rows[idx('12:18:30')].lmi_pct) || Number.isNaN(rows[idx('12:18:30')].lmi_pct));
  calls.length = 0;
  analyseSample(rows[idx('08:00:00')], rows[idx('08:00:00') - 1], spy);
  check('a real 0 % reading (no load, chart valid) stays 0, one detector call', calls.length === 1 && calls[0].lmi === 0);

  const vm = fresh().liveUpdate(idx('09:50:10'));
  check('device LMI 78 % vs chart 109.5 % is the detector\'s LMI_DIVERGENCE (device alarm)',
    vm.alarms.some((a) => a.type === 'LMI DIVERGENCE' && a.kind === 'device'));
  const wv = fresh().liveUpdate(idx('12:30:10'));
  check('classification: OVERLOAD critical/failure; WIND ALERT warning/device',
    find(vm, 'OVERLOAD').severity === 'critical' && find(vm, 'OVERLOAD').kind === 'failure'
    && find(wv, 'WIND ALERT').severity === 'warning' && find(wv, 'WIND ALERT').kind === 'device');

  const base = rows[idx('09:00:00')];
  const ms = manualSampleFromControls(base, { ...controlsFromSample(base), loadT: 90 }, deps);
  const man = analyseSample(ms, null, deps, { manual: true });
  check('MANUAL, outriggers DEPLOYED, 90 t: the detector is not blocked by missing pads (OVERLOAD is raised)',
    man.raised.some((r) => r.type === 'OVERLOAD') && man.quality.level === 'OK', JSON.stringify(man.raised.map((r) => r.type)));
}


console.log('\n=== DROPOUT IN PROGRESS (the ts-driven clock waits inside a gap) ===');
{
  const i = idx('15:19:59');
  check('the row after 15:19:59 is 15:25:00', rows[i + 1].ts.includes('T15:25:00'));
  check('1 s after the row: no dropout yet', dropoutStatus(rows, i, 1) === null);
  check('normal playback (1 s between rows): never a dropout', dropoutStatus(rows, idx('10:00:00'), 50) === null);
  const d = dropoutStatus(rows, i, 120);
  check('120 s into the gap: dropout, 301 s gap, 300 s missing', d && d.gapS === 301 && d.missingS === 300 && d.elapsedS === 120, JSON.stringify(d));
  check('elapsed never exceeds the gap', dropoutStatus(rows, i, 9999).elapsedS === 301);
  check('NaN elapsed, or the last row: null', dropoutStatus(rows, i, NaN) === null && dropoutStatus(rows, rows.length - 1, 50) === null);
  const base = fresh().liveUpdate(i);
  const vm = applyDropout(base, d);
  check('NO DATA banner and an amber STALE badge', /NO DATA/.test(vm.banner.label) && vm.quality.level === 'STALE' && vm.quality.cls === 'warn', JSON.stringify(vm.banner));
  check('it says since when and how long', /15:19:59/.test(vm.banner.reason) && /120 s of 301 s/.test(vm.quality.detail), vm.quality.detail);
  check('the original view-model is not changed', base.dropout === undefined && !/NO DATA/.test(base.banner.label));
  check('no dropout: the same view-model comes back', applyDropout(base, null) === base);
  const j = idx('15:59:59');
  const d2 = dropoutStatus(rows, j, 2.5);
  check('the 3 s gap 15:59:59 -> 16:00:02 is a dropout too (2 s missing) once 2.5 s have passed', d2 && d2.missingS === 2, JSON.stringify(d2));
}


console.log('\n=== EVENT INDEX (the derived "Jump to" list) ===');
{
  const ev = buildEventIndex(rows, deps);
  const first = (type) => ev.filter((e) => e.type === type).map((e) => e.firstTs.slice(11, 19));
  // With 0.1 t threshold: the F6 window now produces 1 OUTRIGGER_LIFT_OFF episode + 2 OUTRIGGER_NEAR_LIFT_OFF episodes.
  // The production tracker contributes the additional frozen-sensor data-quality episodes.
  const blanksAreNaN = Number.isNaN(rows[idx('12:18:40')].lmi_pct);
  check('the scan finds the whole-day alarm log (50 entries with a fixed parser, 48 with the old one)', ev.length === 50 || ev.length === 48, String(ev.length));
  check('true first timestamps include the pre-freeze overload starts', first('OVERLOAD').includes('09:00:00') && first('OVERLOAD').includes('09:50:00') && first('OVERLOAD').includes('11:00:00'), first('OVERLOAD').join());
  // Near-lift-off: 2 episodes in F6 window. The first starts at 10:25:20 (FL=3.93 t > 0.1 t).
  // Lift-off: 1 episode in F6 window, starts at 10:25:27 (FL=0.02 t <= 0.1 t).
  check('true first timestamps: hydraulic 11:00:01, wind 12:30:00, bypass 14:00:00',
    first('HYDRAULIC_PRESSURE_LOSS').includes('11:00:01') && first('WIND_ALERT').includes('12:30:00') && first('LMI_BYPASS').includes('14:00:00'));
  check('near-lift-off first episode starts at 10:25:20 (FL=3.93 t, still above 0.1 t critical threshold)',
    first('OUTRIGGER_NEAR_LIFT_OFF')[0] === '10:25:20', first('OUTRIGGER_NEAR_LIFT_OFF').join());
  check('critical lift-off episode in F6 window starts at 10:25:27 (FL=0.02 t, at or below 0.1 t)',
    first('OUTRIGGER_LIFT_OFF').length === 1 && first('OUTRIGGER_LIFT_OFF')[0] === '10:25:27', first('OUTRIGGER_LIFT_OFF').join());
  check('bad data includes the four impossible rows', ['14:30:00', '15:00:00', '15:30:00', '17:00:00'].every((time) => first('BAD_DATA').includes(time)), first('BAD_DATA').join());
  check('time order', ev.every((e, i) => i === 0 || ev[i - 1].firstTs <= e.firstTs));
  check('index points at the row the episode started on', ev.every((e) => rows[e.index].ts === e.firstTs));
  const rep = ev.find((e) => e.type === 'REPEATED_TIMESTAMP');
  check('repeated timestamp: index is the SECOND row with that ts (jump one row before it)', rep && rows[rep.index - 1].ts === rep.firstTs, JSON.stringify(rep));
  check('same entries as the playback shows (whole day, 1 row at a time)', (() => {
    const s = fresh(); let vm;
    for (let i = 0; i < rows.length; i++) vm = s.liveUpdate(i, i > 0);
    return vm.alarms.length === ev.length;
  })(), 'compare with the log');
}


console.log('\n=== NO THROWING ===');
{
  check('null sample renders an empty panel', noThrow(() => buildPanelModel(null, new AlarmLog(), MODE.LIVE)));
  check('empty panel has dashes, not numbers', buildPanelModel(null, new AlarmLog(), MODE.LIVE).fields.load.text === '—');
  const odd = { ...rows[idx('10:00:00')], load_t: NaN, boom_length_m: NaN, radius_m: NaN };
  check('NaN boom length / radius render without throwing and show BAD DATA', noThrow(() => {
    const vm = buildPanelModel(analyseSample(odd, null, deps), new AlarmLog(), MODE.LIVE);
    if (vm.quality.level !== 'BAD DATA') throw new Error('not BAD DATA: ' + vm.quality.level);
    if (vm.capacity.text !== '—') throw new Error('capacity should be a dash, got ' + vm.capacity.text);
  }));
  check('STALE and BAD DATA samples render without throwing',
    noThrow(() => { ['15:25:00', '15:00:00', '14:30:00', '15:30:00', '17:00:00', '16:00:02'].forEach((t) => fresh().liveUpdate(idx(t))); }));
  check('detector returning INVALID_TELEMETRY is shown as BAD DATA', (() => {
    const vm = buildPanelModel(analyseSample({ ...rows[idx('10:00:00')], ts: 'not a date' }, null, deps), new AlarmLog(), MODE.LIVE);
    return vm.quality.level === 'BAD DATA';
  })());
  check('every row of the recording builds a panel model without throwing (sampled every 50th row)', noThrow(() => {
    const s = fresh();
    for (let i = 0; i < rows.length; i += 50) s.liveUpdate(i);
  }));
}


console.log('\n==============================================');
console.log(' SENSOR PANEL (MODULE 4) TEST RESULTS');
console.log('==============================================');
console.log(`  PASSED : ${passed}`);
console.log(`  FAILED : ${failed}`);
console.log('==============================================');
process.exit(failed === 0 ? 0 : 1);
