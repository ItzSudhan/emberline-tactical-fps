// Soldiers: the player and every bot are the same kind of actor driven by the same `input` record,
// so bots obey the same acceleration, crouch, spread and collision rules the player does.

import { BODY, WEAPONS, ECON, SIDES } from './config.js';
import { moveBody } from './physics.js';
import { emit, makeNoise, pushLine } from './state.js';
import { cellCenter } from './mapdata.js';
import { approach, lerp } from './util.js';

let nextId = 1;

export function createActor(team, name, isPlayer = false) {
  return {
    id: nextId++,
    name,
    team,
    isPlayer,
    alive: true,
    hp: 100,
    armor: 0,
    helmet: false,
    money: ECON.start,
    pos: { x: 0, y: 0, z: 0 },
    prev: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    crouch: 0,
    grounded: true,
    input: { fwd: 0, side: 0, jump: false, crouch: false, walk: false, fire: false, firePrev: false, reload: false, use: false, scope: false, scopePrev: false, slot: '' },
    primary: null,
    secondary: weaponInstance('pike'),
    frag: 0,
    smoke: 0,
    flash: 0,
    kit: false,
    current: 'secondary',
    lastSlot: 'secondary',
    nadeType: 'frag',
    cooldown: 0,
    reloading: 0,
    switching: 0,
    shots: 0,
    lastShot: -9,
    punchPitch: 0,
    punchYaw: 0,
    scoped: false,
    flashed: 0,
    hurtTime: -9,
    hurtX: 0,
    hurtZ: 0,
    kills: 0,
    deaths: 0,
    roundKills: 0,
    stride: 0,
    using: 0, // seconds spent holding plant / defuse
    diedAt: -99,
    seenBy: { att: -99, def: -99 }, // last time each side had eyes on this actor (minimap)
    brain: null,
  };
}

export function weaponInstance(id) {
  const def = WEAPONS[id];
  return { def, mag: def.mag, reserve: def.reserve };
}

export function heldWeapon(a) {
  if (a.current === 'primary') return a.primary;
  if (a.current === 'secondary') return a.secondary;
  return null;
}

export const bodyHeight = (a) => lerp(BODY.height, BODY.crouchHeight, a.crouch);
export const eyeHeight = (a) => lerp(BODY.eye, BODY.crouchEye, a.crouch);

export function speedLimit(state, a) {
  const w = heldWeapon(a);
  let s = BODY.runSpeed * (w ? w.def.speed : 1);
  if (a.scoped) s *= 0.5;
  if (a.crouch > 0.5) s *= BODY.crouchFactor;
  else if (a.input.walk) s *= BODY.walkFactor;
  if (a.using > 0) s = 0;
  if (state.match.phase === 'freeze') s = 0;
  return s;
}

export function switchTo(a, slot) {
  if (slot === a.current) return;
  if (slot === 'primary' && !a.primary) return;
  if (slot === 'nade' && a.frag + a.smoke + a.flash === 0) return;
  a.lastSlot = a.current;
  a.current = slot;
  a.switching = 0.32;
  a.reloading = 0;
  a.scoped = false;
  a.shots = 0;
}

// Picks the next grenade type the actor owns, cycling frag -> smoke -> flash.
export function cycleNade(a) {
  const order = ['frag', 'smoke', 'flash'];
  let i = order.indexOf(a.nadeType);
  for (let k = 0; k < 3; k++) {
    i = (i + 1) % 3;
    if (a[order[i]] > 0) { a.nadeType = order[i]; return; }
  }
}

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
      makeNoise(state, a, a.pos.x, a.pos.z, 10);
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
    makeNoise(state, a, a.pos.x, a.pos.z, 14);
  }

  // Running feet are loud; walking and crouching are silent. That is the whole stealth game.
  const hs = Math.hypot(a.vel.x, a.vel.z);
  if (a.grounded && hs > BODY.runSpeed * 0.62) {
    a.stride += hs * dt;
    if (a.stride > 2.2) {
      a.stride = 0;
      emit(state, 'step', a.pos.x, a.pos.y, a.pos.z).actor = a;
      makeNoise(state, a, a.pos.x, a.pos.z, 16);
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

// zone: 'head' | 'body' | 'legs'. Armour soaks part of body hits; a helmet protects the head.
export function applyDamage(state, victim, attacker, amount, zone, pen, weaponName) {
  if (!victim.alive) return;
  let dmg = amount;
  const armoured = victim.armor > 0 && zone !== 'legs' && (zone !== 'head' || victim.helmet);
  if (armoured) {
    const toHp = dmg * pen;
    victim.armor = Math.max(0, victim.armor - (dmg - toHp) * 0.5);
    dmg = toHp;
  }
  dmg = Math.max(1, Math.round(dmg));
  victim.hp -= dmg;
  victim.hurtTime = state.time;
  if (attacker) { victim.hurtX = attacker.pos.x; victim.hurtZ = attacker.pos.z; }
  const e = emit(state, 'hit', victim.pos.x, victim.pos.y + (zone === 'head' ? 1.6 : 1.1), victim.pos.z);
  e.a = dmg; e.actor = attacker; e.other = victim; e.text = zone;
  if (victim.brain && attacker) victim.brain.hurtBy = attacker;
  if (victim.hp <= 0) killActor(state, victim, attacker, weaponName, zone === 'head');
}

export function killActor(state, victim, attacker, weaponName, headshot) {
  victim.alive = false;
  victim.diedAt = state.time;
  victim.hp = 0;
  victim.deaths++;
  victim.using = 0;
  victim.scoped = false;
  victim.primary = null;
  victim.secondary = weaponInstance('pike');
  victim.frag = victim.smoke = victim.flash = 0;
  victim.armor = 0;
  victim.helmet = false;
  victim.kit = false;
  victim.current = 'secondary';
  if (attacker && attacker !== victim) {
    if (attacker.team !== victim.team) {
      attacker.kills++;
      attacker.roundKills++;
      const reward = WEAPONS[weaponName]?.reward ?? ECON.kill;
      attacker.money = Math.min(ECON.max, attacker.money + reward);
    } else {
      attacker.money = Math.max(0, attacker.money - 300);
    }
  }
  const bomb = state.bomb;
  if (bomb.carrier === victim) {
    bomb.carrier = null;
    bomb.state = 'dropped';
    bomb.x = victim.pos.x; bomb.y = victim.pos.y; bomb.z = victim.pos.z;
  }
  const label = WEAPONS[weaponName]?.name ?? weaponName;
  pushLine(state.feed, {
    time: state.time,
    killer: attacker ? attacker.name : '',
    killerTeam: attacker ? attacker.team : '',
    victim: victim.name,
    victimTeam: victim.team,
    weapon: label,
    headshot,
  });
  const e = emit(state, 'death', victim.pos.x, victim.pos.y, victim.pos.z);
  e.actor = attacker; e.other = victim; e.text = label; e.a = headshot ? 1 : 0;
}

export function resetForRound(state, a, cell) {
  if (!a.alive) {
    a.primary = null;
    a.secondary = weaponInstance('pike');
    a.frag = a.smoke = a.flash = 0;
    a.armor = 0;
    a.helmet = false;
    a.kit = false;
  }
  if (a.team === 'att') a.kit = false;
  a.alive = true;
  a.hp = 100;
  if (a.primary) { a.primary.mag = a.primary.def.mag; a.primary.reserve = a.primary.def.reserve; }
  a.secondary.mag = a.secondary.def.mag;
  a.secondary.reserve = a.secondary.def.reserve;
  const jitter = (state.rng.next() - 0.5) * 0.6;
  a.pos.x = cellCenter(cell[0]) + jitter;
  a.pos.z = cellCenter(cell[1]) - jitter;
  a.pos.y = 0;
  a.prev.x = a.pos.x; a.prev.y = 0; a.prev.z = a.pos.z;
  a.vel.x = a.vel.y = a.vel.z = 0;
  a.yaw = a.team === 'att' ? 0 : Math.PI;
  a.pitch = 0;
  a.crouch = 0;
  a.current = a.primary ? 'primary' : 'secondary';
  a.cooldown = a.reloading = a.switching = 0;
  a.shots = 0;
  a.punchPitch = a.punchYaw = 0;
  a.scoped = false;
  a.flashed = 0;
  a.roundKills = 0;
  a.using = 0;
  a.hurtTime = -9;
}

export const teamName = (team) => SIDES[team].name;
