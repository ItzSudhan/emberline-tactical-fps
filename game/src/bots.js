// Bot brains. A bot never touches the world directly: it writes the same `input` record a player's
// keyboard does and turns its view at a limited rate, so its accuracy obeys the same spread and
// recoil rules. Perception runs ten times a second: a field of view, line of sight that smoke and
// walls block, and hearing of gunfire and running feet. Between those, it steers along A* paths.

import { BOT_SKILL, WEAPONS } from './config.js';
import { findPath, cellX, cellZ, isWalkable } from './nav.js';
import { clearLine, smokeBlocks } from './physics.js';
import { eyeHeight, bodyHeight, heldWeapon, switchTo, weaponInstance } from './actors.js';
import { throwGrenade } from './grenades.js';
import { cellOf, cellCenter, HOLDS, ROUTES, POSTPLANT, PLANT_SPOTS, roomNameAt } from './mapdata.js';
import { yawTo, wrapAngle, clamp } from './util.js';
import { pushLine, NOISE_CAPACITY } from './state.js';

const SITE_OF_ROOM = {
  'Kiln Hall': 'A', 'A Site': 'A', 'Short A': 'A', 'Long Gallery': 'A', 'Upper Walk A': 'A', 'Clay Pits': 'A',
  'Silo Court': 'B', 'B Site': 'B', 'Short B': 'B', 'Culverts': 'B', 'Upper Walk B': 'B', 'Drain Run': 'B',
};

export function createBrain(skillName) {
  return {
    skill: BOT_SKILL[skillName] ?? BOT_SKILL.normal,
    path: new Int32Array(200),
    pathLen: 0,
    pathIdx: 0,
    goalX: 0, goalZ: 0, hasGoal: false, goalCell: -1, repath: 0,
    target: null, targetSeen: -99, react: 0, headPref: false,
    aimErrYaw: 0, aimErrPitch: 0, jitterYaw: 0, jitterPitch: 0,
    lastX: 0, lastZ: 0, lastTime: -99,
    heardX: 0, heardZ: 0, heardTime: -99,
    noiseCursor: 0,
    thinkPhase: 0,
    role: 'hold', hold: null, route: null, waypoint: 0, post: 0,
    phaseT: 0, shooting: false, strafeDir: 1, crouchPref: false,
    cover: false, coverX: 0, coverZ: 0, coverUntil: 0,
    hurtBy: null,
    smokeDone: false,
    nadeCooldown: 0,
    stuckT: 0, stuckX: 0, stuckZ: 0,
    sweep: 0,
    lastCall: -99,
  };
}

// ---------- round setup ----------

export function planRound(state) {
  const rng = state.rng;
  const plan = state.plan;
  plan.site = rng.chance(0.5) ? 'A' : 'B';
  plan.executeAt = 16 + rng.range(0, 14);
  plan.executing = false;
  plan.smokesThrown = 0;
  const routes = ROUTES[plan.site];
  let ri = rng.int(2);
  const holds = HOLDS.slice();
  for (let i = holds.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = holds[i]; holds[i] = holds[j]; holds[j] = t; }
  let hi = 0;
  let post = 0;
  for (const a of state.actors) {
    const b = a.brain;
    if (!b) continue;
    b.target = null; b.lastTime = -99; b.heardTime = -99; b.hasGoal = false; b.pathLen = 0;
    b.cover = false; b.hurtBy = null; b.smokeDone = false; b.nadeCooldown = 3 + rng.next() * 4;
    b.noiseCursor = state.noiseCount;
    b.thinkPhase = rng.int(6);
    b.crouchPref = rng.chance(0.35);
    b.post = post++;
    if (a.team === 'att') {
      b.role = 'route';
      b.route = routes[ri++ % 2];
      b.waypoint = 0;
    } else {
      b.role = 'hold';
      b.hold = holds[hi++ % holds.length];
    }
  }
}

// Bots spend money like a team: full buys when they can afford rifles, saves when they cannot.
export function botBuy(state, a, teamAvg) {
  const rng = state.rng;
  const pistolRound = state.match.round === 1;
  const eco = !pistolRound && teamAvg < 2300 && !a.primary;
  const buy = (cost) => { if (a.money >= cost) { a.money -= cost; return true; } return false; };
  if (pistolRound) {
    if (rng.chance(0.5)) { if (buy(650)) a.armor = 100; } else if (buy(WEAPONS.marten.price)) a.secondary = weaponInstance('marten');
    if (a.money >= 300 && rng.chance(0.5)) { a.money -= 200; a.flash++; }
    return;
  }
  if (eco) {
    if (a.money > 1400 && rng.chance(0.4) && buy(WEAPONS.marten.price)) a.secondary = weaponInstance('marten');
    return;
  }
  if (!a.primary) {
    if (a.money >= 5600 && rng.chance(0.22)) { buy(4500); a.primary = weaponInstance('longreach'); }
    else if (a.money >= 2900) { buy(2900); a.primary = weaponInstance('kestrel'); }
    else if (a.money >= 1250) { const id = rng.chance(0.7) ? 'wren' : 'brush'; buy(WEAPONS[id].price); a.primary = weaponInstance(id); }
  }
  if (a.armor < 50 || !a.helmet) {
    if (buy(1000)) { a.armor = 100; a.helmet = true; } else if (a.armor < 50 && buy(650)) a.armor = 100;
  }
  if (a.team === 'def' && !a.kit && rng.chance(0.6) && buy(400)) a.kit = true;
  if (rng.chance(0.7) && buy(300)) a.smoke = 1;
  if (rng.chance(0.6) && buy(300)) a.frag = 1;
  if (rng.chance(0.5) && buy(200)) a.flash = 1;
  a.current = a.primary ? 'primary' : 'secondary';
}

// ---------- per tick ----------

export function updateBot(state, a, dt) {
  const inp = a.input;
  inp.fwd = 0; inp.side = 0; inp.jump = false; inp.walk = false; inp.use = false; inp.fire = false; inp.scope = false;
  if (!a.alive) return;
  const b = a.brain;
  if ((state.tick + b.thinkPhase) % 6 === 0) perceive(state, a, b);
  if (state.match.phase === 'freeze') { inp.crouch = false; return; }

  if (a.flashed > 0.7) {
    // Blinded: back away and spray at the last thing it saw.
    inp.fwd = -1;
    if (b.target && a.flashed < 2.5) inp.fire = (state.tick & 7) < 3;
    turnToward(a, a.yaw + Math.sin(state.time * 3) * 0.5, a.pitch, 2, dt);
    return;
  }

  const w = heldWeapon(a);
  if (w && w.mag === 0 && w.reserve > 0 && a.reloading <= 0) inp.reload = true;
  if (a.current === 'nade' || (!w && a.primary)) switchTo(a, a.primary ? 'primary' : 'secondary');
  if (a.current === 'secondary' && a.primary && a.primary.mag + a.primary.reserve > 0) switchTo(a, 'primary');
  if (a.current === 'primary' && a.primary && a.primary.mag + a.primary.reserve === 0) switchTo(a, 'secondary');

  const t = b.target;
  if (t && t.alive && state.time - b.targetSeen < 0.4) {
    combat(state, a, b, t, w, dt);
  } else {
    if (t && !t.alive) b.target = null;
    inp.crouch = false;
    a.scoped = false;
    objective(state, a, b, dt);
  }
  steer(state, a, b, dt);
}

function perceive(state, a, b) {
  const ex = a.pos.x, ey = a.pos.y + eyeHeight(a), ez = a.pos.z;
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  let best = null, bestScore = Infinity;
  for (const e of state.actors) {
    if (!e.alive || e.team === a.team) continue;
    const dx = e.pos.x - ex, dz = e.pos.z - ez;
    const dist = Math.hypot(dx, dz);
    if (dist > 80) continue;
    const dot = (dx * fx + dz * fz) / (dist || 1);
    if (dot < 0.42 && dist > 3.5 && b.target !== e) continue;
    const top = e.pos.y + bodyHeight(e);
    const seen = (clearLine(state.map, ex, ey, ez, e.pos.x, top - 0.18, e.pos.z) || clearLine(state.map, ex, ey, ez, e.pos.x, top - 0.7, e.pos.z))
      && !smokeBlocks(state.smokes, ex, ey, ez, e.pos.x, top - 0.4, e.pos.z);
    if (!seen) continue;
    const score = dist * (b.target === e ? 0.6 : 1) * (e.hp < 40 ? 0.85 : 1);
    if (score < bestScore) { bestScore = score; best = e; }
  }
  if (best) {
    if (best !== b.target) {
      const rng = state.rng;
      const far = Math.hypot(best.pos.x - ex, best.pos.z - ez) > 35 ? 0.12 : 0;
      b.react = b.skill.react * (0.75 + rng.next() * 0.6) + far;
      b.aimErrYaw = rng.gauss() * 0.09;
      b.aimErrPitch = rng.gauss() * 0.04;
      b.phaseT = 0; b.shooting = true;
      b.strafeDir = rng.chance(0.5) ? 1 : -1;
      // Better shooters go for the head more often; the rest aim centre mass.
      b.headPref = rng.chance(b.skill.error < 0.012 ? 0.7 : b.skill.error < 0.02 ? 0.35 : 0.1);
      b.target = best;
    }
    b.targetSeen = state.time;
    best.seenBy[a.team] = state.time;
    b.lastX = best.pos.x; b.lastZ = best.pos.z; b.lastTime = state.time;
    const intel = state.intel[a.team];
    const room = roomNameAt(state.map, best.pos.x, best.pos.z);
    intel.x = best.pos.x; intel.z = best.pos.z; intel.time = state.time; intel.room = room;
    if (state.time - b.lastCall > 6 && room) {
      b.lastCall = state.time;
      pushLine(state.radio, { time: state.time, team: a.team, name: a.name, text: `Contact, ${room}` }, 4);
    }
  }
  const rng = state.rng;
  b.jitterYaw = rng.gauss() * b.skill.error;
  b.jitterPitch = rng.gauss() * b.skill.error * 0.6;

  // Hearing: enemy gunfire and running feet within each noise's radius.
  const from = Math.max(b.noiseCursor, state.noiseCount - NOISE_CAPACITY);
  for (let n = from; n < state.noiseCount; n++) {
    const s = state.noises[n % NOISE_CAPACITY];
    if (s.team === a.team || !s.team) continue;
    if (Math.hypot(s.x - ex, s.z - ez) > s.radius) continue;
    b.heardX = s.x; b.heardZ = s.z; b.heardTime = s.time;
  }
  b.noiseCursor = state.noiseCount;
  if (b.hurtBy) {
    if (b.hurtBy.alive && b.hurtBy.team !== a.team) { b.heardX = b.hurtBy.pos.x; b.heardZ = b.hurtBy.pos.z; b.heardTime = state.time; }
    b.hurtBy = null;
  }
}

function combat(state, a, b, t, w, dt) {
  const inp = a.input;
  const ex = a.pos.x, ey = a.pos.y + eyeHeight(a), ez = a.pos.z;
  const dx = t.pos.x - ex, dz = t.pos.z - ez;
  const dist = Math.hypot(dx, dz);
  const headAim = b.headPref && dist < 30;
  const aimY = t.pos.y + bodyHeight(t) - (headAim ? 0.2 : 0.55);
  b.aimErrYaw *= Math.exp(-b.skill.settle * dt);
  b.aimErrPitch *= Math.exp(-b.skill.settle * dt);
  // Lead a moving target a little and pull against recoil.
  const lead = 0.06;
  const tx = t.pos.x + t.vel.x * lead, tz = t.pos.z + t.vel.z * lead;
  const wantYaw = yawTo(tx - ex, tz - ez) + b.aimErrYaw + b.jitterYaw - a.punchYaw * 0.6;
  const wantPitch = Math.atan2(aimY - ey, dist) + b.aimErrPitch + b.jitterPitch - a.punchPitch * 0.65;
  turnToward(a, wantYaw, wantPitch, 9, dt);
  b.react -= dt;

  // Out of ammo or hurt: break line of sight and recover.
  if (!b.cover && w && ((w.mag === 0 && a.reloading > 0) || (a.hp < 35 && state.rng.chance(0.02)))) {
    if (findCover(state, a, b, t)) { b.cover = true; b.coverUntil = state.time + 2.2; }
  }
  if (b.cover) {
    if (state.time > b.coverUntil || (a.reloading <= 0 && a.hp >= 35)) b.cover = false;
    else { setGoal(b, b.coverX, b.coverZ); inp.crouch = Math.hypot(a.pos.x - b.coverX, a.pos.z - b.coverZ) < 1; return; }
  }

  // Peek rhythm: strafe a short way, then stop dead and fire a burst. Stopping is what makes it hit.
  b.phaseT -= dt;
  if (b.phaseT <= 0) {
    b.shooting = !b.shooting || dist < 7;
    const rng = state.rng;
    b.phaseT = b.shooting ? 0.45 + rng.next() * b.skill.spray * 0.08 : 0.25 + rng.next() * 0.35;
    if (!b.shooting) b.strafeDir = rng.chance(0.6) ? -b.strafeDir : b.strafeDir;
  }
  const disciplined = state.rng.next() < b.skill.discipline;
  b.hasGoal = false;
  if (!b.shooting) {
    inp.side = b.strafeDir;
    if (w && w.def.kind === 'shotgun' || dist > 45) inp.fwd = dist > 12 ? 1 : 0;
  } else {
    if (!disciplined) inp.side = b.strafeDir * 0.6;
    inp.crouch = b.crouchPref && dist > 14;
  }
  if (w && w.def.kind === 'sniper' && dist > 10) inp.scope = !a.scoped && (state.tick & 1) === 0;

  if (b.react > 0 || !w || w.mag === 0) return;
  const errYaw = Math.abs(wrapAngle(wantYaw - a.yaw));
  const tol = Math.max(0.025, Math.atan2(0.42, dist)) + 0.01;
  const steady = Math.hypot(a.vel.x, a.vel.z) < 2.2 || dist < 9;
  if (errYaw < tol && b.shooting && steady && !friendlyInLine(state, a, t)) {
    inp.fire = w.def.auto ? true : !inp.firePrev;
  }
  // Throw a frag at someone holding still behind cover, occasionally.
  if (b.nadeCooldown <= 0 && a.frag > 0 && dist > 9 && dist < 26 && state.rng.chance(0.01)) {
    lob(state, a, 'frag', t.pos.x, t.pos.z);
    b.nadeCooldown = 8;
  }
  b.nadeCooldown -= dt;
}

// True when a living teammate stands within a body-width of the line to the target.
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

function objective(state, a, b, dt) {
  const inp = a.input;
  const now = state.time;
  b.nadeCooldown -= dt;
  const bomb = state.bomb;
  b.watchX = NaN; b.watchZ = NaN; // followRoute may set these when the squad reaches the site
  let watchX = NaN, watchZ = NaN;

  // Recently saw someone: hunt toward it (attackers and roamers), or hold the angle (anchors).
  const recentSight = now - b.lastTime < 5;
  const recentNoise = now - b.heardTime < 3.5;

  if (a.team === 'att') {
    if (bomb.state === 'planted') {
      const spots = POSTPLANT[bomb.site];
      const s = spots[b.post % spots.length];
      setGoal(b, cellCenter(s.cell[0]), cellCenter(s.cell[1]));
      watchX = cellCenter(s.watch[0]); watchZ = cellCenter(s.watch[1]);
      inp.walk = true;
    } else if (bomb.carrier === a) {
      carrierLogic(state, a, b);
    } else if (bomb.state === 'dropped' && closestTo(state, 'att', bomb.x, bomb.z) === a) {
      setGoal(b, bomb.x, bomb.z);
    } else if (recentSight) {
      setGoal(b, b.lastX, b.lastZ);
      watchX = b.lastX; watchZ = b.lastZ;
      inp.walk = Math.hypot(a.pos.x - b.lastX, a.pos.z - b.lastZ) < 12;
    } else {
      followRoute(state, a, b);
    }
  } else {
    if (bomb.state === 'planted') {
      const defuser = closestTo(state, 'def', bomb.x, bomb.z);
      const d = Math.hypot(a.pos.x - bomb.x, a.pos.z - bomb.z);
      if (defuser === a) {
        setGoal(b, bomb.x, bomb.z);
        if (d < 1.1) { inp.use = true; inp.crouch = true; b.hasGoal = false; }
      } else {
        setGoal(b, bomb.x + Math.sin(b.post * 2.1) * 4, bomb.z + Math.cos(b.post * 2.1) * 4);
        watchX = bomb.x; watchZ = bomb.z;
      }
    } else if (recentSight && b.post % 2 === 0) {
      setGoal(b, b.lastX, b.lastZ);
      watchX = b.lastX; watchZ = b.lastZ;
      inp.walk = true;
    } else {
      maybeRotate(state, a, b);
      const h = b.hold;
      setGoal(b, cellCenter(h.cell[0]), cellCenter(h.cell[1]));
      watchX = cellCenter(h.watch[0]); watchZ = cellCenter(h.watch[1]);
      if (Math.hypot(a.pos.x - b.goalX, a.pos.z - b.goalZ) < 1.2) {
        b.hasGoal = false;
        b.sweep += dt;
        inp.crouch = b.crouchPref && state.rng.next() < 0.995;
      }
    }
  }

  if (Number.isNaN(watchX)) { watchX = b.watchX; watchZ = b.watchZ; }
  if (recentSight && Number.isNaN(watchX)) { watchX = b.lastX; watchZ = b.lastZ; }
  if (recentNoise && (Number.isNaN(watchX) || now - b.heardTime < 1.5)) { watchX = b.heardX; watchZ = b.heardZ; }
  b.watchX = watchX; b.watchZ = watchZ;
}

function carrierLogic(state, a, b) {
  const plan = state.plan;
  const spot = PLANT_SPOTS[plan.site][b.post % 2];
  const px = cellCenter(spot[0]), pz = cellCenter(spot[1]);
  if (!plan.executing) { followRoute(state, a, b); return; }
  setGoal(b, px, pz);
  if (Math.hypot(a.pos.x - px, a.pos.z - pz) < 1.0) {
    b.hasGoal = false;
    a.input.use = true;
    a.input.crouch = true;
    if (a.using === 0 && state.time - b.lastCall > 3) {
      b.lastCall = state.time;
      pushLine(state.radio, { time: state.time, team: a.team, name: a.name, text: `Planting at ${plan.site}, cover me` }, 4);
    }
  }
}

function followRoute(state, a, b) {
  const plan = state.plan;
  const route = b.route ?? ROUTES[plan.site][0];
  const pts = route.points;
  const stage = pts.length - 2;
  const elapsed = state.match.roundClock;
  if (!plan.executing && (elapsed > plan.executeAt || (state.intel.att.time > state.time - 2 && elapsed > 8))) {
    plan.executing = true;
    pushLine(state.radio, { time: state.time, team: 'att', name: a.name, text: `Go go, hit ${plan.site}!` }, 4);
  }
  const limit = plan.executing ? pts.length - 1 : stage;
  let wp = Math.min(b.waypoint, limit);
  const tx = cellCenter(pts[wp][0]), tz = cellCenter(pts[wp][1]);
  if (Math.hypot(a.pos.x - tx, a.pos.z - tz) < 1.6 && wp < limit) { b.waypoint = ++wp; }
  // Smoke the site's crossfire on the way in.
  if (plan.executing && !b.smokeDone && a.smoke > 0 && wp >= stage && route.smoke) {
    lob(state, a, 'smoke', cellCenter(route.smoke[0]), cellCenter(route.smoke[1]));
    b.smokeDone = true;
  }
  if (wp === pts.length - 1 && Math.hypot(a.pos.x - tx, a.pos.z - tz) < 3) {
    // On site: spread to post-plant cover and guard the carrier.
    const spots = POSTPLANT[plan.site];
    const s = spots[b.post % spots.length];
    setGoal(b, cellCenter(s.cell[0]), cellCenter(s.cell[1]));
    b.watchX = cellCenter(s.watch[0]); b.watchZ = cellCenter(s.watch[1]);
    return;
  }
  setGoal(b, cellCenter(pts[wp][0]), cellCenter(pts[wp][1]));
  a.input.walk = !plan.executing && wp === stage && Math.hypot(a.pos.x - tx, a.pos.z - tz) < 8;
}

function maybeRotate(state, a, b) {
  const intel = state.intel.def;
  if (state.time - intel.time > 1.5) return;
  const site = SITE_OF_ROOM[intel.room];
  if (!site || b.hold.site === site || b.hold.site === 'mid' && b.post % 2) return;
  if ((a.id + Math.floor(state.time / 4)) % 3 !== 0) return;
  const options = HOLDS.filter((h) => h.site === site);
  b.hold = options[a.id % options.length];
  pushLine(state.radio, { time: state.time, team: 'def', name: a.name, text: `Rotating to ${site}` }, 4);
}

function closestTo(state, team, x, z) {
  let best = null, bd = Infinity;
  for (const o of state.actors) {
    if (!o.alive || o.team !== team || (!o.brain && !state.settings.autoplay)) continue;
    const d = Math.hypot(o.pos.x - x, o.pos.z - z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// Looks for a nearby walkable cell the threat cannot see.
function findCover(state, a, b, threat) {
  const tx = threat.pos.x, ty = threat.pos.y + 1.5, tz = threat.pos.z;
  const cx = cellOf(a.pos.x), cz = cellOf(a.pos.z);
  let best = Infinity, bx = 0, bz = 0;
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    const x = cx + dx, z = cz + dz;
    if (!isWalkable(x, z)) continue;
    const wx = cellCenter(x), wz = cellCenter(z);
    if (clearLine(state.map, tx, ty, tz, wx, 1.0, wz)) continue;
    const toward = Math.hypot(wx - tx, wz - tz) < Math.hypot(a.pos.x - tx, a.pos.z - tz) ? 3 : 0;
    const score = Math.hypot(wx - a.pos.x, wz - a.pos.z) + toward;
    if (score < best) { best = score; bx = wx; bz = wz; }
  }
  if (best === Infinity) return false;
  b.coverX = bx; b.coverZ = bz;
  return true;
}

// Throws a grenade on an arc that lands near (x, z).
function lob(state, a, type, x, z) {
  const sx = a.pos.x, sz = a.pos.z;
  const d = Math.hypot(x - sx, z - sz);
  if (d < 2) return;
  const ang = 0.7;
  const g = 20;
  const speed = Math.min(19, Math.sqrt((g * d) / Math.sin(2 * ang)) * 0.92);
  const h = Math.cos(ang) * speed, v = Math.sin(ang) * speed;
  a.yaw = yawTo(x - sx, z - sz);
  throwGrenade(state, a, type, ((x - sx) / d) * h, v, ((z - sz) / d) * h);
  if (type === 'smoke') state.plan.smokesThrown++;
}

function setGoal(b, x, z) {
  const cell = cellOf(z) * 64 + cellOf(x);
  if (!b.hasGoal || cell !== b.goalCell) { b.repath = 0; b.goalCell = cell; }
  b.goalX = x; b.goalZ = z; b.hasGoal = true;
}

function turnToward(a, yaw, pitch, rate, dt) {
  const dy = wrapAngle(yaw - a.yaw);
  const max = rate * dt;
  a.yaw = wrapAngle(a.yaw + clamp(dy, -max, max));
  a.pitch += clamp(pitch - a.pitch, -max, max);
  a.pitch = clamp(a.pitch, -1.2, 1.2);
}

function steer(state, a, b, dt) {
  const inp = a.input;
  let mx = 0, mz = 0;
  if (b.hasGoal) {
    b.repath -= dt;
    if (b.repath <= 0 || b.pathIdx >= b.pathLen) {
      b.pathLen = findPath(cellOf(a.pos.x), cellOf(a.pos.z), cellOf(b.goalX), cellOf(b.goalZ), b.path);
      b.pathIdx = 0;
      b.repath = 1.5 + state.rng.next();
    }
    // Skip ahead along the path while the straight line is open at knee and shoulder width.
    let tx = b.goalX, tz = b.goalZ;
    if (b.pathIdx < b.pathLen) {
      while (b.pathIdx < b.pathLen - 1 && openWalk(state, a, b.path[b.pathIdx + 1])) b.pathIdx++;
      const c = b.path[b.pathIdx];
      if (b.pathIdx < b.pathLen - 1) { tx = cellX(c); tz = cellZ(c); }
      if (Math.hypot(a.pos.x - cellX(c), a.pos.z - cellZ(c)) < 0.7 && b.pathIdx < b.pathLen - 1) b.pathIdx++;
    }
    const dx = tx - a.pos.x, dz = tz - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.25) { mx = dx / d; mz = dz / d; }
    if (d < 2.5) inp.walk = true;
    // Stuck on a corner or a teammate: hop sideways.
    b.stuckT += dt;
    if (b.stuckT > 1.2) {
      if (Math.hypot(a.pos.x - b.stuckX, a.pos.z - b.stuckZ) < 0.4 && d > 1) { b.repath = 0; inp.jump = true; mx += -mz * 0.8; mz += mx * 0.8; }
      b.stuckT = 0; b.stuckX = a.pos.x; b.stuckZ = a.pos.z;
    }
  }
  if (mx || mz) {
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    const rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
    inp.fwd = mx * fx + mz * fz;
    inp.side = mx * rx + mz * rz;
  }
  // Look where it matters: the target, a watched angle, a noise, or simply ahead.
  if (b.target && b.target.alive && state.time - b.targetSeen < 0.4) return;
  let lookYaw = a.yaw;
  if (!Number.isNaN(b.watchX) && b.watchX !== undefined) lookYaw = yawTo(b.watchX - a.pos.x, b.watchZ - a.pos.z) + Math.sin(b.sweep * 0.9) * 0.25;
  else if (mx || mz) lookYaw = yawTo(mx, mz);
  turnToward(a, lookYaw, 0, 5, dt);
}

function openWalk(state, a, cell) {
  const x = cellX(cell), z = cellZ(cell);
  const dx = x - a.pos.x, dz = z - a.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const ox = (-dz / d) * 0.4, oz = (dx / d) * 0.4;
  const y = a.pos.y + 0.55;
  return clearLine(state.map, a.pos.x + ox, y, a.pos.z + oz, x + ox, y, z + oz)
    && clearLine(state.map, a.pos.x - ox, y, a.pos.z - oz, x - ox, y, z - oz);
}
