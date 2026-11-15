// Movement and collision. A soldier accelerates toward the wished velocity and brakes by friction,
// so stopping takes time unless you press against your motion (a counter-strafe); crouching and
// walking are slower and silent, running makes footsteps bots hear. Bodies collide with the map's
// height grid: a cell is solid from the ground up to its height, so walls, crates, steps and
// platforms are all one rule. Ray casts for bullets and lines of sight use the same grid.
// Nothing here allocates.

import { CELL } from './map-kilnworks.js';
import { emit, makeNoise } from './state.js';

export const BODY = { accel: 52, friction: 10, runSpeed: 5.5, crouchFactor: 0.36, walkFactor: 0.5, airAccel: 8, jumpSpeed: 6.7,
  radius: 0.34, height: 1.8, crouchHeight: 1.28, eye: 1.62, crouchEye: 1.14, headRadius: 0.19, step: 0.48 };
export const GRAVITY = 20;
const OUT = 99; // outside the grid counts as a very tall wall

export const lerp = (a, b, t) => a + (b - a) * t;
export const approach = (v, target, rate) => (v < target ? Math.min(target, v + rate) : Math.max(target, v - rate));
export const bodyHeight = (a) => lerp(BODY.height, BODY.crouchHeight, a.crouch);
export const eyeHeight = (a) => lerp(BODY.eye, BODY.crouchEye, a.crouch);

// Top speed right now: slower with a heavy gun, scoped, crouched or walking; rooted while planting,
// defusing or frozen in the buy phase.
export function speedLimit(state, a) {
  const w = a.current === 'primary' ? a.primary : a.current === 'secondary' ? a.secondary : null;
  let s = BODY.runSpeed * (w ? w.def.speed : 1);
  if (a.scoped) s *= 0.5;
  if (a.crouch > 0.5) s *= BODY.crouchFactor;
  else if (a.input.walk) s *= BODY.walkFactor;
  if (a.using > 0 || state.match.phase === 'freeze') s = 0;
  return s;
}

// One tick of a soldier's body, driven by its input record whether a player or a bot filled it.
export function stepActor(state, a, dt) {
  a.prev.x = a.pos.x; a.prev.y = a.pos.y; a.prev.z = a.pos.z;
  if (!a.alive) return;
  const inp = a.input;
  a.crouch = approach(a.crouch, inp.crouch ? 1 : 0, dt * 7);

  let wx = -Math.sin(a.yaw) * inp.fwd + Math.cos(a.yaw) * inp.side;
  let wz = -Math.cos(a.yaw) * inp.fwd - Math.sin(a.yaw) * inp.side;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-4) { wx /= wl; wz /= wl; }
  const limit = speedLimit(state, a);

  if (a.grounded) {
    if (wl > 1e-4 && limit > 0) {
      // Accelerate toward the wished velocity; pressing against your motion stops you fast (counter-strafe).
      const tx = wx * limit, tz = wz * limit;
      let dx = tx - a.vel.x, dz = tz - a.vel.z;
      const dl = Math.hypot(dx, dz), maxD = BODY.accel * dt;
      if (dl > maxD) { dx *= maxD / dl; dz *= maxD / dl; }
      a.vel.x += dx; a.vel.z += dz;
    } else {
      const k = Math.max(0, 1 - BODY.friction * dt);
      a.vel.x *= k; a.vel.z *= k;
      if (Math.hypot(a.vel.x, a.vel.z) < 0.15) { a.vel.x = 0; a.vel.z = 0; }
    }
    if (inp.jump && a.crouch < 0.5 && limit > 0) {
      a.vel.y = BODY.jumpSpeed;
      a.grounded = false;
      makeNoise(state, a, a.pos.x, a.pos.z, 10, 'steps');
    }
  } else if (wl > 1e-4) {
    a.vel.x += wx * BODY.airAccel * dt;
    a.vel.z += wz * BODY.airAccel * dt;
  }

  const wasGrounded = a.grounded;
  const vyBefore = a.vel.y;
  a.grounded = moveBody(state.map, a.pos, a.vel, dt, BODY.radius, wasGrounded);
  if (!wasGrounded && a.grounded && vyBefore < -5) {
    emit(state, 'land', a.pos.x, a.pos.y, a.pos.z).actor = a;
    makeNoise(state, a, a.pos.x, a.pos.z, 14, 'steps');
  }

  // Running feet are loud; walking and crouching are silent. That is the whole stealth game.
  const hs = Math.hypot(a.vel.x, a.vel.z);
  if (a.grounded && hs > BODY.runSpeed * 0.62) {
    a.stride += hs * dt;
    if (a.stride > 2.2) {
      a.stride = 0;
      emit(state, 'step', a.pos.x, a.pos.y, a.pos.z).actor = a;
      makeNoise(state, a, a.pos.x, a.pos.z, 16, 'steps');
    }
  }
  if (a.flashed > 0) a.flashed = Math.max(0, a.flashed - dt);
}

// Keeps bodies from overlapping. O(n^2) over ten actors is nothing.
export function separateActors(actors) {
  const minD = BODY.radius * 2;
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < actors.length; j++) {
      const b = actors[j];
      if (!b.alive || Math.abs(a.pos.y - b.pos.y) > 1.6) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD || d2 < 1e-8) continue;
      const d = Math.sqrt(d2), push = (minD - d) * 0.5;
      a.pos.x -= (dx / d) * push; a.pos.z -= (dz / d) * push;
      b.pos.x += (dx / d) * push; b.pos.z += (dz / d) * push;
    }
  }
}

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
