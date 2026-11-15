// Where bots go and what they hold. Attackers split over two named routes to the round's site,
// stage outside it, and execute together on a timer or on first contact: smoke the crossfire, flash
// the site, plant, then spread to post-plant cover. Defenders each hold a position watching one way
// in, rotate when their squad calls contact at the other site, and retake a planted Igniter: the
// nearest defuses while the rest flash and smoke for them. Every move is an A* path over the map's
// grid (nav.js), followed by steering with the same input a player has. All of it is called on the
// radio, so the player hears the plan.

import { radio } from './state.js';
import { cellOf, cellCenter, HOLDS, ROUTES, POSTPLANT, PLANT_SPOTS } from './map-kilnworks.js';
import { clearLine } from './movement-collision.js';
import { yawTo, turnToward } from './mouselook.js';
import { throwGrenade } from './grenades-smoke-flash.js';
import { findPath, cellX, cellZ, isWalkable } from './nav.js';

const SITE_OF_ROOM = {
  'Kiln Hall': 'A', 'A Site': 'A', 'Short A': 'A', 'Long Gallery': 'A', 'Upper Walk A': 'A', 'Clay Pits': 'A',
  'Silo Court': 'B', 'B Site': 'B', 'Short B': 'B', 'Culverts': 'B', 'Upper Walk B': 'B', 'Drain Run': 'B',
};

// Called at the start of every round: picks the site and the execute time, deals routes to the
// attackers and holds to the defenders.
export function planRound(state) {
  const rng = state.rng;
  const plan = state.plan;
  plan.site = rng.chance(0.5) ? 'A' : 'B';
  plan.executeAt = 16 + rng.range(0, 14);
  plan.executing = false;
  let route = rng.int(2), hold = rng.int(HOLDS.length), post = 0;
  for (const a of state.actors) {
    const b = a.brain;
    if (!b) continue;
    b.target = null; b.lastTime = -99; b.heardTime = -99; b.hasGoal = false; b.pathLen = 0;
    b.cover = false; b.hurtBy = null; b.smokeDone = b.flashDone = b.called = false; b.nadeCooldown = 3 + rng.next() * 4;
    b.noiseCursor = state.noiseCount;
    b.thinkPhase = rng.int(6);
    b.crouchPref = rng.chance(0.35);
    b.post = post++;
    b.waypoint = 0;
    if (a.team === 'att') b.route = ROUTES[plan.site][route++ % 2];
    else b.hold = HOLDS[hold++ % HOLDS.length];
  }
}

// A bot with no enemy in sight: sets its goal, the angle it watches, and whether it plants or defuses.
export function objective(state, a, b, dt) {
  b.nadeCooldown -= dt;
  b.watchX = NaN; b.watchZ = NaN;
  b.lookDown = false;
  if (a.team === 'att') attack(state, a, b);
  else defend(state, a, b, dt);
  // With nothing assigned to watch, face where an enemy was last seen; a fresh noise overrides both.
  const now = state.time;
  if (now - b.lastTime < 5 && Number.isNaN(b.watchX)) watch(b, b.lastX, b.lastZ);
  if (now - b.heardTime < 3.5 && (Number.isNaN(b.watchX) || now - b.heardTime < 1.5)) watch(b, b.heardX, b.heardZ);
}

function watch(b, x, z) {
  b.watchX = x; b.watchZ = z;
}

function attack(state, a, b) {
  const bomb = state.bomb, inp = a.input;
  if (bomb.state === 'planted') {
    // Post-plant: spread to cover around the site and watch the ways in.
    const s = POSTPLANT[bomb.site][b.post % POSTPLANT[bomb.site].length];
    setGoal(b, cellCenter(s.cell[0]), cellCenter(s.cell[1]));
    watch(b, cellCenter(s.watch[0]), cellCenter(s.watch[1]));
    inp.walk = true;
  } else if (bomb.carrier === a) carry(state, a, b);
  else if (bomb.state === 'dropped' && closestBot(state, 'att', bomb.x, bomb.z) === a) setGoal(b, bomb.x, bomb.z);
  else if (state.time - b.lastTime < 5) {
    // Lost sight of someone: close on where they were, quietly once near.
    setGoal(b, b.lastX, b.lastZ);
    watch(b, b.lastX, b.lastZ);
    inp.walk = Math.hypot(a.pos.x - b.lastX, a.pos.z - b.lastZ) < 12;
  } else followRoute(state, a, b);
}

// The carrier follows its route like the rest, then goes to a plant spot and holds use.
function carry(state, a, b) {
  const plan = state.plan;
  if (!plan.executing) { followRoute(state, a, b); return; }
  const spot = PLANT_SPOTS[plan.site][b.post % 2];
  const px = cellCenter(spot[0]), pz = cellCenter(spot[1]);
  setGoal(b, px, pz);
  if (Math.hypot(a.pos.x - px, a.pos.z - pz) > 1) return;
  b.hasGoal = false;
  a.input.use = true;
  a.input.crouch = true;
  if (a.using === 0 && state.time - b.lastCall > 3) {
    b.lastCall = state.time;
    radio(state, a, `Planting at ${plan.site}, cover me`);
  }
}

// Waypoints end at a plant spot; the second-last is the staging point where the squad waits.
function followRoute(state, a, b) {
  const plan = state.plan, route = b.route, pts = route.points;
  const stage = pts.length - 2;
  const elapsed = state.match.roundClock;
  if (!b.called) { b.called = true; radio(state, a, `Taking ${route.name} to ${plan.site}`); }
  // Execute on the timer, or early once someone has made contact.
  if (!plan.executing && (elapsed > plan.executeAt || (state.intel.att.time > state.time - 2 && elapsed > 8))) {
    plan.executing = true;
    radio(state, a, `Go go, hit ${plan.site}!`);
  }
  const limit = plan.executing ? pts.length - 1 : stage;
  let wp = Math.min(b.waypoint, limit);
  const tx = cellCenter(pts[wp][0]), tz = cellCenter(pts[wp][1]);
  const near = Math.hypot(a.pos.x - tx, a.pos.z - tz);
  if (near < 1.6 && wp < limit) b.waypoint = ++wp;
  // On the execute: smoke the site's crossfire from the staging point, then flash the site itself.
  if (plan.executing && wp >= stage) {
    const site = pts[pts.length - 1];
    if (!b.smokeDone && a.smoke > 0) {
      b.smokeDone = true;
      lob(state, a, 'smoke', cellCenter(route.smoke[0]), cellCenter(route.smoke[1]));
      radio(state, a, `Smoke out, ${plan.site}`);
    } else if (!b.flashDone && a.flash > 0 && Math.hypot(a.pos.x - cellCenter(site[0]), a.pos.z - cellCenter(site[1])) < 20) {
      b.flashDone = true;
      lob(state, a, 'flash', cellCenter(site[0]), cellCenter(site[1]));
    }
  }
  if (wp === pts.length - 1 && near < 3) {
    // On site: spread to post-plant cover and guard the carrier.
    const s = POSTPLANT[plan.site][b.post % POSTPLANT[plan.site].length];
    setGoal(b, cellCenter(s.cell[0]), cellCenter(s.cell[1]));
    watch(b, cellCenter(s.watch[0]), cellCenter(s.watch[1]));
    return;
  }
  setGoal(b, cellCenter(pts[wp][0]), cellCenter(pts[wp][1]));
  a.input.walk = !plan.executing && wp === stage && near < 8;
}

function defend(state, a, b, dt) {
  const inp = a.input;
  if (state.bomb.state === 'planted') { retake(state, a, b); return; }
  if (state.time - b.lastTime < 5 && b.post % 2 === 0) {
    // Roamers push the last place they saw an attacker; anchors stay on their angle.
    setGoal(b, b.lastX, b.lastZ);
    watch(b, b.lastX, b.lastZ);
    inp.walk = true;
    return;
  }
  rotate(state, a, b);
  const h = b.hold;
  setGoal(b, cellCenter(h.cell[0]), cellCenter(h.cell[1]));
  watch(b, cellCenter(h.watch[0]), cellCenter(h.watch[1]));
  if (Math.hypot(a.pos.x - b.goalX, a.pos.z - b.goalZ) > 1.2) return;
  // In position: stop, settle behind the angle and sweep it.
  b.hasGoal = false;
  b.sweep += dt;
  inp.crouch = b.crouchPref;
  if (!b.called) { b.called = true; radio(state, a, `Holding ${h.name}`); }
  // When the squad calls contact on this side, smoke the way in to slow the push.
  const intel = state.intel.def;
  if (!b.smokeDone && a.smoke > 0 && state.time - intel.time < 2 && SITE_OF_ROOM[intel.room] === h.site) {
    b.smokeDone = true;
    lob(state, a, 'smoke', b.watchX, b.watchZ);
    radio(state, a, `Smoking ${h.name}`);
  }
}

// A defender leaves its hold for the other site when the squad's intel puts the attack there.
function rotate(state, a, b) {
  const intel = state.intel.def;
  if (state.time - intel.time > 1.5) return;
  const site = SITE_OF_ROOM[intel.room];
  if (!site || b.hold.site === site || (b.hold.site === 'mid' && b.post % 2)) return;
  if ((a.id + Math.floor(state.time / 4)) % 3 !== 0) return;
  let n = a.id;
  do { b.hold = HOLDS[n++ % HOLDS.length]; } while (b.hold.site !== site);
  b.called = true;
  radio(state, a, `Rotating to ${site}`);
}

// The Igniter is down: the nearest defender defuses, kneeling over it; the rest ring the site, flash
// it from outside and smoke the charge to cover the defuse.
function retake(state, a, b) {
  const bomb = state.bomb, inp = a.input;
  const d = Math.hypot(a.pos.x - bomb.x, a.pos.z - bomb.z);
  watch(b, bomb.x, bomb.z);
  if (closestBot(state, 'def', bomb.x, bomb.z) === a) {
    setGoal(b, bomb.x, bomb.z);
    if (d > 1.1) return;
    b.hasGoal = false;
    b.lookDown = true;
    inp.use = true;
    inp.crouch = true;
    if (a.using === 0 && state.time - b.lastCall > 3) { b.lastCall = state.time; radio(state, a, 'Defusing, cover me'); }
    return;
  }
  setGoal(b, bomb.x + Math.sin(b.post * 2.1) * 4, bomb.z + Math.cos(b.post * 2.1) * 4);
  if (!b.flashDone && a.flash > 0 && d > 8 && d < 22) {
    b.flashDone = true;
    lob(state, a, 'flash', bomb.x, bomb.z);
  } else if (!b.smokeDone && a.smoke > 0 && d > 5 && d < 16) {
    b.smokeDone = true;
    lob(state, a, 'smoke', bomb.x, bomb.z);
    radio(state, a, 'Smoking the Igniter, defuse it');
  }
}

function closestBot(state, team, x, z) {
  let best = null, bd = Infinity;
  for (const o of state.actors) {
    if (!o.alive || o.team !== team || !o.brain) continue;
    const d = Math.hypot(o.pos.x - x, o.pos.z - z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// Throws a grenade on a 40 degree arc that lands near (x, z).
export function lob(state, a, type, x, z) {
  const sx = a.pos.x, sz = a.pos.z;
  const d = Math.hypot(x - sx, z - sz);
  if (d < 2) return;
  const ang = 0.7;
  const speed = Math.min(19, Math.sqrt((20 * d) / Math.sin(2 * ang)) * 0.92);
  const h = Math.cos(ang) * speed, v = Math.sin(ang) * speed;
  a.yaw = yawTo(x - sx, z - sz);
  throwGrenade(state, a, type, ((x - sx) / d) * h, v, ((z - sz) / d) * h);
}

// Looks for the nearest walkable cell the threat cannot see, for a bot that must reload or is hurt.
export function findCover(state, a, b, threat) {
  const tx = threat.pos.x, ty = threat.pos.y + 1.5, tz = threat.pos.z;
  const cx = cellOf(a.pos.x), cz = cellOf(a.pos.z);
  const mine = Math.hypot(a.pos.x - tx, a.pos.z - tz);
  let best = Infinity;
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    if (!isWalkable(cx + dx, cz + dz)) continue;
    const wx = cellCenter(cx + dx), wz = cellCenter(cz + dz);
    if (clearLine(state.map, tx, ty, tz, wx, 1.0, wz)) continue;
    // Prefer cover that does not mean running toward the threat.
    const score = Math.hypot(wx - a.pos.x, wz - a.pos.z) + (Math.hypot(wx - tx, wz - tz) < mine ? 3 : 0);
    if (score < best) { best = score; b.coverX = wx; b.coverZ = wz; }
  }
  return best < Infinity;
}

export function setGoal(b, x, z) {
  const cell = cellOf(z) * 64 + cellOf(x);
  if (!b.hasGoal || cell !== b.goalCell) { b.repath = 0; b.goalCell = cell; }
  b.goalX = x; b.goalZ = z; b.hasGoal = true;
}

// Follows the A* path to the goal by writing movement input, and turns the view to what matters.
export function steer(state, a, b, dt) {
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
    // Stuck on a corner or a squadmate: hop sideways and plan again.
    b.stuckT += dt;
    if (b.stuckT > 1.2) {
      if (Math.hypot(a.pos.x - b.stuckX, a.pos.z - b.stuckZ) < 0.4 && d > 1) { b.repath = 0; inp.jump = true; mx += -mz * 0.8; mz += mx * 0.8; }
      b.stuckT = 0; b.stuckX = a.pos.x; b.stuckZ = a.pos.z;
    }
  }
  if (mx || mz) {
    // World direction to forward/strafe input relative to where the bot faces.
    inp.fwd = -mx * Math.sin(a.yaw) - mz * Math.cos(a.yaw);
    inp.side = mx * Math.cos(a.yaw) - mz * Math.sin(a.yaw);
  }
  // Look where it matters: the target (aimed in bots.js), a watched angle, a noise, or simply ahead.
  if (b.target && b.target.alive && state.time - b.targetSeen < 0.4) return;
  let lookYaw = a.yaw;
  if (!Number.isNaN(b.watchX)) lookYaw = yawTo(b.watchX - a.pos.x, b.watchZ - a.pos.z) + Math.sin(b.sweep * 0.9) * 0.25;
  else if (mx || mz) lookYaw = yawTo(mx, mz);
  turnToward(a, lookYaw, b.lookDown ? -0.85 : 0, 5, dt);
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
