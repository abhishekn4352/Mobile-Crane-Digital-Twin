// stability.js — outrigger support-polygon stability. See STARTER-KIT.md §4.
// pointInPolygon + loadGroundPosition are GIVEN. stabilityVerdict implemented here.
//
// Frame convention: ground plane, x = r·cos(slew), z = r·sin(slew), slew=0° → +x.
// MATCH THIS against your Three.js scene before wiring (see STARTER-KIT §4 note).

// Default edge margin (metres) below which an in-polygon load is flagged 'warn'.
// Distance is from the load's ground position to the nearest polygon edge.
export const DEFAULT_WARN_MARGIN_M = 1.5;

// ── Exact point-in-polygon (ray casting). poly = [{x, z}, ...] outrigger contact points.
export function pointInPolygon(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
    const hit = (zi > pz) !== (zj > pz)
      && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// ── Load's ground position from working radius + slew angle (GIVEN).
export function loadGroundPosition(radiusM, slewDeg) {
  const a = slewDeg * Math.PI / 180;
  return { x: radiusM * Math.cos(a), z: radiusM * Math.sin(a) };
}

// ── Distance from point (px, pz) to segment (ax,az)-(bx,bz).
function pointSegmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

// ── Distance from point to the nearest edge of a polygon (0 if outside/on edge).
export function edgeDistanceM(px, pz, poly) {
  if (!poly || poly.length < 3) return 0; // degenerate polygon = no support
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = pointSegmentDistance(px, pz, poly[i].x, poly[i].z, poly[j].x, poly[j].z);
    if (d < min) min = d;
  }
  if (!pointInPolygon(px, pz, poly)) return 0; // outside the support → no margin
  return min;
}

// ── Stability verdict (STARTER-KIT §4).
//   'ok'      → inside polygon, ≥ warnMargin from every edge
//   'warn'    → inside polygon but within warnMargin of an edge (approaching tipping)
//   'tipping' → outside the support polygon (physical tipping point)
// options.warnMarginM overrides the default margin.
//
// REMEMBER: inside the polygon is NECESSARY but NOT SUFFICIENT for a safe lift.
// The load-chart (ratedCapacity) is the operational limit; this is the physical tippoint.
export function stabilityVerdict(loadX, loadZ, outriggerPolygon, options = {}) {
  if (!outriggerPolygon || outriggerPolygon.length < 3) return 'tipping';
  const margin = options.warnMarginM ?? DEFAULT_WARN_MARGIN_M;
  if (!pointInPolygon(loadX, loadZ, outriggerPolygon)) return 'tipping';
  const d = edgeDistanceM(loadX, loadZ, outriggerPolygon);
  return d <= margin ? 'warn' : 'ok';
}

// ── Load-weighted combined CoG (stretch per STARTER-KIT §4 step 3).
// Machine (mass Mm, CoG at {x,z}) + hook load (mass Ml, at {x,z}).
// Projected combined CoG — pass THIS into stabilityVerdict for a truer tipping check.
export function combinedCoG(machineX, machineZ, machineT, loadX, loadZ, loadT) {
  const total = machineT + loadT;
  return {
    x: (machineT * machineX + loadT * loadX) / total,
    z: (machineT * machineZ + loadT * loadZ) / total,
  };
}

// ── Convenience: rectangular outrigger polygon from the spread.
// spreadX = total width across the machine, spreadZ = total depth along the boom axis
// (as seen on the ground, centred on the slew axis). Returns [{x,z}] in loop order.
export function outriggerPolygonForSpread(spreadXM, spreadZM) {
  const hx = spreadXM / 2, hz = spreadZM / 2;
  return [
    { x: -hx, z: -hz },
    { x:  hx, z: -hz },
    { x:  hx, z:  hz },
    { x: -hx, z:  hz },
  ];
}