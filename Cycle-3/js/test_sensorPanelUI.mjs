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
import * as detector from './failureDetector.js';
import { KIT } from './craneModel.js';
import { detectFailures, expectedHydraulicPressure } from './failureDetector.js';
import {
  MODE, AlarmLog, PanelSession, analyseSample, buildPanelModel,
  manualSampleFromControls, controlsFromSample, hasBit, STATUS_BIT, deviceLmiPct, dropoutStatus, applyDropout, buildEventIndex,
} from './panelModel.js';
import { createProductionFrozenSensorTracker } from './dataQuality.js';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; console.log(`  [FAIL] ${name} ${detail}`); }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rows = parseCSV(fs.readFileSync(join(__dirname, '../data/mobile-telemetry-2026-09-16.csv'), 'utf8'));
const deps = { detect: detectFailures, expectedPressure: expectedHydraulicPressure };
// Whole-day numbers: 21 core entries + 2 LMI BLANK (when the parser gives NaN for a blank cell)
// + 1 lift-off (pad 0.02 t <= 0.1 t) + 11 frozen-sensor windows (motion bit set, reading unchanged for KIT.FROZEN_SENSOR_DURATION_S).
const BLANKS_NAN = Number.isNaN(rows[rows.findIndex((r) => r.ts.includes('T12:18:40'))].lmi_pct);
const EXPECTED_ENTRIES = 21 + (BLANKS_NAN ? 2 : 0) + 1 + 11;
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
  check('overload: first timestamp is the true start 11:00:00 even after a jump to 11:02:00', ov && ov.first === '11:00:00', JSON.stringify(ov));
  check('overload shows the trigger value (30.0 t)', ov && ov.valueText === '30.0 t', ov && ov.valueText);
  check('overload shows the rule that fired', ov && /exceeds rated capacity/.test(ov.rule), ov && ov.rule);
  check('hydraulic loss: first timestamp 11:00:01, value in bar', hyd && hyd.first === '11:00:01' && /bar$/.test(hyd.valueText), JSON.stringify(hyd));
  check('both are active', ov.active && hyd.active);

  const s2 = fresh();
  s2.liveUpdate(idx('10:59:50'));
  let vm2;
  for (let i = idx('10:59:50') + 1; i <= idx('11:05:00'); i++) vm2 = s2.liveUpdate(i, true);   // 1 row at a time
  const ovs = vm2.alarms.filter((a) => a.type === 'OVERLOAD');
  check('played row by row for 5 minutes: ONE overload entry, not one per second', ovs.length === 1, String(ovs.length));
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
  check('first timestamp is 09:00:00 at 1, 7, 53 and 100 rows per frame', ['1', '7', '53', '100'].every((n) => firstAt(+n) === '09:00:00'),
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
  check('wind alert: first timestamp 12:30:00, value 45 km/h', wa && wa.first === '12:30:00' && wa.valueText === '45 km/h', JSON.stringify(wa));
  check('wind alert: wind field is red, chip is on', w.fields.wind.cls === 'crit' && w.chips.find((c) => c.key === 'wind').on);
  check('status bit 6 is set on that row', hasBit(rows[idx('12:30:10')].status_word, STATUS_BIT.wind));
  const by = find(fresh().liveUpdate(idx('14:00:10')), 'LMI BYPASS');
  check('LMI bypass: first timestamp 14:00:00', by && by.first === '14:00:00' && by.active, JSON.stringify(by));
  const pw = find(fresh().liveUpdate(idx('14:10:00')), 'LMI PREWARNING');
  check('LMI pre-warning: first timestamp 14:09:58, value 90.9 %', pw && pw.first === '14:09:58' && pw.valueText === '90.9 %', JSON.stringify(pw));
  const mm = fresh().liveUpdate(idx('09:50:10'));
  const m = find(mm, 'LMI DIVERGENCE');
  check('device LMI 78 % vs chart 109.5 % (09:50): mismatch alarm, first timestamp 09:50:00', m && m.first === '09:50:00' && /78\.0 % vs 109\.5 %/.test(m.valueText), JSON.stringify(m));
  check('the LMI cell shows both numbers', mm.lmi.mismatch && mm.lmi.text === '78.0 %' && mm.lmi.computed === '109.5 %', `${mm.lmi.text} ${mm.lmi.computed}`);
  check('no mismatch when device and chart agree (09:00:00)', !fresh().liveUpdate(idx('09:00:00')).lmi.mismatch);
}


console.log('\n=== PADS (telemetry) ===');
{
  const p = fresh().liveUpdate(idx('10:25:27'));
  // 10:25:27 is the lowest pad in the recording: 0.02 t. Amber (near lift-off) under the old "<= 0" rule, red under the 0.1 t rule.
  const liftLevel = KIT.PAD_LIFT_OFF_T ?? 0;
  check(`lowest pad of the day: FL 0.02 t shown ${0.02 <= liftLevel ? 'red (lift-off, <= ' + liftLevel + ' t)' : 'amber (near lift-off)'}, with its second decimal`,
    p.pads.FL.text === '0.02 t' && p.pads.FL.cls === (0.02 <= liftLevel ? 'crit' : 'warn'), JSON.stringify(p.pads.FL));
  const p2 = fresh().liveUpdate(idx('10:25:25'));
  check('FL 0.44 t (10:25:25) is amber: near lift-off, above the 0.1 t level', p2.pads.FL.cls === 'warn' && p2.pads.FL.text === '0.44 t', JSON.stringify(p2.pads.FL));
  check('other pads are normal', p.pads.FR.cls === 'ok' && p.pads.RL.cls === 'ok' && p.pads.RR.cls === 'ok');
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
  check('3 overloads (09:00, 09:50, 11:00)', count('OVERLOAD') === 3, String(count('OVERLOAD')));
  check('1 hydraulic loss (the 15:00 row is bad data, not a failure)', count('HYDRAULIC PRESSURE LOSS') === 1, String(count('HYDRAULIC PRESSURE LOSS')));
  check('1 lift-off alarm (10:25:27, pad 0.02 t); the 15:30 row stays bad data', count('OUTRIGGER LIFT OFF') === 1, String(count('OUTRIGGER LIFT OFF')));
  const lo = v.alarms.find((a) => a.type === 'OUTRIGGER LIFT OFF');
  check('...first timestamp 10:25:27, critical, trigger FL', lo && lo.first === '10:25:27' && lo.severity === 'critical' && /FL/.test(lo.valueText), JSON.stringify(lo && [lo.first, lo.severity, lo.valueText]));
  check('one near-lift-off entry runs through the lift-off (10:25:20), not two', count('OUTRIGGER NEAR LIFT OFF') === 1 && v.alarms.find((a) => a.type === 'OUTRIGGER NEAR LIFT OFF').first === '10:25:20');
  const fz = v.alarms.filter((a) => a.type === 'SENSOR FROZEN');
  check('11 frozen-sensor entries, none while parked or in a dropout, none at 07:03 (hoist only)',
    fz.length === 11 && fz.every((a) => !/^(07:0|12:4|15:2)/.test(a.first)), String(fz.length));
  const fzFirst = fz.map((a) => a.first).sort().join();
  check('frozen-sensor first timestamps = window start + KIT.FROZEN_SENSOR_DURATION_S (10 s)',
    KIT.FROZEN_SENSOR_DURATION_S === 10 && fzFirst === '09:00:10,09:50:10,10:25:10,11:00:10,12:18:50,12:30:10,14:00:10,14:10:10,14:20:10,14:40:10,14:50:10', fzFirst);
  check('a frozen sensor is a data problem (severity data), not a crane failure; the entry names the channels',
    fz.every((a) => a.severity === 'data' && a.kind === 'data' && /boom length/.test(a.valueText)));
  check('4 BAD DATA entries', count('BAD DATA') === 4, String(count('BAD DATA')));
  check('2 dropout entries (15:25:00 and 16:00:02)', count('DROPOUT') === 2, String(count('DROPOUT')));
  // With blanks as NaN the detector also sees the two single rows where the device is blank but the chart has a capacity
  // (12:18:00 and 12:19:50, r = 10.00 m exactly). With the current parseCSV (blank = 0) those two rows are invisible.
  const blanksAreNaN = BLANKS_NAN;
  check('1 wind alert, 1 bypass, 4 pre-warnings, 1 real LMI divergence (09:50), 1 not-permitted',
    count('WIND ALERT') === 1 && count('LMI BYPASS') === 1 && count('LMI PREWARNING') === 4 && count('LMI DIVERGENCE') === 1 && count('NOT PERMITTED') === 1,
    `${count('WIND ALERT')} ${count('LMI BYPASS')} ${count('LMI PREWARNING')} ${count('LMI DIVERGENCE')} ${count('NOT PERMITTED')}`);
  // review item: the two boundary rows (device LMI blank, chart gives 41.4 t) are a reporting gap, i.e. a data issue
  const blank = v.alarms.filter((a) => a.type === 'LMI BLANK');
  check(blanksAreNaN ? '2 LMI BLANK entries (12:18:00, 12:19:50): data issues, not LMI divergence failures' : '0 LMI BLANK entries (old parseCSV hides the blank cells)',
    blanksAreNaN ? blank.length === 2 && blank.map((a) => a.first).join() === '12:19:50,12:18:00' || blank.map((a) => a.first).sort().join() === '12:18:00,12:19:50' : blank.length === 0,
    blank.map((a) => a.first).join());
  check('...LMI BLANK is severity data and says what happened', blank.every((a) => a.severity === 'data' && a.kind === 'data' && /blank/.test(a.valueText) && /chart has a capacity of 41\.4 t/.test(a.rule)), JSON.stringify(blank.map((a) => a.rule)));
  check('pre-warnings are warnings (device), never critical', v.alarms.filter((a) => a.type === 'LMI PREWARNING').every((a) => a.severity === 'warning' && a.kind === 'device'));
  check('1 improper deployment (07:03:00) and 1 near-lift-off (10:25:20)', count('IMPROPER OUTRIGGER DEPLOYMENT') === 1 && count('OUTRIGGER NEAR LIFT OFF') === 1);
  check('the blank LMI cells of 12:18 are not read as a 0 % reading (no multi-row LMI divergence there)',
    !v.alarms.some((a) => a.type === 'LMI DIVERGENCE' && a.first.startsWith('12:') && a.rows > 1));
  check(`exactly ${EXPECTED_ENTRIES} entries on the whole day`, v.alarms.length === EXPECTED_ENTRIES, String(v.alarms.length));
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
  check(`the scan finds the whole-day alarm log (${EXPECTED_ENTRIES} entries with this parser and detector)`, ev.length === EXPECTED_ENTRIES, String(ev.length));
  check('true first timestamps: overload 09:00:00, 09:50:00, 11:00:00', first('OVERLOAD').join() === '09:00:00,09:50:00,11:00:00', first('OVERLOAD').join());
  check('true first timestamps: hydraulic 11:00:01, wind 12:30:00, bypass 14:00:00, near lift-off 10:25:20',
    first('HYDRAULIC_PRESSURE_LOSS').join() === '11:00:01' && first('WIND_ALERT').join() === '12:30:00' && first('LMI_BYPASS').join() === '14:00:00' && first('OUTRIGGER_NEAR_LIFT_OFF').join() === '10:25:20');
  check('bad data rows: 14:30:00, 15:00:00, 15:30:00, 17:00:00', first('BAD_DATA').join() === '14:30:00,15:00:00,15:30:00,17:00:00', first('BAD_DATA').join());
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


console.log('\n=== REVIEW FIXES: how the panel classifies the new / changed detector alarms (stub detector) ===');
{
  const sample = rows[idx('10:00:00')];
  const row = (extra) => ({ ...sample, ...extra });
  const stub = (failures) => ({ detect: () => ({ timestamp: sample.ts, status: 'FAILURE_DETECTED', errors: [], failures, telemetry: {}, derived: detectFailures(sample).derived }), expectedPressure: expectedHydraulicPressure });
  const f = (type, triggerValue, limit, rule) => ({ type, timestamp: sample.ts, triggerValue, limit, rule });

  // frozen sensor -> STALE badge + a data entry, not a crane failure, and the real alarm on the same row stays visible
  const w = idx('09:00:20');                         // inside the 09:00 window: overload AND frozen at the same time
  const tracker = createProductionFrozenSensorTracker();
  let fa = null;
  for (let k = idx('09:00:00'); k <= w; k++) fa = analyseSample(rows[k], rows[k - 1], deps, { frozenTracker: tracker });
  check('FROZEN: quality is STALE, not BAD DATA', fa.quality.level === 'STALE', fa.quality.level);
  check('FROZEN: the real OVERLOAD on the same row is still a crane failure', fa.failures.some((x) => x.type === 'OVERLOAD'), JSON.stringify(fa.failures.map((x) => x.type)));
  const fr = fa.raised.find((r) => r.type === 'SENSOR_FROZEN');
  check('FROZEN: ONE data entry for the three channels, with the 10 s limit', fa.raised.filter((r) => r.type === 'SENSOR_FROZEN').length === 1 && fr.kind === 'data' && fr.severity === 'data' && /boom length/.test(String(fr.value)) && /10 s/.test(fr.limit), JSON.stringify(fr));
  const fvm = buildPanelModel(fa, new AlarmLog(), MODE.LIVE);
  check('FROZEN: the badge reads STALE and the banner is not the BAD DATA banner', fvm.quality.text === 'STALE' && fvm.banner.text !== 'BAD DATA', JSON.stringify([fvm.quality.text, fvm.banner]));

  // lift-off is critical, and a lifted pad also keeps the near-lift-off episode open (no split into two entries)
  const la = analyseSample(sample, null, stub([f('OUTRIGGER_LIFT_OFF', 'FL', '> 0.1 t reaction on every deployed pad', 'recorded pad reaction is at or below 0.1 t on FL')]));
  check('LIFT_OFF: critical', la.raised.some((r) => r.type === 'OUTRIGGER_LIFT_OFF' && r.severity === 'critical'));
  check('LIFT_OFF: also keeps NEAR_LIFT_OFF raised (one near-lift-off episode, not two)', la.raised.some((r) => r.type === 'OUTRIGGER_NEAR_LIFT_OFF' && r.severity === 'warning'));
  const both = analyseSample(sample, null, stub([f('OUTRIGGER_LIFT_OFF', 'FL', 0.1, 'x'), f('OUTRIGGER_NEAR_LIFT_OFF', 'RL', 5, 'y')]));
  check('LIFT_OFF + NEAR from the detector: NEAR is not raised twice', both.raised.filter((r) => r.type === 'OUTRIGGER_NEAR_LIFT_OFF').length === 1);

  // blank device LMI -> data issue; a real divergence stays a device warning
  const ba = analyseSample(sample, null, stub([f('LMI_DIVERGENCE', null, 'both computed utilization and lmi_pct present', 'exactly one LMI input is missing')]));
  const bl = ba.raised.find((r) => r.type === 'LMI_BLANK');
  check('LMI blank vs chart: data issue (severity data)', bl && bl.kind === 'data' && bl.severity === 'data', JSON.stringify(bl));
  check('LMI blank vs chart: not a failure and no LMI mismatch flag', ba.failures.length === 0 && ba.lmi.mismatch === false && !ba.raised.some((r) => r.type === 'LMI_DIVERGENCE'));
  const da = analyseSample(sample, null, stub([f('LMI_DIVERGENCE', 78, 109.5, 'x')]));
  check('real LMI divergence (78 % vs 109.5 %): still a device warning with the mismatch flag', da.raised.some((r) => r.type === 'LMI_DIVERGENCE' && r.severity === 'warning' && r.kind === 'device') && da.lmi.mismatch === true);
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
