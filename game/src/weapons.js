// Gunplay: hitscan bullets against the grid and against per-actor head, body and leg volumes,
// spread that punishes moving, jumping and spraying, and view punch the camera shows so the
// crosshair is always where the next bullet goes.

import { BODY } from './config.js';
import { raycast, rayBox, raySphere, makeHit } from './physics.js';
import { heldWeapon, eyeHeight, bodyHeight, applyDamage, switchTo, cycleNade } from './actors.js';
import { emit, makeNoise } from './state.js';
import { throwGrenade } from './grenades.js';
import { clamp, dirFromAngles } from './util.js';

const worldHit = makeHit();
const dir = { x: 0, y: 0, z: 0 };

// Cone half-angle (radians) the next shot can stray by.
export function spreadOf(a) {
  const w = heldWeapon(a);
  if (!w) return 0.02;
  const d = w.def;
  const hs = Math.hypot(a.vel.x, a.vel.z);
  const moveFrac = clamp((hs - 1.1) / (BODY.runSpeed * d.speed - 1.1), 0, 1);
  let s = d.kind === 'sniper' && !a.scoped ? d.unscoped : d.spread;
  s += d.moveSpread * moveFrac;
  if (!a.grounded) s += d.airSpread;
  s += d.sprayGrow * Math.min(a.shots, 14);
  if (a.crouch > 0.5) s *= 0.72;
  return s;
}

export function startReload(a) {
  const w = heldWeapon(a);
  if (!w || a.reloading > 0 || w.mag >= w.def.mag || w.reserve <= 0) return false;
  a.reloading = w.def.reload;
  a.scoped = false;
  return true;
}

function finishReload(a) {
  const w = heldWeapon(a);
  if (!w) return;
  const take = Math.min(w.def.mag - w.mag, w.reserve);
  w.mag += take;
  w.reserve -= take;
}

export function updateWeapon(state, a, dt) {
  if (!a.alive) return;
  const inp = a.input;
  if (inp.slot) {
    if (inp.slot === 'nade' && a.current === 'nade') cycleNade(a);
    else {
      if (inp.slot === 'nade' && a[a.nadeType] === 0) cycleNade(a);
      switchTo(a, inp.slot);
    }
    inp.slot = '';
  }
  a.cooldown -= dt;
  if (a.switching > 0) a.switching -= dt;

  // View punch recovers once the trigger is let go; spray count decays between bursts.
  const w = heldWeapon(a);
  const recover = w ? w.def.recover : 8;
  if (state.time - a.lastShot > 0.09) {
    const k = Math.exp(-recover * dt);
    a.punchPitch *= k;
    a.punchYaw *= k;
  }
  if (state.time - a.lastShot > 0.28) a.shots = Math.max(0, a.shots - dt * 18);

  if (a.reloading > 0) {
    a.reloading -= dt;
    if (a.reloading <= 0) { a.reloading = 0; finishReload(a); emit(state, 'reloaded', a.pos.x, a.pos.y, a.pos.z).actor = a; }
  }
  const pressed = inp.fire && !inp.firePrev;
  inp.firePrev = inp.fire;
  const scopePressed = inp.scope && !inp.scopePrev;
  inp.scopePrev = inp.scope;
  if (state.match.phase === 'freeze' || a.using > 0) return;

  if (a.current === 'nade') {
    if (pressed && a.switching <= 0 && a[a.nadeType] > 0) {
      dirFromAngles(a.yaw, a.pitch + 0.12, dir);
      const speed = inp.walk ? 9 : 16;
      throwGrenade(state, a, a.nadeType, dir.x * speed + a.vel.x * 0.5, dir.y * speed + 1.5, dir.z * speed + a.vel.z * 0.5);
      if (a[a.nadeType] === 0) cycleNade(a);
      if (a.frag + a.smoke + a.flash === 0) switchTo(a, a.lastSlot === 'nade' ? 'secondary' : a.lastSlot);
      a.cooldown = 0.6;
    }
    return;
  }
  if (!w) return;
  if (scopePressed && w.def.kind === 'sniper' && a.reloading <= 0) {
    a.scoped = !a.scoped;
    emit(state, 'scope', a.pos.x, a.pos.y, a.pos.z).actor = a;
  }
  if (inp.reload) { if (startReload(a)) emit(state, 'reload', a.pos.x, a.pos.y, a.pos.z).actor = a; inp.reload = false; }
  if (!inp.fire || a.cooldown > 0 || a.switching > 0 || a.reloading > 0) return;
  if (!w.def.auto && !pressed) return;
  if (w.mag <= 0) {
    if (pressed) emit(state, 'dry', a.pos.x, a.pos.y, a.pos.z).actor = a;
    if (startReload(a)) emit(state, 'reload', a.pos.x, a.pos.y, a.pos.z).actor = a;
    a.cooldown = 0.25;
    return;
  }
  fire(state, a, w);
}

function fire(state, a, w) {
  const d = w.def;
  w.mag--;
  a.cooldown = 60 / d.rpm;
  const spread = spreadOf(a);
  const ox = a.pos.x, oy = a.pos.y + eyeHeight(a), oz = a.pos.z;
  const rng = state.rng;
  for (let p = 0; p < d.pellets; p++) {
    const ang = rng.next() * Math.PI * 2;
    const rad = spread * Math.sqrt(rng.next());
    const pitch = a.pitch + a.punchPitch + Math.sin(ang) * rad;
    const yaw = a.yaw + a.punchYaw + (Math.cos(ang) * rad) / Math.max(0.3, Math.cos(pitch));
    dirFromAngles(yaw, pitch, dir);
    traceBullet(state, a, ox, oy, oz, dir.x, dir.y, dir.z, d, p === 0);
  }
  // Recoil: a climbing kick plus a side-to-side drift that a player learns to pull against.
  const n = a.shots;
  a.punchPitch = Math.min(0.32, a.punchPitch + d.kick * (1 + Math.min(n, 8) * 0.07));
  const drift = n < 3 ? 0.2 : Math.sin(n * 0.55) * 1.4;
  a.punchYaw = clamp(a.punchYaw + d.kickYaw * drift, -0.12, 0.12);
  a.shots++;
  a.lastShot = state.time;
  if (d.kind === 'sniper') a.scoped = false;
  const e = emit(state, 'shot', ox, oy, oz);
  e.actor = a; e.text = d.sound;
  makeNoise(state, a, ox, oz, d.kind === 'sniper' ? 70 : 52);
}

function traceBullet(state, shooter, ox, oy, oz, dx, dy, dz, def, tracer) {
  const maxT = 160;
  let bestT = raycast(state.map, ox, oy, oz, dx, dy, dz, maxT, worldHit);
  let victim = null, zone = 'body';
  const actors = state.actors;
  for (let i = 0; i < actors.length; i++) {
    const v = actors[i];
    if (!v.alive || v === shooter) continue;
    // Cheap reject: the ray must pass within 1.3 m of the actor's centre line.
    const cx = v.pos.x - ox, cz = v.pos.z - oz;
    const along = cx * dx + cz * dz;
    if (along < 0) continue;
    const hl = Math.hypot(dx, dz) || 1e-6;
    const perp = Math.abs(cx * dz - cz * dx) / hl;
    if (perp > 1.3) continue;
    const top = v.pos.y + bodyHeight(v);
    const th = raySphere(ox, oy, oz, dx, dy, dz, v.pos.x, top - BODY.headRadius, v.pos.z, BODY.headRadius);
    if (th < bestT) { bestT = th; victim = v; zone = 'head'; }
    const tb = rayBox(ox, oy, oz, dx, dy, dz, v.pos.x - 0.27, v.pos.y, v.pos.z - 0.27, v.pos.x + 0.27, top - BODY.headRadius * 1.8, v.pos.z + 0.27);
    if (tb < bestT) {
      bestT = tb;
      victim = v;
      zone = oy + dy * tb < v.pos.y + 0.82 ? 'legs' : 'body';
    }
  }
  const end = Math.min(bestT, maxT);
  if (tracer) {
    const e = emit(state, 'tracer', ox, oy, oz);
    e.a = ox + dx * end; e.b = oy + dy * end; e.c = oz + dz * end; e.actor = shooter;
  }
  if (victim) {
    const mult = zone === 'head' ? def.headMult : zone === 'legs' ? 0.75 : 1;
    const dmg = def.dmg * mult * Math.pow(def.falloff, end / 25);
    applyDamage(state, victim, shooter, dmg, zone, def.pen, def.id);
    const e = emit(state, 'blood', ox + dx * end, oy + dy * end, oz + dz * end);
    e.a = dx; e.b = dy; e.c = dz; e.text = zone; e.actor = shooter;
  } else if (worldHit.t < maxT) {
    const e = emit(state, 'impact', worldHit.x, worldHit.y, worldHit.z);
    e.a = worldHit.nx; e.b = worldHit.ny; e.c = worldHit.nz;
  }
}
