// Collision and ray queries against the height grid. A cell is solid from the ground up to its height,
// so walls, crates, steps and platforms are all one rule. Nothing here allocates.

import { CELL, GRAVITY, BODY } from './config.js';

const OUT = 99; // outside the grid counts as a very tall wall

export function heightAt(map, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= map.cols || cz >= map.rows) return OUT;
  return map.h[cz * map.cols + cx];
}

// Highest cell top under a circle of radius r that the feet at y may stand on.
export function groundUnder(map, x, z, r, y) {
  let g = 0;
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    const h = heightAt(map, cx, cz);
    if (h <= y + BODY.step && h > g) g = h;
  }
  return g;
}

function blockedAt(map, x, z, r, y) {
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    if (heightAt(map, cx, cz) > y + BODY.step) return true;
  }
  return false;
}

// Moves a body (feet position `p`, velocity `v`) one step, sliding along walls axis by axis and
// stepping up ledges below BODY.step. Returns true when standing on ground afterwards.
export function moveBody(map, p, v, dt, r, wasGrounded) {
  const nx = p.x + v.x * dt;
  if (!blockedAt(map, nx, p.z, r, p.y)) p.x = nx;
  else v.x = 0;
  const nz = p.z + v.z * dt;
  if (!blockedAt(map, p.x, nz, r, p.y)) p.z = nz;
  else v.z = 0;

  const ground = groundUnder(map, p.x, p.z, r, p.y);
  v.y -= GRAVITY * dt;
  p.y += v.y * dt;
  if (p.y <= ground) {
    p.y = ground;
    v.y = 0;
    return true;
  }
  // Walking off a small ledge: stick to the ground instead of hopping.
  if (wasGrounded && v.y <= 0 && p.y - ground < 0.3) {
    p.y = ground;
    v.y = 0;
    return true;
  }
  return false;
}

// 3D DDA through the grid. Writes the hit into `hit` and returns its distance, or Infinity.
export function raycast(map, ox, oy, oz, dx, dy, dz, maxT, hit) {
  let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const adx = Math.abs(dx), adz = Math.abs(dz);
  const tDeltaX = adx > 1e-9 ? CELL / adx : Infinity;
  const tDeltaZ = adz > 1e-9 ? CELL / adz : Infinity;
  let tMaxX = adx > 1e-9 ? (dx > 0 ? (cx + 1) * CELL - ox : ox - cx * CELL) / adx : Infinity;
  let tMaxZ = adz > 1e-9 ? (dz > 0 ? (cz + 1) * CELL - oz : oz - cz * CELL) / adz : Infinity;
  const tFloor = dy < -1e-9 ? -oy / dy : Infinity;
  const limit = Math.min(maxT, tFloor);
  let t = 0, nx = 0, nz = 0;
  for (let guard = 0; guard < 256; guard++) {
    const tExit = Math.min(tMaxX, tMaxZ, limit);
    const h = heightAt(map, cx, cz);
    if (h > 0) {
      const yEnter = oy + dy * t;
      if (yEnter <= h) return setHit(hit, t, ox, oy, oz, dx, dy, dz, nx, 0, nz, h);
      const yExit = oy + dy * tExit;
      if (yExit <= h) return setHit(hit, (h - oy) / dy, ox, oy, oz, dx, dy, dz, 0, 1, 0, h);
    }
    if (tExit >= limit) break;
    if (tMaxX < tMaxZ) {
      cx += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; nz = 0;
    } else {
      cz += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; nz = -stepZ;
    }
  }
  if (tFloor <= maxT) return setHit(hit, tFloor, ox, oy, oz, dx, dy, dz, 0, 1, 0, 0);
  hit.t = Infinity;
  return Infinity;
}

function setHit(hit, t, ox, oy, oz, dx, dy, dz, nx, ny, nz, h) {
  hit.t = t;
  hit.x = ox + dx * t; hit.y = oy + dy * t; hit.z = oz + dz * t;
  hit.nx = nx; hit.ny = ny; hit.nz = nz;
  hit.h = h;
  return t;
}

export function makeHit() {
  return { t: Infinity, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, h: 0 };
}

const losHit = makeHit();

// True when nothing in the grid stands between the two points.
export function clearLine(map, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return true;
  return raycast(map, ax, ay, az, dx / d, dy / d, dz / d, d, losHit) >= d - 0.05;
}

// Does the segment a->b pass through any live smoke cloud?
export function smokeBlocks(smokes, ax, ay, az, bx, by, bz) {
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i];
    if (!s.active || s.density < 0.45) continue;
    const r = s.radius * s.density;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    let u = ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / (len2 || 1);
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = ax + dx * u - s.x, py = ay + dy * u - s.y, pz = az + dz * u - s.z;
    if (px * px + py * py * 2 + pz * pz < r * r) return true;
  }
  return false;
}

// Ray against an axis-aligned box; returns entry distance or Infinity.
export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    const lo = a === 0 ? minX : a === 1 ? minY : minZ;
    const hi = a === 0 ? maxX : a === 1 ? maxY : maxZ;
    const oa = a === 0 ? ox : a === 1 ? oy : oz;
    const da = a === 0 ? dx : a === 1 ? dy : dz;
    if (Math.abs(da) < 1e-9) {
      if (oa < lo || oa > hi) return Infinity;
    } else {
      let ta = (lo - oa) / da, tb = (hi - oa) / da;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(r * r - d2);
}
