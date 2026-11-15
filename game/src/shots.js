// Screenshot staging (?shot=name&seed=n): starts a real match, moves actors into a scene, runs the
// real simulation for a few ticks so bots react and guns fire, then freezes the clock for capture.

import { SIM_DT } from './config.js';
import { cellCenter, COLS } from './mapdata.js';
import { weaponInstance, eyeHeight } from './actors.js';
import { yawTo } from './util.js';
import { pushLine } from './state.js';

function place(state, a, cx, cz, lookX, lookZ, opts = {}) {
  a.pos.x = cellCenter(cx) + (opts.dx ?? 0);
  a.pos.z = cellCenter(cz) + (opts.dz ?? 0);
  a.pos.y = Math.max(0, state.map.h[cz * COLS + cx] < 1 ? state.map.h[cz * COLS + cx] : 0);
  a.prev.x = a.pos.x; a.prev.y = a.pos.y; a.prev.z = a.pos.z;
  a.vel.x = a.vel.y = a.vel.z = 0;
  const lx = cellCenter(lookX), lz = cellCenter(lookZ);
  a.yaw = yawTo(lx - a.pos.x, lz - a.pos.z);
  const ty = opts.lookY ?? 1.3;
  a.pitch = opts.pitch ?? Math.atan2(ty - (a.pos.y + eyeHeight(a)), Math.hypot(lx - a.pos.x, lz - a.pos.z));
  a.crouch = opts.crouch ? 1 : 0;
  a.input.crouch = !!opts.crouch;
  if (opts.weapon) { a.primary = weaponInstance(opts.weapon); a.current = 'primary'; }
  if (opts.hp) a.hp = opts.hp;
  if (opts.armor !== undefined) { a.armor = opts.armor; a.helmet = opts.armor > 0; }
}

function goLive(state, round, att, def, clock) {
  const m = state.match;
  m.round = round; m.score.att = att; m.score.def = def;
  m.phase = 'live'; m.roundClock = clock; m.phaseTime = 105 - clock;
}

function run(state, ctx, ticks, each) {
  for (let i = 0; i < ticks; i++) {
    if (each) each(i);
    ctx.stepSim(state, SIM_DT);
  }
}

function feed(state, killer, kt, victim, vt, weapon, headshot) {
  pushLine(state.feed, { time: state.time, killer, killerTeam: kt, victim, victimTeam: vt, weapon, headshot });
}

function bySide(state, team) {
  return state.actors.filter((a) => a.team === team && !a.isPlayer);
}

const SCENES = {
  // Vanguard player at the mouth of Short A, trading with Bastion on Kiln Hall.
  firefight(state, ctx) {
    const p = state.player;
    const [d1, d2, d3, d4, d5] = bySide(state, 'def');
    const [t1, t2, t3, t4] = bySide(state, 'att');
    goLive(state, 6, 3, 2, 38);
    place(state, p, 10, 12, 6, 10, { weapon: 'kestrel', hp: 71, armor: 64, lookY: 1.45, dx: 0.4, dz: 0.3 });
    place(state, d1, 6, 10, 10, 12, { weapon: 'kestrel' });
    place(state, d2, 2, 6, 10, 12, { weapon: 'longreach' });
    place(state, d3, 3, 10, 10, 12, { weapon: 'wren', crouch: true });
    place(state, t1, 10, 9, 4, 8, { weapon: 'kestrel', dx: 0.6 });
    for (const a of [d4, d5]) { a.alive = false; a.hp = 0; a.diedAt = -99; }
    place(state, d4, 8, 12, 10, 14, {}); place(state, d5, 3, 11, 10, 13, {});
    state.plan.site = 'A'; state.plan.executing = true;
    for (const a of [t1, t2, t3, t4]) a.brain.route = { name: 'Short A', points: [[12, 14], [7, 9]], smoke: null };
    for (const a of [t2, t3, t4]) place(state, a, 2, 22, 2, 14, { weapon: 'wren' });
    state.smokes[0].active = true;
    Object.assign(state.smokes[0], { x: 5, y: 1.6, z: 13, radius: 4.4, density: 1, life: 10 });
    feed(state, 'You', 'att', 'Wick', 'def', 'Kestrel AR', true);
    feed(state, 'Rook', 'att', 'Larch', 'def', 'Wren SMG', false);
    feed(state, 'Basalt', 'def', 'Tansy', 'att', 'Longreach', false);
    pushLine(state.radio, { time: state.time, team: 'att', name: 'Rook', text: 'Contact, A Site' });
    pushLine(state.radio, { time: state.time, team: 'att', name: 'Ferro', text: 'Go go, hit A!' });
    p.money = 2350;
    run(state, ctx, 8, () => { p.input.fire = true; });
    p.punchPitch = 0.025;
  },

  // Bastion player on the B loading dock while the Igniter ticks on site.
  retake(state, ctx) {
    const p = state.player;
    const atts = bySide(state, 'att');
    const defs = bySide(state, 'def');
    goLive(state, 9, 4, 4, 70);
    place(state, p, 37, 6, 34, 10, { weapon: 'wren', hp: 88, armor: 100, lookY: 0.6 });
    place(state, atts[0], 32, 11, 37, 6, { weapon: 'kestrel', crouch: true });
    place(state, atts[1], 31, 9, 37, 6, { weapon: 'kestrel' });
    for (let i = 2; i < atts.length; i++) { atts[i].alive = false; atts[i].diedAt = -99; place(state, atts[i], 29 + i, 12, 37, 6, {}); }
    place(state, defs[0], 36, 11, 33, 10, { weapon: 'kestrel', crouch: true });
    for (let i = 1; i < defs.length; i++) place(state, defs[i], 30, 3 + (i % 2), 31, 8, { weapon: 'wren' });
    const bomb = state.bomb;
    bomb.state = 'planted'; bomb.carrier = null; bomb.site = 'B';
    bomb.x = cellCenter(35) - 0.6; bomb.y = 0; bomb.z = cellCenter(8) + 0.4;
    bomb.timer = 22.6; bomb.beep = 0.3;
    state.match.phaseTime = bomb.timer;
    feed(state, 'Moth', 'att', '', '', 'planted the Igniter at B', false);
    feed(state, 'Juniper', 'def', 'Quill', 'att', 'Kestrel AR', true);
    feed(state, 'You', 'def', 'Cinder', 'att', 'Wren SMG', false);
    p.frag = 1; p.money = 3150;
    run(state, ctx, 4);
    ctx.view.fx.blast(cellCenter(32) + 0.5, 0.1, cellCenter(10), false);
    ctx.app.postStage = () => ctx.view.fx.update(0.12, state);
  },

  // Buy phase at Vanguard Gate.
  buy(state, ctx) {
    const p = state.player;
    state.match.round = 3; state.match.score.att = 1; state.match.score.def = 1;
    p.money = 4150;
    const mates = bySide(state, 'att');
    place(state, p, 19, 30, 19, 22, { lookY: 2.2 });
    place(state, mates[0], 18, 27, 18, 20, { weapon: 'kestrel' });
    place(state, mates[1], 21, 27, 21, 20, { weapon: 'wren', dx: 0.3 });
    place(state, mates[2], 17, 29, 19, 20, { weapon: 'kestrel' });
    place(state, mates[3], 22, 29, 19, 20, { weapon: 'brush' });
    state.match.phaseTime = 3.4;
    pushLine(state.radio, { time: state.time, team: 'att', name: 'Ferro', text: 'Saving for rifles next round' });
    run(state, ctx, 2);
    ctx.setBuy(true);
  },
};

export function runShot(name, ctx) {
  const done = () => { ctx.app.frozen = true; };
  if (name === 'menu') {
    ctx.view.setMenuAngle(Number(new URLSearchParams(location.search).get('angle') ?? 2.25));
    ctx.app.frozen = true;
    return;
  }
  const scene = SCENES[name];
  if (!scene) return;
  const side = name === 'retake' ? 'def' : 'att';
  const state = ctx.startMatch({ seed: 11, side, difficulty: 'normal', noLock: true });
  scene(state, ctx);
  done();
}
