// Weapons: six guns that fire, reload and run dry. A magazine empties, a reload takes its time and
// draws from a finite reserve, switching weapons has a draw delay, and an empty gun only clicks.
// Where a round goes is decided by recoil-spread.js; what it hits by headshot-hitboxes.js.

import { emit, makeNoise, heldWeapon } from './state.js';
import { eyeHeight } from './movement-collision.js';
import { dirFromAngles } from './mouselook.js';
import { spreadOf, kick, settle } from './recoil-spread.js';
import { traceBullet } from './headshot-hitboxes.js';
import { throwGrenade } from './grenades-smoke-flash.js';

// Spread and recoil are radians. moveSpread is added in full at run speed, airSpread in the air,
// sprayGrow per shot of a spray. `pen` is the share of damage that gets past armour; from 0.55 up a
// round also punches through soft cover. `speed` scales how fast you run with the gun out.
export const WEAPONS = { // pistol, heavy pistol, SMG, pump shotgun, assault rifle, scoped sniper rifle
  pike: {
    id: 'pike', name: 'Pike-9', slot: 'secondary', kind: 'pistol', price: 0,
    dmg: 30, rpm: 400, auto: false, mag: 12, reserve: 48, reload: 2.1, falloff: 0.82, pen: 0.5, headMult: 4,
    spread: 0.006, moveSpread: 0.04, airSpread: 0.16, kick: 0.028, kickYaw: 0.006, sprayGrow: 0.008, recover: 9,
    speed: 1.0, pellets: 1, sound: 'pistol', reward: 300,
  },
  marten: {
    id: 'marten', name: 'Marten .45', slot: 'secondary', kind: 'pistol', price: 650,
    dmg: 52, rpm: 230, auto: false, mag: 7, reserve: 35, reload: 2.3, falloff: 0.78, pen: 0.85, headMult: 4,
    spread: 0.005, moveSpread: 0.06, airSpread: 0.2, kick: 0.05, kickYaw: 0.01, sprayGrow: 0.016, recover: 6,
    speed: 0.98, pellets: 1, sound: 'heavy', reward: 300,
  },
  wren: {
    id: 'wren', name: 'Wren SMG', slot: 'primary', kind: 'smg', price: 1250,
    dmg: 24, rpm: 820, auto: true, mag: 30, reserve: 120, reload: 2.3, falloff: 0.7, pen: 0.6, headMult: 3.6,
    spread: 0.009, moveSpread: 0.028, airSpread: 0.12, kick: 0.011, kickYaw: 0.006, sprayGrow: 0.0025, recover: 8,
    speed: 0.96, pellets: 1, sound: 'smg', reward: 600,
  },
  brush: {
    id: 'brush', name: 'Brushcutter', slot: 'primary', kind: 'shotgun', price: 1100,
    dmg: 17, rpm: 72, auto: false, mag: 6, reserve: 32, reload: 2.7, falloff: 0.45, pen: 0.5, headMult: 2.5,
    spread: 0.06, moveSpread: 0.015, airSpread: 0.1, kick: 0.08, kickYaw: 0.01, sprayGrow: 0, recover: 6,
    speed: 0.92, pellets: 9, sound: 'shotgun', reward: 900,
  },
  kestrel: {
    id: 'kestrel', name: 'Kestrel AR', slot: 'primary', kind: 'rifle', price: 2900,
    dmg: 35, rpm: 600, auto: true, mag: 30, reserve: 90, reload: 2.5, falloff: 0.97, pen: 0.78, headMult: 4,
    spread: 0.0035, moveSpread: 0.1, airSpread: 0.22, kick: 0.017, kickYaw: 0.009, sprayGrow: 0.0035, recover: 7,
    speed: 0.86, pellets: 1, sound: 'rifle', reward: 300,
  },
  longreach: {
    id: 'longreach', name: 'Longreach', slot: 'primary', kind: 'sniper', price: 4500,
    dmg: 118, rpm: 42, auto: false, mag: 5, reserve: 20, reload: 3.4, falloff: 0.99, pen: 0.97, headMult: 3,
    spread: 0.0012, moveSpread: 0.16, airSpread: 0.3, kick: 0.06, kickYaw: 0.004, sprayGrow: 0, recover: 4,
    unscoped: 0.07, zoomFov: 24, speed: 0.78, pellets: 1, sound: 'sniper', reward: 100,
  },
};

const dir = { x: 0, y: 0, z: 0 };

// A fresh gun with a full magazine and reserve.
export function weaponInstance(id) {
  const def = WEAPONS[id];
  return { def, mag: def.mag, reserve: def.reserve };
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
function cycleNade(a) {
  const order = ['frag', 'smoke', 'flash'];
  let i = order.indexOf(a.nadeType);
  for (let k = 0; k < 3; k++) {
    i = (i + 1) % 3;
    if (a[order[i]] > 0) { a.nadeType = order[i]; return; }
  }
}

function startReload(state, a) {
  const w = heldWeapon(a);
  if (!w || a.reloading > 0 || w.mag >= w.def.mag || w.reserve <= 0) return;
  a.reloading = w.def.reload;
  a.scoped = false;
  emit(state, 'reload', a.pos.x, a.pos.y, a.pos.z).actor = a;
}

// One tick of an actor's hands: switching, reloading, scoping, throwing and firing.
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
  const w = heldWeapon(a);
  settle(a, w ? w.def.recover : 8, state.time, dt);

  if (a.reloading > 0) {
    a.reloading -= dt;
    if (a.reloading <= 0) {
      // The magazine is topped up from the reserve; when the reserve is gone the gun is out.
      const take = Math.min(w.def.mag - w.mag, w.reserve);
      w.mag += take;
      w.reserve -= take;
      a.reloading = 0;
      emit(state, 'reloaded', a.pos.x, a.pos.y, a.pos.z).actor = a;
    }
  }
  const pressed = inp.fire && !inp.firePrev;
  inp.firePrev = inp.fire;
  const scopePressed = inp.scope && !inp.scopePrev;
  inp.scopePrev = inp.scope;
  if (state.match.phase === 'freeze' || a.using > 0) return;

  if (a.current === 'nade') {
    if (pressed && a.switching <= 0 && a[a.nadeType] > 0) {
      // A full throw, or a short lob while walking.
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
  if (inp.reload) { startReload(state, a); inp.reload = false; }
  if (!inp.fire || a.cooldown > 0 || a.switching > 0 || a.reloading > 0) return;
  if (!w.def.auto && !pressed) return;
  if (w.mag <= 0) {
    if (pressed) emit(state, 'dry', a.pos.x, a.pos.y, a.pos.z).actor = a;
    startReload(state, a);
    a.cooldown = 0.25;
    return;
  }
  fire(state, a, w);
}

// One trigger pull: a round (or a shotgun's pellets) leaves along the view, displaced by recoil and
// scattered inside the spread cone; then the gun kicks.
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
  kick(a, d, state.time);
  if (d.kind === 'sniper') a.scoped = false;
  const e = emit(state, 'shot', ox, oy, oz);
  e.actor = a; e.text = d.sound;
  makeNoise(state, a, ox, oz, d.kind === 'sniper' ? 70 : 52, 'shots');
}
