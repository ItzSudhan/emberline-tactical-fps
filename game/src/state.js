// The one place game state lives. The simulation mutates it on fixed ticks; rendering, audio and the
// HUD only read it, and learn about one-off happenings (shots, hits, kills) through the event ring.

import { createRng } from './util.js';
import { buildMap } from './mapdata.js';
import { initNav } from './nav.js';

const EVENT_RING = 512;
const NOISE_RING = 64;

export function createState({ seed = 1, side = 'att', difficulty = 'normal', autoplay = false } = {}) {
  const events = [];
  for (let i = 0; i < EVENT_RING; i++) events.push({ type: '', x: 0, y: 0, z: 0, a: 0, b: 0, c: 0, actor: null, other: null, text: '' });
  const noises = [];
  for (let i = 0; i < NOISE_RING; i++) noises.push({ x: 0, z: 0, radius: 0, team: '', time: -99, actor: null });
  const grenades = [];
  for (let i = 0; i < 24; i++) grenades.push({ active: false, type: '', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, owner: null, rest: false });
  const smokes = [];
  for (let i = 0; i < 8; i++) smokes.push({ active: false, x: 0, y: 0, z: 0, radius: 0, density: 0, life: 0 });

  const map = buildMap();
  initNav(map);
  return {
    seed,
    rng: createRng(seed),
    map,
    time: 0,
    tick: 0,
    settings: { side, difficulty, autoplay },
    match: {
      phase: 'menu', // menu | freeze | live | post | over
      phaseTime: 0,
      round: 0,
      roundClock: 0,
      score: { att: 0, def: 0 },
      lossStreak: { att: 0, def: 0 },
      result: null, // { winner, reason }
      history: [],
    },
    actors: [],
    player: null,
    bomb: {
      state: 'carried', // carried | dropped | planted | defused | exploded
      carrier: null,
      x: 0, y: 0, z: 0,
      site: '',
      timer: 0,
      plantProgress: 0,
      defuseProgress: 0,
      defuser: null,
      beep: 0,
    },
    plan: { site: 'A', executeAt: 25, executing: false }, // the attackers' shared plan for this round
    intel: { att: { x: 0, z: 0, time: -99, room: '' }, def: { x: 0, z: 0, time: -99, room: '' } },
    grenades,
    smokes,
    events,
    eventCount: 0,
    noises,
    noiseCount: 0,
    feed: [], // recent kill lines for the HUD (bounded)
    radio: [], // recent radio lines (bounded)
  };
}

// Claims the next slot in the event ring. Readers keep their own cursor against state.eventCount.
export function emit(state, type, x = 0, y = 0, z = 0) {
  const e = state.events[state.eventCount % EVENT_RING];
  state.eventCount++;
  e.type = type; e.x = x; e.y = y; e.z = z;
  e.a = 0; e.b = 0; e.c = 0; e.actor = null; e.other = null; e.text = '';
  return e;
}

export function eventAt(state, n) {
  return state.events[n % EVENT_RING];
}

export const EVENT_CAPACITY = EVENT_RING;

// A sound bots can hear: gunfire, footsteps, grenades, the Igniter.
export function makeNoise(state, actor, x, z, radius) {
  const n = state.noises[state.noiseCount % NOISE_RING];
  state.noiseCount++;
  n.x = x; n.z = z; n.radius = radius; n.team = actor ? actor.team : ''; n.time = state.time; n.actor = actor;
}

export const NOISE_CAPACITY = NOISE_RING;

export function pushLine(list, entry, max = 6) {
  list.push(entry);
  if (list.length > max) list.shift();
}
