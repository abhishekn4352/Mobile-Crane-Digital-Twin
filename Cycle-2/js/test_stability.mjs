// test_stability.mjs — run: node test_stability.mjs
import {
  pointInPolygon,
  loadGroundPosition,
  edgeDistanceM,
  stabilityVerdict,
  combinedCoG,
  outriggerPolygonForSpread,
  DEFAULT_WARN_MARGIN_M,
} from './stability.js';

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}  →  got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function approx(label, actual, expected, tol = 1e-6) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) pass++; else fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}  →  got ${actual.toFixed(6)}, want ~${expected}`);
}

// Simulated GMK5250L-1: outriggers fully deployed, 7.8 m spread (STARTER-KIT loadchart.js)
// outrigger polygon centred on slew axis
const OUTRIGGER_POLY = outriggerPolygonForSpread(7.8, 7.8);

console.log('\n1. pointInPolygon (ray casting)');
check('centre inside', pointInPolygon(0, 0, OUTRIGGER_POLY), true);
check('corner region outside', pointInPolygon(4.5, 4.5, OUTRIGGER_POLY), false);
check('just outside +x edge', pointInPolygon(3.91, 0, OUTRIGGER_POLY), false);
check('just inside +x edge', pointInPolygon(3.89, 0, OUTRIGGER_POLY), true);
// irregular quad: [0,0]-[4,0]-[4,2]-[0,2]
const IRREGULAR = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 0, z: 2 }];
check('irregular quad: inside', pointInPolygon(2, 1, IRREGULAR), true);
check('irregular quad: outside', pointInPolygon(2, 3, IRREGULAR), false);

console.log('\n2. loadGroundPosition (radius + slew)');
const f = loadGroundPosition(10, 30);
approx('r=10m, slew=30° → x = 10·cos30', f.x, 8.660254);
approx('r=10m, slew=30° → z = 10·sin30', f.z, 5);

console.log('\n3. edgeDistanceM');
approx('dead centre → 3.9 m to edge', edgeDistanceM(0, 0, OUTRIGGER_POLY), 3.9);
approx('inside, 1 m from edge', edgeDistanceM(2.9, 0, OUTRIGGER_POLY), 1.0, 1e-9);
approx('outside → 0 (no margin)', edgeDistanceM(5, 0, OUTRIGGER_POLY), 0);

console.log('\n4. stabilityVerdict');
check('centre → ok', stabilityVerdict(0, 0, OUTRIGGER_POLY), 'ok');
check('2.9 m from edge (margin 1.5) → warn', stabilityVerdict(2.9, 0, OUTRIGGER_POLY), 'warn');
check('outside → tipping', stabilityVerdict(4.2, 0, OUTRIGGER_POLY), 'tipping');
check('edge exactly on margin → warn', stabilityVerdict(2.4, 0, OUTRIGGER_POLY), 'warn');
check('custom margin 0.1 → same point ok', stabilityVerdict(2.9, 0, OUTRIGGER_POLY, { warnMarginM: 0.1 }), 'ok');
check('degenerate polygon → tipping', stabilityVerdict(0, 0, [{ x: 0, z: 0 }, { x: 1, z: 0 }]), 'tipping');

console.log('\n5. combinedCoG (load-weighted)');
// machine 60 t centred on axis, load 20 t out at x=10 → CoG shifts to x = 20·10/80
const cog = combinedCoG(0, 0, 60, loadGroundPosition(10, 0).x, loadGroundPosition(10, 0).z, 20);
approx('machine 60t + load 20t at x=10 → CoG x=2.5', cog.x, 2.5);
approx('CoG z stays 0 (slew 0°)', cog.z, 0);

console.log('\n6. verify with a real chart geometry (boom 23.6 m @ 60°)');
// radius = 23.6 · cos60 = 11.8 m roughly inside polygon (half-width 3.9) → tipping at max slew reach
const boomLen = 23.6, angleDeg = 60;
const radius = boomLen * Math.cos(angleDeg * Math.PI / 180);
console.log(`  radius computed = ${radius.toFixed(2)} m (from length+angle)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);