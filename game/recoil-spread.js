// Recoil and spread: why stopping to aim pays. Spread is the cone a shot can stray inside; it is at
// its tightest standing still or crouched, opens with speed, opens wide in the air and blooms as a
// spray goes on. Recoil climbs the view and walks it sideways on a fixed pattern, the same for every
// spray, so it can be learned and pulled against. The camera shows the recoil and the crosshair shows
// the spread, so what you see is where the next round goes.

import { heldWeapon } from './state.js';
import { BODY } from './movement-collision.js';
import { clamp } from './mouselook.js';

const CROUCH_SPREAD = 0.72, SPRAY_BLOOM_SHOTS = 14, MAX_CLIMB = 0.32, MAX_DRIFT = 0.12; // radians and shots

// Cone half-angle (radians) the actor's next shot can stray by.
export function spreadOf(a) {
  const w = heldWeapon(a);
  if (!w) return 0.02;
  const d = w.def;
  const speed = Math.hypot(a.vel.x, a.vel.z);
  const moving = clamp((speed - 1.1) / (BODY.runSpeed * d.speed - 1.1), 0, 1); // 0 when still or creeping, 1 at a run
  let s = d.kind === 'sniper' && !a.scoped ? d.unscoped : d.spread;
  s += d.moveSpread * moving;
  if (!a.grounded) s += d.airSpread;
  s += d.sprayGrow * Math.min(a.shots, SPRAY_BLOOM_SHOTS);
  if (a.crouch > 0.5) s *= CROUCH_SPREAD;
  return s;
}

// The kick of one shot: the view climbs, harder as the spray goes on, and drifts right, then
// snakes left and right by shot number.
export function kick(a, def, time) {
  const n = a.shots;
  a.punchPitch = Math.min(MAX_CLIMB, a.punchPitch + def.kick * (1 + Math.min(n, 8) * 0.07));
  const drift = n < 3 ? 0.2 : Math.sin(n * 0.55) * 1.4;
  a.punchYaw = clamp(a.punchYaw + def.kickYaw * drift, -MAX_DRIFT, MAX_DRIFT);
  a.shots++;
  a.lastShot = time;
}

// Between shots the view settles back and the spray count runs down, so short bursts stay accurate.
export function settle(a, recover, time, dt) {
  if (time - a.lastShot > 0.09) {
    const k = Math.exp(-recover * dt);
    a.punchPitch *= k;
    a.punchYaw *= k;
  }
  if (time - a.lastShot > 0.28) a.shots = Math.max(0, a.shots - dt * 18);
}
