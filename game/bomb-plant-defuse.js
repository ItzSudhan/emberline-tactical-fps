// The bomb: the Igniter, the objective every round turns on. One Stoker carries it; if the carrier
// dies it drops where they fell and any Stoker can pick it up. Holding use on site A or B for 3.2 s
// plants it and starts a 40 s fuse that beeps faster as it burns down. The Kilnwatch defuse it by
// holding use beside it for 7 s, or 3.6 s with a defuse kit; letting go or dying starts over. If the
// fuse runs out it detonates, hurting everyone near. A plant, a defusal and a detonation each decide
// the round (rounds-halftime.js) and pay more than a win by elimination (economy-buy.js).

import { emit, makeNoise, pushLine } from './state.js';
import { ZONE, zoneAt } from './map-kilnworks.js';
import { applyDamage } from './headshot-hitboxes.js';

export const BOMB = { plantTime: 3.2, fuse: 40, defuseTime: 7, kitDefuseTime: 3.6, plantBonus: 300, blastRadius: 22, reach: 1.5 };

// Hands the Igniter to a carrier at the start of a round.
export function resetBomb(state, carrier) {
  const bomb = state.bomb;
  bomb.state = 'carried';
  bomb.carrier = carrier;
  bomb.site = '';
  bomb.timer = 0;
  bomb.plantProgress = bomb.defuseProgress = 0;
  bomb.defuser = null;
}

// One tick of the Igniter. Returns 'defused' or 'exploded' on the tick that decides the round, else ''.
export function updateBomb(state, dt) {
  const bomb = state.bomb;
  if (bomb.state === 'dropped') pickUp(state);
  if (bomb.state === 'carried') { carryAndPlant(state, dt); return ''; }
  if (bomb.state !== 'planted') return '';

  bomb.timer -= dt;
  state.match.phaseTime = bomb.timer; // the round clock now shows the fuse
  bomb.beep -= dt;
  if (bomb.beep <= 0) {
    bomb.beep = Math.max(0.12, Math.min(1, bomb.timer / 30));
    emit(state, 'beep', bomb.x, bomb.y + 0.2, bomb.z).a = bomb.timer;
  }
  if (defuse(state, dt)) return 'defused';
  if (bomb.timer > 0) return '';
  bomb.state = 'exploded';
  emit(state, 'igniterBlast', bomb.x, bomb.y, bomb.z);
  for (const a of state.actors) {
    const d = Math.hypot(a.pos.x - bomb.x, a.pos.z - bomb.z);
    if (a.alive && d < BOMB.blastRadius) applyDamage(state, a, null, 500 * (1 - d / BOMB.blastRadius) ** 1.5, 'body', 1, 'the Igniter', 0);
  }
  return 'exploded';
}

// A dropped Igniter goes to the first living Stoker to walk over it.
function pickUp(state) {
  const bomb = state.bomb;
  for (const a of state.actors) {
    if (!a.alive || a.team !== 'att' || Math.hypot(a.pos.x - bomb.x, a.pos.z - bomb.z) > 1.2) continue;
    bomb.state = 'carried';
    bomb.carrier = a;
    emit(state, 'pickup', a.pos.x, a.pos.y, a.pos.z).actor = a;
    return;
  }
}

// The Igniter rides with its carrier, who plants by holding use while standing on a site.
function carryAndPlant(state, dt) {
  const bomb = state.bomb, c = bomb.carrier;
  bomb.x = c.pos.x; bomb.y = c.pos.y; bomb.z = c.pos.z;
  const zone = zoneAt(state.map, c.pos.x, c.pos.z);
  for (const a of state.actors) if (a !== c) a.using = 0;
  if (!c.input.use || !c.grounded || (zone !== ZONE.siteA && zone !== ZONE.siteB)) {
    c.using = 0;
    bomb.plantProgress = 0;
    return;
  }
  if (c.using === 0) emit(state, 'planting', c.pos.x, c.pos.y, c.pos.z).actor = c;
  c.using += dt;
  bomb.plantProgress = c.using / BOMB.plantTime;
  if (c.using < BOMB.plantTime) return;
  c.using = 0;
  c.money += BOMB.plantBonus;
  bomb.state = 'planted';
  bomb.carrier = null;
  bomb.site = zone === ZONE.siteA ? 'A' : 'B';
  bomb.timer = BOMB.fuse;
  bomb.beep = 0;
  pushLine(state.feed, { time: state.time, killer: c.name, killerTeam: 'att', victim: '', victimTeam: '', weapon: `planted the Igniter at ${bomb.site}`, headshot: false });
  emit(state, 'planted', bomb.x, bomb.y, bomb.z).actor = c;
  makeNoise(state, c, bomb.x, bomb.z, 200, 'the Igniter');
}

// Defusing: one defender holding use within reach of the Igniter. True on the tick it is made safe.
function defuse(state, dt) {
  const bomb = state.bomb;
  let defuser = null;
  for (const a of state.actors) {
    if (a.team !== 'def') continue;
    if (!defuser && a.alive && a.input.use && a.grounded && Math.hypot(a.pos.x - bomb.x, a.pos.z - bomb.z) < BOMB.reach) defuser = a;
    else a.using = 0;
  }
  if (!defuser) {
    bomb.defuser = null;
    bomb.defuseProgress = 0;
    return false;
  }
  if (bomb.defuser !== defuser) {
    bomb.defuser = defuser;
    defuser.using = 0;
    emit(state, 'defusing', bomb.x, bomb.y, bomb.z).actor = defuser;
  }
  defuser.using += dt;
  const need = defuser.kit ? BOMB.kitDefuseTime : BOMB.defuseTime;
  bomb.defuseProgress = defuser.using / need;
  if (defuser.using < need) return false;
  defuser.using = 0;
  bomb.state = 'defused';
  pushLine(state.feed, { time: state.time, killer: defuser.name, killerTeam: 'def', victim: '', victimTeam: '', weapon: 'defused the Igniter', headshot: false });
  emit(state, 'defused', bomb.x, bomb.y, bomb.z).actor = defuser;
  return true;
}
