// Bot brains: the opponents and squadmates that move, see and shoot back. A bot never touches the
// world directly. It fills the same `input` record the player's keyboard fills and turns its view at
// a limited rate, so it is bound by the same movement, spread and recoil as you. It perceives ten
// times a second (sight-hearing.js), fights whoever it can see, and otherwise plays the objective
// (bot-routes.js). In a fight it reacts after a human delay, settles its aim, strafes between
// bursts and stops dead to fire, pulls against recoil, and breaks to cover to reload or when hurt.

import { heldWeapon } from './state.js';
import { eyeHeight, bodyHeight } from './movement-collision.js';
import { yawTo, wrapAngle, turnToward } from './mouselook.js';
import { switchTo } from './weapons.js';
import { perceive } from './sight-hearing.js';
import { objective, steer, setGoal, lob, findCover } from './bot-routes.js';

// Skill: reaction delay (s), how fast aim error settles, residual aim error (rad), how reliably the
// bot stops before shooting, and how long it sprays.
export const BOT_SKILL = {
  easy: { react: 0.55, settle: 4, error: 0.035, discipline: 0.4, spray: 4 },
  normal: { react: 0.36, settle: 6.5, error: 0.018, discipline: 0.75, spray: 6 },
  hard: { react: 0.24, settle: 9, error: 0.009, discipline: 0.95, spray: 8 },
};

export function createBrain(skillName) {
  return {
    skill: BOT_SKILL[skillName] ?? BOT_SKILL.normal,
    // Perception (sight-hearing.js).
    target: null, targetSeen: -99, react: 0, headPref: false,
    aimErrYaw: 0, aimErrPitch: 0, jitterYaw: 0, jitterPitch: 0,
    lastX: 0, lastZ: 0, lastTime: -99, // where an enemy was last seen
    heardX: 0, heardZ: 0, heardTime: -99, // where a noise last came from
    noiseCursor: 0, thinkPhase: 0, hurtBy: null, lastCall: -99,
    // Navigation and the objective (bot-routes.js).
    path: new Int32Array(200), pathLen: 0, pathIdx: 0,
    goalX: 0, goalZ: 0, hasGoal: false, goalCell: -1, repath: 0,
    stuckT: 0, stuckX: 0, stuckZ: 0,
    watchX: NaN, watchZ: NaN, sweep: 0, lookDown: false,
    hold: null, route: null, waypoint: 0, post: 0, called: false,
    smokeDone: false, flashDone: false, nadeCooldown: 0,
    // The fight.
    phaseT: 0, shooting: false, strafeDir: 1, crouchPref: false,
    cover: false, coverX: 0, coverZ: 0, coverUntil: 0,
  };
}

// One tick of a bot: clear its input, look and listen, then fight or play the objective.
export function updateBot(state, a, dt) {
  const inp = a.input;
  inp.fwd = 0; inp.side = 0; inp.jump = false; inp.walk = false; inp.use = false; inp.fire = false; inp.scope = false;
  if (!a.alive) return;
  const b = a.brain;
  if ((state.tick + b.thinkPhase) % 6 === 0) perceive(state, a, b);
  if (state.match.phase === 'freeze') { inp.crouch = false; return; }

  if (a.flashed > 0.7) {
    // Blinded: back away and, for a moment, spray at the last thing it saw.
    inp.fwd = -1;
    if (b.target && a.flashed < 2.5) inp.fire = (state.tick & 7) < 3;
    turnToward(a, a.yaw + Math.sin(state.time * 3) * 0.5, a.pitch, 2, dt);
    return;
  }

  // Keep a loaded gun up: reload when dry, fall back to the pistol when the primary is spent.
  const w = heldWeapon(a);
  if (w && w.mag === 0 && w.reserve > 0 && a.reloading <= 0) inp.reload = true;
  if (a.current === 'nade' || (!w && a.primary)) switchTo(a, a.primary ? 'primary' : 'secondary');
  if (a.current === 'secondary' && a.primary && a.primary.mag + a.primary.reserve > 0) switchTo(a, 'primary');
  if (a.current === 'primary' && a.primary.mag + a.primary.reserve === 0) switchTo(a, 'secondary');

  const t = b.target;
  if (t && t.alive && state.time - b.targetSeen < 0.4) fight(state, a, b, t, w, dt);
  else {
    if (t && !t.alive) b.target = null;
    inp.crouch = false;
    a.scoped = false;
    objective(state, a, b, dt);
  }
  steer(state, a, b, dt);
}

// An enemy is in sight: aim, peek and shoot.
function fight(state, a, b, t, w, dt) {
  const inp = a.input;
  const ex = a.pos.x, ey = a.pos.y + eyeHeight(a), ez = a.pos.z;
  const dist = Math.hypot(t.pos.x - ex, t.pos.z - ez);
  // Aim at the head or centre mass, lead a moving target a little, and pull against the recoil. The
  // error from first seeing the target decays; a small jitter never does.
  const aimY = t.pos.y + bodyHeight(t) - (b.headPref && dist < 30 ? 0.2 : 0.55);
  b.aimErrYaw *= Math.exp(-b.skill.settle * dt);
  b.aimErrPitch *= Math.exp(-b.skill.settle * dt);
  const lead = 0.06;
  const wantYaw = yawTo(t.pos.x + t.vel.x * lead - ex, t.pos.z + t.vel.z * lead - ez) + b.aimErrYaw + b.jitterYaw - a.punchYaw * 0.6;
  const wantPitch = Math.atan2(aimY - ey, dist) + b.aimErrPitch + b.jitterPitch - a.punchPitch * 0.65;
  turnToward(a, wantYaw, wantPitch, 9, dt);
  b.react -= dt;

  // Reloading or badly hurt: break line of sight and recover behind cover.
  if (!b.cover && w && ((w.mag === 0 && a.reloading > 0) || (a.hp < 35 && state.rng.chance(0.02))) && findCover(state, a, b, t)) {
    b.cover = true;
    b.coverUntil = state.time + 2.2;
  }
  if (b.cover) {
    if (state.time > b.coverUntil || (a.reloading <= 0 && a.hp >= 35)) b.cover = false;
    else {
      setGoal(b, b.coverX, b.coverZ);
      inp.crouch = Math.hypot(a.pos.x - b.coverX, a.pos.z - b.coverZ) < 1;
      return;
    }
  }

  // Peek rhythm: strafe a short way, then stop dead and fire a burst. Stopping is what makes it hit.
  b.phaseT -= dt;
  if (b.phaseT <= 0) {
    b.shooting = !b.shooting || dist < 7;
    const rng = state.rng;
    b.phaseT = b.shooting ? 0.45 + rng.next() * b.skill.spray * 0.08 : 0.25 + rng.next() * 0.35;
    if (!b.shooting) b.strafeDir = rng.chance(0.6) ? -b.strafeDir : b.strafeDir;
  }
  b.hasGoal = false;
  if (!b.shooting) {
    inp.side = b.strafeDir;
    if ((w && w.def.kind === 'shotgun') || dist > 45) inp.fwd = dist > 12 ? 1 : 0; // close the range
  } else {
    if (state.rng.next() > b.skill.discipline) inp.side = b.strafeDir * 0.6; // a sloppy bot keeps drifting
    inp.crouch = b.crouchPref && dist > 14;
  }
  if (w && w.def.kind === 'sniper' && dist > 10) inp.scope = !a.scoped && (state.tick & 1) === 0;

  // Fire only once reacted, on target, steady, and with no squadmate in the line of fire.
  if (b.react <= 0 && w && w.mag > 0 && b.shooting) {
    const onTarget = Math.abs(wrapAngle(wantYaw - a.yaw)) < Math.max(0.025, Math.atan2(0.42, dist)) + 0.01;
    const steady = Math.hypot(a.vel.x, a.vel.z) < 2.2 || dist < 9;
    if (onTarget && steady && !friendlyInLine(state, a, t)) inp.fire = w.def.auto ? true : !inp.firePrev;
  }
  // Now and then, a frag for someone holding still at mid range.
  b.nadeCooldown -= dt;
  if (b.nadeCooldown <= 0 && a.frag > 0 && dist > 9 && dist < 26 && state.rng.chance(0.01)) {
    lob(state, a, 'frag', t.pos.x, t.pos.z);
    b.nadeCooldown = 8;
  }
}

// True when a living squadmate stands within a body-width of the line to the target.
function friendlyInLine(state, a, t) {
  const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z;
  const len2 = dx * dx + dz * dz || 1;
  for (const o of state.actors) {
    if (o === a || !o.alive || o.team !== a.team) continue;
    const u = ((o.pos.x - a.pos.x) * dx + (o.pos.z - a.pos.z) * dz) / len2;
    if (u <= 0 || u >= 1) continue;
    const px = a.pos.x + dx * u - o.pos.x, pz = a.pos.z + dz * u - o.pos.z;
    if (px * px + pz * pz < 0.55 * 0.55) return true;
  }
  return false;
}
