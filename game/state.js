// The one place game state lives. Only the simulation (stepSim in rounds-halftime.js) mutates it, on
// fixed ticks; rendering, audio and the HUD read it and learn about one-off happenings (shots, hits,
// kills) by draining the event ring. Bots hear through the noise ring.

import { buildMap } from './map-kilnworks.js';

export const SIM_DT = 1 / 60; // the fixed simulation step: stepSim advances this state by exactly one
// The Stokers come to light the plant's kilns one last time; the Kilnwatch keep them cold.
export const SIDES = {
  att: { name: 'Stokers', color: 0xd4652f, css: '#e07a43', verb: 'plant the Igniter' },
  def: { name: 'Kilnwatch', color: 0x2b9e95, css: '#3cc0b4', verb: 'hold both sites' },
};
const EVENT_RING = 512;
const NOISE_RING = 64;

// Mulberry32: a seeded generator, so bots, spread and whole matches replay the same way from a seed.
export function createRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (n) => Math.floor(next() * n),
    chance: (p) => next() < p,
    // Approximately normal, mean 0, sd 1.
    gauss: () => (next() + next() + next() + next() - 2) * 1.732,
  };
}

export function createState({ seed = 1, side = 'att', difficulty = 'normal', autoplay = false } = {}) {
  // Every ring and pool is allocated here, once: a tick never creates an object.
  const events = [];
  for (let i = 0; i < EVENT_RING; i++) events.push({ type: '', x: 0, y: 0, z: 0, a: 0, b: 0, c: 0, actor: null, other: null, text: '' });
  const noises = [];
  for (let i = 0; i < NOISE_RING; i++) noises.push({ x: 0, z: 0, radius: 0, team: '', time: -99, actor: null, kind: '' });
  const grenades = [];
  for (let i = 0; i < 24; i++) grenades.push({ active: false, type: '', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, owner: null, rest: false });
  const smokes = [];
  for (let i = 0; i < 8; i++) smokes.push({ active: false, x: 0, y: 0, z: 0, radius: 0, density: 0, life: 0 });

  return {
    seed,
    rng: createRng(seed),
    map: buildMap(),
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
      result: null, // { winner, reason, mvp, winPay, lossPay }
      history: [], // the winning side of every round played
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

// A sound bots can hear: `kind` is 'shots', 'steps', 'a grenade' or 'the Igniter'.
export function makeNoise(state, actor, x, z, radius, kind) {
  const n = state.noises[state.noiseCount % NOISE_RING];
  state.noiseCount++;
  n.x = x; n.z = z; n.radius = radius; n.team = actor ? actor.team : ''; n.time = state.time; n.actor = actor; n.kind = kind;
}

export const NOISE_CAPACITY = NOISE_RING;

// Appends to a bounded list (the kill feed, the radio).
export function pushLine(list, entry, max = 6) {
  list.push(entry);
  if (list.length > max) list.shift();
}

// A line on a side's radio: what its bots have seen, heard and decided. The HUD shows your side's.
export function radio(state, a, text) {
  pushLine(state.radio, { time: state.time, team: a.team, name: a.name, text }, 5);
}

// The gun an actor has in hand, or null while a grenade is out.
export function heldWeapon(a) {
  return a.current === 'primary' ? a.primary : a.current === 'secondary' ? a.secondary : null;
}
