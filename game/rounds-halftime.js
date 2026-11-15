// The match: rounds that end in a win or a loss and start again. Each round is a buy phase, up to
// 1:45 of play and a few seconds to take in the result; a side wins it by eliminating the other, by
// the Igniter (planted and detonated, or defused), or, for the defenders, by running out the clock.
// The squads swap sides at half time, after six rounds, and the first to seven rounds takes the
// match. stepSim is the whole simulation tick; it is all the frame loop ever calls.

import { emit, SIDES } from './state.js';
import { SPAWNS, cellCenter } from './map-kilnworks.js';
import { stepActor, separateActors } from './movement-collision.js';
import { weaponInstance, updateWeapon } from './weapons.js';
import { updateGrenades } from './grenades-smoke-flash.js';
import { resetBomb, updateBomb } from './bomb-plant-defuse.js';
import { ECON, botBuy, lossBonus, payRound } from './economy-buy.js';
import { createBrain, updateBot } from './bots.js';
import { planRound } from './bot-routes.js';
import { initNav } from './nav.js';

export const ROUND = { freeze: 5, length: 105, endDelay: 5.5, toWin: 7, half: 6, teamSize: 5 }; // seconds, rounds, players
const BOT_NAMES = {
  att: ['Rook', 'Tansy', 'Ferro', 'Quill', 'Moth'],
  def: ['Basalt', 'Juniper', 'Halyard', 'Sable', 'Wick'],
};
let nextId = 1;

// A soldier. The player and every bot are the same record, driven through the same `input`, so bots
// obey the same acceleration, spread and collision rules the player does.
function createActor(team, name, isPlayer) {
  return {
    id: nextId++, name, team, isPlayer,
    alive: true, hp: 100, armor: 0, helmet: false, kit: false, money: ECON.start,
    pos: { x: 0, y: 0, z: 0 }, prev: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0, crouch: 0, grounded: true, stride: 0,
    input: { fwd: 0, side: 0, jump: false, crouch: false, walk: false, fire: false, firePrev: false, reload: false, use: false, scope: false, scopePrev: false, slot: '' },
    primary: null, secondary: weaponInstance('pike'), frag: 0, smoke: 0, flash: 0,
    current: 'secondary', lastSlot: 'secondary', nadeType: 'frag',
    cooldown: 0, reloading: 0, switching: 0, scoped: false,
    shots: 0, lastShot: -9, punchPitch: 0, punchYaw: 0, // the spray so far and the recoil on the view
    flashed: 0, hurtTime: -9, hurtX: 0, hurtZ: 0,
    kills: 0, deaths: 0, assists: 0, headKills: 0, damage: 0, roundKills: 0,
    hitBy: null, hitBy2: null, // the last two enemies to hurt this actor: the killer and the assist
    using: 0, // seconds spent holding plant / defuse
    diedAt: -99,
    seenBy: { att: -99, def: -99 }, // last time each side had eyes on this actor (minimap)
    brain: null,
  };
}

export function setupMatch(state) {
  const { side, difficulty, autoplay } = state.settings;
  initNav(state.map);
  state.actors.length = 0;
  const player = createActor(side, 'You', true);
  if (autoplay) player.brain = createBrain(difficulty);
  state.player = player;
  state.actors.push(player);
  for (const team of ['att', 'def']) {
    const count = ROUND.teamSize - (team === side ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const bot = createActor(team, BOT_NAMES[team][i], false);
      bot.brain = createBrain(difficulty);
      state.actors.push(bot);
    }
  }
  const m = state.match;
  m.round = 0;
  m.score.att = m.score.def = 0;
  m.lossStreak.att = m.lossStreak.def = 0;
  m.history.length = 0;
  state.feed.length = 0;
  startRound(state);
}

// Half time: the squads trade sides and start again from pistols, keeping their scores.
function swapSides(state) {
  const m = state.match;
  for (const a of state.actors) {
    a.team = a.team === 'att' ? 'def' : 'att';
    a.alive = false; // spawn() strips a dead actor's kit
    a.money = ECON.start;
  }
  const s = m.score.att;
  m.score.att = m.score.def;
  m.score.def = s;
  m.lossStreak.att = m.lossStreak.def = 0;
  state.settings.side = state.player.team;
}

// Puts an actor back on its spawn for a new round. Survivors keep their guns and armour; the dead
// start again from the pistol.
function spawn(state, a, cell) {
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
  a.pos.x = a.prev.x = cellCenter(cell[0]) + jitter;
  a.pos.z = a.prev.z = cellCenter(cell[1]) - jitter;
  a.pos.y = a.prev.y = 0;
  a.vel.x = a.vel.y = a.vel.z = 0;
  a.yaw = a.team === 'att' ? 0 : Math.PI;
  a.pitch = a.crouch = 0;
  a.current = a.primary ? 'primary' : 'secondary';
  a.cooldown = a.reloading = a.switching = a.shots = a.punchPitch = a.punchYaw = a.flashed = a.using = a.roundKills = 0;
  a.scoped = false;
  a.hitBy = a.hitBy2 = null;
  a.hurtTime = -9;
}

function startRound(state) {
  const m = state.match;
  m.round++;
  m.phase = 'freeze';
  m.phaseTime = ROUND.freeze;
  m.roundClock = 0;
  m.result = null;
  const swap = m.round === ROUND.half + 1;
  if (swap) swapSides(state);
  const next = { att: 0, def: 0 };
  for (const a of state.actors) spawn(state, a, SPAWNS[a.team][next[a.team]++]);
  for (const g of state.grenades) g.active = false;
  for (const s of state.smokes) s.active = false;
  state.intel.att.time = state.intel.def.time = -99;
  state.radio.length = 0;

  const attackers = state.actors.filter((a) => a.team === 'att');
  resetBomb(state, attackers[state.rng.int(attackers.length)]);
  // The first round of each half is a pistol round: nobody can afford more.
  const pistolRound = m.round === 1 || swap;
  for (const team of ['att', 'def']) {
    const squad = state.actors.filter((a) => a.team === team);
    const average = squad.reduce((sum, a) => sum + a.money, 0) / squad.length;
    for (const a of squad) if (a.brain) botBuy(state, a, average, pistolRound);
  }
  planRound(state);
  emit(state, 'roundStart').text = swap ? 'swap' : '';
}

// One fixed simulation tick: bots think, bodies move, weapons fire, grenades fly, the round advances.
export function stepSim(state, dt) {
  const phase = state.match.phase;
  if (phase === 'menu') return;
  state.time += dt;
  state.tick++;
  const actors = state.actors;
  for (let i = 0; i < actors.length; i++) if (actors[i].brain) updateBot(state, actors[i], dt);
  for (let i = 0; i < actors.length; i++) stepActor(state, actors[i], dt);
  separateActors(actors);
  if (phase !== 'over') for (let i = 0; i < actors.length; i++) updateWeapon(state, actors[i], dt);
  updateGrenades(state, dt);
  if (phase !== 'over') updateRound(state, dt);
}

function updateRound(state, dt) {
  const m = state.match;
  m.phaseTime -= dt;
  if (m.phase === 'freeze') {
    if (m.phaseTime <= 0) { m.phase = 'live'; m.phaseTime = ROUND.length; emit(state, 'live'); }
    return;
  }
  if (m.phase === 'post') {
    if (m.phaseTime > 0) return;
    if (m.score.att >= ROUND.toWin || m.score.def >= ROUND.toWin) { m.phase = 'over'; emit(state, 'matchOver'); }
    else startRound(state);
    return;
  }
  m.roundClock += dt;
  const bomb = updateBomb(state, dt);
  if (bomb === 'defused') return endRound(state, 'def', `${state.bomb.defuser.name} defused the Igniter`, true);
  if (bomb === 'exploded') return endRound(state, 'att', 'The Igniter detonated', true);
  let att = 0, def = 0;
  for (const a of state.actors) if (a.alive) { if (a.team === 'att') att++; else def++; }
  const planted = state.bomb.state === 'planted';
  if (def === 0) endRound(state, 'att', `${SIDES.def.name} eliminated`, false);
  else if (att === 0 && !planted) endRound(state, 'def', `${SIDES.att.name} eliminated`, false);
  else if (!planted && m.phaseTime <= 0) endRound(state, 'def', 'Time ran out', false);
}

// Scores the round, pays both sides and names the winners' most valuable player.
function endRound(state, winner, reason, byObjective) {
  const m = state.match;
  m.phase = 'post';
  m.phaseTime = ROUND.endDelay;
  m.score[winner]++;
  m.history.push(winner);
  const lossPay = lossBonus(state, winner === 'att' ? 'def' : 'att');
  const winPay = payRound(state, winner, byObjective);
  let mvp = null;
  for (const a of state.actors) {
    a.using = 0;
    if (a.team === winner && (!mvp || a.roundKills > mvp.roundKills)) mvp = a;
  }
  m.result = { winner, reason, mvp, winPay, lossPay };
  emit(state, 'roundEnd');
}
