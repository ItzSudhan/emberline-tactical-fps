// Thrown utility: Shard (frag), Veil (smoke) and Glare (flash). Grenades bounce off the grid,
// frags need line of sight to hurt, smokes block bot vision, flashes blind whoever faces them.

import { GEAR, GRAVITY } from './config.js';
import { raycast, makeHit, clearLine } from './physics.js';
import { applyDamage, eyeHeight } from './actors.js';
import { emit, makeNoise } from './state.js';
import { dirFromAngles } from './util.js';

const hit = makeHit();
const look = { x: 0, y: 0, z: 0 };

export function throwGrenade(state, a, type, vx, vy, vz) {
  const g = state.grenades.find((s) => !s.active);
  if (!g || a[type] <= 0) return;
  a[type]--;
  g.active = true;
  g.type = type;
  g.x = a.pos.x; g.y = a.pos.y + eyeHeight(a) - 0.1; g.z = a.pos.z;
  g.vx = vx; g.vy = vy; g.vz = vz;
  g.fuse = GEAR[type].fuse;
  g.owner = a;
  g.rest = false;
  const e = emit(state, 'throw', g.x, g.y, g.z);
  e.actor = a; e.text = type;
}

export function updateGrenades(state, dt) {
  for (const g of state.grenades) {
    if (!g.active) continue;
    if (!g.rest) {
      g.vy -= GRAVITY * dt;
      const sp = Math.hypot(g.vx, g.vy, g.vz);
      const stepLen = sp * dt;
      if (stepLen > 1e-5) {
        const dx = g.vx / sp, dy = g.vy / sp, dz = g.vz / sp;
        const t = raycast(state.map, g.x, g.y, g.z, dx, dy, dz, stepLen + 0.08, hit);
        if (t <= stepLen + 0.08) {
          g.x = hit.x - dx * 0.08; g.y = Math.max(0.06, hit.y - dy * 0.08); g.z = hit.z - dz * 0.08;
          // Reflect about the surface normal and lose energy.
          const vn = g.vx * hit.nx + g.vy * hit.ny + g.vz * hit.nz;
          g.vx = (g.vx - 2 * vn * hit.nx) * 0.62;
          g.vy = (g.vy - 2 * vn * hit.ny) * 0.42;
          g.vz = (g.vz - 2 * vn * hit.nz) * 0.62;
          if (sp > 3) emit(state, 'bounce', g.x, g.y, g.z);
          if (hit.ny > 0.5 && Math.abs(g.vy) < 1.4) {
            g.vy = 0;
            g.vx *= 0.7; g.vz *= 0.7;
            if (Math.hypot(g.vx, g.vz) < 0.4) g.rest = true;
          }
        } else {
          g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
        }
      }
    }
    g.fuse -= dt;
    if (g.fuse <= 0) detonate(state, g);
  }
  for (const s of state.smokes) {
    if (!s.active) continue;
    s.life -= dt;
    const age = GEAR.smoke.life - s.life;
    s.density = Math.min(1, age / 1.2) * Math.min(1, s.life / 2.5);
    if (s.life <= 0) s.active = false;
  }
}

function detonate(state, g) {
  g.active = false;
  const owner = g.owner;
  if (g.type === 'frag') {
    const R = GEAR.frag.radius;
    for (const a of state.actors) {
      if (!a.alive) continue;
      const cy = a.pos.y + 1.0;
      const d = Math.hypot(a.pos.x - g.x, cy - g.y, a.pos.z - g.z);
      if (d > R || !clearLine(state.map, g.x, g.y + 0.2, g.z, a.pos.x, cy, a.pos.z)) continue;
      const dmg = GEAR.frag.damage * Math.pow(1 - d / R, 1.3);
      if (dmg >= 1) applyDamage(state, a, owner, dmg, 'body', 0.6, 'Shard');
    }
    emit(state, 'explode', g.x, g.y, g.z).actor = owner;
    makeNoise(state, owner, g.x, g.z, 60);
  } else if (g.type === 'smoke') {
    const s = state.smokes.find((v) => !v.active) ?? state.smokes[0];
    s.active = true;
    s.x = g.x; s.y = g.y + 1.4; s.z = g.z;
    s.radius = GEAR.smoke.radius;
    s.life = GEAR.smoke.life;
    s.density = 0;
    emit(state, 'smoke', g.x, g.y, g.z).actor = owner;
    makeNoise(state, owner, g.x, g.z, 25);
  } else {
    for (const a of state.actors) {
      if (!a.alive) continue;
      const ex = a.pos.x, ey = a.pos.y + eyeHeight(a), ez = a.pos.z;
      const dx = g.x - ex, dy = g.y - ey, dz = g.z - ez;
      const d = Math.hypot(dx, dy, dz);
      if (d > GEAR.flash.radius || !clearLine(state.map, ex, ey, ez, g.x, g.y + 0.1, g.z)) continue;
      dirFromAngles(a.yaw, a.pitch, look);
      const facing = (look.x * dx + look.y * dy + look.z * dz) / (d || 1);
      // The thrower's own squad hears the call and half turns away.
      const warned = owner && a.team === owner.team ? 0.4 : 1;
      const amount = Math.max(0, (facing + 0.35) / 1.35) * (1 - d / GEAR.flash.radius) * warned;
      a.flashed = Math.max(a.flashed, amount * 4.2);
    }
    emit(state, 'flash', g.x, g.y, g.z).actor = owner;
    makeNoise(state, owner, g.x, g.z, 40);
  }
}
