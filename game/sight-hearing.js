// What a bot knows: only what it sees and hears. Sight is a forward cone with a clear line to the
// target's head or chest that walls, cover and smoke all block, followed by a reaction delay before
// it may shoot. Hearing is the noise ring: gunfire, running footsteps, grenades and the Igniter
// carry to a radius, and a bot that hears one turns to face it and calls it on the radio. Nothing
// here reads an enemy's position any other way, so walking quietly or throwing smoke works on bots.

import { NOISE_CAPACITY, radio } from './state.js';
import { roomNameAt } from './map-kilnworks.js';
import { eyeHeight, bodyHeight, clearLine, smokeBlocks } from './movement-collision.js';

const VIEW_CONE = 0.42, VIEW_RANGE = 80, CLOSE_RANGE = 3.5, CALL_EVERY = 6; // cos of the half-angle, metres, seconds

// Runs ten times a second for each bot: refreshes its target, its squad's intel and what it heard.
export function perceive(state, a, b) {
  see(state, a, b);
  hear(state, a, b);
  // Aim jitter is re-rolled with each look, scaled by the bot's skill.
  b.jitterYaw = state.rng.gauss() * b.skill.error;
  b.jitterPitch = state.rng.gauss() * b.skill.error * 0.6;
}

// Picks the nearest visible enemy, preferring the current target and the wounded.
function see(state, a, b) {
  const ex = a.pos.x, ey = a.pos.y + eyeHeight(a), ez = a.pos.z;
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  let best = null, bestScore = Infinity;
  for (const e of state.actors) {
    if (!e.alive || e.team === a.team) continue;
    const dx = e.pos.x - ex, dz = e.pos.z - ez;
    const dist = Math.hypot(dx, dz);
    if (dist > VIEW_RANGE) continue;
    // Outside the view cone only someone very close, or the enemy already being fought, is noticed.
    if ((dx * fx + dz * fz) / (dist || 1) < VIEW_CONE && dist > CLOSE_RANGE && b.target !== e) continue;
    const top = e.pos.y + bodyHeight(e);
    if (!clearLine(state.map, ex, ey, ez, e.pos.x, top - 0.18, e.pos.z) && !clearLine(state.map, ex, ey, ez, e.pos.x, top - 0.7, e.pos.z)) continue;
    if (smokeBlocks(state.smokes, ex, ey, ez, e.pos.x, top - 0.4, e.pos.z)) continue;
    const score = dist * (b.target === e ? 0.6 : 1) * (e.hp < 40 ? 0.85 : 1);
    if (score < bestScore) { bestScore = score; best = e; }
  }
  if (!best) return;
  if (best !== b.target) {
    // A new target: start the reaction clock and a fresh aim error that then settles.
    const rng = state.rng;
    b.react = b.skill.react * (0.75 + rng.next() * 0.6) + (bestScore > 35 ? 0.12 : 0);
    b.aimErrYaw = rng.gauss() * 0.09;
    b.aimErrPitch = rng.gauss() * 0.04;
    b.phaseT = 0;
    b.shooting = true;
    b.strafeDir = rng.chance(0.5) ? 1 : -1;
    // Better shooters go for the head more often; the rest aim centre mass.
    b.headPref = rng.chance(b.skill.error < 0.012 ? 0.6 : b.skill.error < 0.02 ? 0.28 : 0.1);
    b.target = best;
  }
  b.targetSeen = state.time;
  best.seenBy[a.team] = state.time;
  b.lastX = best.pos.x; b.lastZ = best.pos.z; b.lastTime = state.time;
  // Share it: the squad's intel drives rotations and executes, and the radio tells the player.
  const intel = state.intel[a.team];
  const room = roomNameAt(state.map, best.pos.x, best.pos.z);
  intel.x = best.pos.x; intel.z = best.pos.z; intel.time = state.time; intel.room = room;
  if (state.time - b.lastCall > CALL_EVERY && room) {
    b.lastCall = state.time;
    radio(state, a, `Contact, ${room}`);
  }
}

// Reads the noises made since this bot last listened and keeps the latest one in earshot.
function hear(state, a, b) {
  const from = Math.max(b.noiseCursor, state.noiseCount - NOISE_CAPACITY);
  for (let n = from; n < state.noiseCount; n++) {
    const s = state.noises[n % NOISE_CAPACITY];
    if (s.team === a.team || !s.team || Math.hypot(s.x - a.pos.x, s.z - a.pos.z) > s.radius) continue;
    b.heardX = s.x; b.heardZ = s.z; b.heardTime = s.time;
    if (state.time - b.lastCall > CALL_EVERY && state.time - b.targetSeen > 2) {
      b.lastCall = state.time;
      radio(state, a, `Heard ${s.kind}, ${roomNameAt(state.map, s.x, s.z) || 'close'}`);
    }
  }
  b.noiseCursor = state.noiseCount;
  // Being shot tells you roughly where from, even from behind.
  if (b.hurtBy) {
    if (b.hurtBy.alive && b.hurtBy.team !== a.team) { b.heardX = b.hurtBy.pos.x; b.heardZ = b.hurtBy.pos.z; b.heardTime = state.time; }
    b.hurtBy = null;
  }
}
