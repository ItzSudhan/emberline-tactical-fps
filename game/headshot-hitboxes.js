// Hit detection and damage. A bullet is a ray tested against every soldier's hit volumes: a head
// sphere, a torso box and the legs below it. A headshot multiplies damage (x4 for rifles and
// pistols), a leg hit does three quarters; armour soaks part of a body hit and only a helmet
// protects the head. Rounds with enough penetration punch through soft cover (crates, pot pallets,
// barriers) and hit whoever hides behind it at a reduced damage.

import { emit, pushLine } from './state.js';
import { BODY, bodyHeight, raycast, makeHit } from './movement-collision.js';

const LEG_DAMAGE = 0.75, WALLBANG_DAMAGE = 0.75, PIERCE_FROM = 0.55, TORSO_HALF = 0.27, LEGS_TOP = 0.82; // headshot x def.headMult
const TEAM_KILL_FINE = 300, TAG_SLOWDOWN = 0.6;
const coverHit = makeHit(), wallHit = makeHit();

// Ray against an axis-aligned box; returns entry distance or Infinity.
function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
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

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(r * r - d2);
}

// Fires one round from (ox, oy, oz) along the unit direction (dx, dy, dz) and applies what it hits.
export function traceBullet(state, shooter, ox, oy, oz, dx, dy, dz, def, tracer) {
  const maxT = 160;
  // Two casts: one stops at anything solid, one ignores soft cover. A body found between the two was
  // hiding behind soft cover; weapons with too little penetration stop at the first.
  const coverT = raycast(state.map, ox, oy, oz, dx, dy, dz, maxT, coverHit);
  let bestT = def.pen >= PIERCE_FROM ? raycast(state.map.hard, ox, oy, oz, dx, dy, dz, maxT, wallHit) : coverT;
  const wallT = bestT;
  let victim = null, zone = 'body';
  const actors = state.actors;
  for (let i = 0; i < actors.length; i++) {
    const v = actors[i];
    if (!v.alive || v === shooter) continue;
    // Cheap reject: the ray must pass within 1.3 m of the actor's centre line.
    const cx = v.pos.x - ox, cz = v.pos.z - oz;
    if (cx * dx + cz * dz < 0) continue;
    if (Math.abs(cx * dz - cz * dx) / (Math.hypot(dx, dz) || 1e-6) > 1.3) continue;
    const top = v.pos.y + bodyHeight(v);
    const head = raySphere(ox, oy, oz, dx, dy, dz, v.pos.x, top - BODY.headRadius, v.pos.z, BODY.headRadius);
    if (head < bestT) { bestT = head; victim = v; zone = 'head'; }
    const body = rayBox(ox, oy, oz, dx, dy, dz, v.pos.x - TORSO_HALF, v.pos.y, v.pos.z - TORSO_HALF, v.pos.x + TORSO_HALF, top - BODY.headRadius * 1.8, v.pos.z + TORSO_HALF);
    if (body < bestT) {
      bestT = body;
      victim = v;
      zone = oy + dy * body < v.pos.y + LEGS_TOP ? 'legs' : 'body';
    }
  }
  const end = Math.min(bestT, maxT);
  const through = bestT > coverT + 0.01; // the round went on past soft cover
  if (tracer) {
    const e = emit(state, 'tracer', ox, oy, oz);
    e.a = ox + dx * end; e.b = oy + dy * end; e.c = oz + dz * end; e.actor = shooter;
  }
  if (coverT < maxT && (through || !victim)) impact(state, coverHit, through ? 'wood' : '');
  if (victim) {
    const mult = zone === 'head' ? def.headMult : zone === 'legs' ? LEG_DAMAGE : 1;
    const dmg = def.dmg * mult * Math.pow(def.falloff, end / 25) * (through ? def.pen * WALLBANG_DAMAGE : 1);
    applyDamage(state, victim, shooter, dmg, zone, def.pen, def.name, def.reward);
    const e = emit(state, 'blood', ox + dx * end, oy + dy * end, oz + dz * end);
    e.a = dx; e.b = dy; e.c = dz; e.text = zone; e.actor = shooter;
  } else if (through && wallT < maxT) impact(state, wallHit, '');
}

function impact(state, hit, text) {
  const e = emit(state, 'impact', hit.x, hit.y, hit.z);
  e.a = hit.nx; e.b = hit.ny; e.c = hit.nz; e.text = text;
}

// zone: 'head' | 'body' | 'legs'. `pen` is the share of damage that gets past armour; `label` names
// the weapon in the kill feed and `reward` is what a kill with it pays.
export function applyDamage(state, victim, attacker, amount, zone, pen, label, reward) {
  if (!victim.alive) return;
  let dmg = amount;
  const armoured = victim.armor > 0 && zone !== 'legs' && (zone !== 'head' || victim.helmet);
  if (armoured) {
    const toHp = dmg * pen;
    victim.armor = Math.max(0, victim.armor - (dmg - toHp) * 0.5);
    dmg = toHp;
  }
  dmg = Math.min(victim.hp, Math.max(1, Math.round(dmg)));
  victim.hp -= dmg;
  victim.hurtTime = state.time;
  // Being hit drags you down: a tagged runner cannot simply sprint out of a fight.
  victim.vel.x *= TAG_SLOWDOWN; victim.vel.z *= TAG_SLOWDOWN;
  if (attacker) {
    victim.hurtX = attacker.pos.x; victim.hurtZ = attacker.pos.z;
    if (victim.brain) victim.brain.hurtBy = attacker;
    if (attacker.team !== victim.team) {
      attacker.damage += dmg;
      if (victim.hitBy !== attacker) { victim.hitBy2 = victim.hitBy; victim.hitBy = attacker; }
    }
  }
  const e = emit(state, 'hit', victim.pos.x, victim.pos.y + (zone === 'head' ? 1.6 : 1.1), victim.pos.z);
  e.a = dmg; e.actor = attacker; e.other = victim; e.text = zone;
  if (victim.hp <= 0) kill(state, victim, attacker, label, reward, zone === 'head');
}

// Scores the kill and the assist, pays the reward, drops the Igniter and writes the kill feed line.
function kill(state, victim, attacker, label, reward, headshot) {
  victim.alive = false;
  victim.diedAt = state.time;
  victim.deaths++;
  victim.using = 0;
  victim.scoped = false;
  if (attacker && attacker !== victim) {
    if (attacker.team !== victim.team) {
      attacker.kills++;
      attacker.roundKills++;
      if (headshot) attacker.headKills++;
      attacker.money += reward;
      const helper = victim.hitBy === attacker ? victim.hitBy2 : victim.hitBy;
      if (helper) helper.assists++;
    } else {
      attacker.money = Math.max(0, attacker.money - TEAM_KILL_FINE);
    }
  }
  victim.hitBy = victim.hitBy2 = null;
  const bomb = state.bomb;
  if (bomb.carrier === victim) {
    bomb.carrier = null;
    bomb.state = 'dropped';
    bomb.x = victim.pos.x; bomb.y = victim.pos.y; bomb.z = victim.pos.z;
  }
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
