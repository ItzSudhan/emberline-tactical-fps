// Money and the buy menu. Everyone starts on $800. A round pays the winners a flat bonus (more when
// it was won by the Igniter) and the losers a bonus that grows with every round lost in a row, so a
// beaten squad can afford to buy back in; kills and plants pay on top. Money is spent in the buy
// menu during the buy phase and the first seconds of a round, on guns, armour, a defuse kit and
// grenades. Bots shop through the same buyItem the player's menu calls.

import { emit, SIDES } from './state.js';
import { WEAPONS, weaponInstance } from './weapons.js';
import { GRENADES } from './grenades-smoke-flash.js';

export const ECON = { start: 800, max: 16000, win: 3250, winBomb: 3500, loss: 1400, lossStep: 500, lossMax: 3400, kill: 300 };
export const BUY_WINDOW = 20; // seconds of a live round during which the buy menu still opens
export const ARMOUR = {
  vest: { name: 'Plate Vest', price: 650, note: '100 armour · soaks body hits' },
  helm: { name: 'Vest + Helm', price: 1000, note: 'armour that also covers the head' },
  kit: { name: 'Defuse Kit', price: 400, note: 'defuse in 3.6 s, not 7' },
};
// The buy menu's layout: key, item id, category.
export const SHOP = [
  { key: '1', id: 'marten', cat: 'Pistol' },
  { key: '2', id: 'wren', cat: 'SMG' },
  { key: '3', id: 'brush', cat: 'Shotgun' },
  { key: '4', id: 'kestrel', cat: 'Rifle' },
  { key: '5', id: 'longreach', cat: 'Sniper' },
  { key: '6', id: 'vest', cat: 'Armour' },
  { key: '7', id: 'helm', cat: 'Armour' },
  { key: '8', id: 'kit', cat: 'Gear' },
  { key: '9', id: 'frag', cat: 'Grenade' },
  { key: '0', id: 'smoke', cat: 'Grenade' },
  { key: '-', id: 'flash', cat: 'Grenade' },
];

// The gun, armour or grenade a shop id names.
export const itemInfo = (id) => WEAPONS[id] ?? ARMOUR[id] ?? GRENADES[id];

export function canBuy(state, a) {
  const m = state.match;
  return a.alive && (m.phase === 'freeze' || (m.phase === 'live' && m.roundClock < BUY_WINDOW));
}

// A helmet alone costs less once you already wear the vest.
export function priceOf(a, id) {
  return id === 'helm' && a.armor >= 100 && !a.helmet ? 350 : itemInfo(id).price;
}

// Buys one item for an actor. Returns '' on success, or the reason the purchase failed.
export function buyItem(state, a, id) {
  if (!canBuy(state, a)) return 'Buy time is over';
  const w = WEAPONS[id];
  if (w) {
    const owned = w.slot === 'primary' ? a.primary : a.secondary;
    if (owned && owned.def.id === id) return 'Already owned';
  } else if (id === 'vest' && a.armor >= 100) return 'Already owned';
  else if (id === 'helm' && a.helmet && a.armor >= 100) return 'Already owned';
  else if (id === 'kit' && (a.team !== 'def' || a.kit)) return a.kit ? 'Already owned' : `${SIDES.def.name} only`;
  else if (GRENADES[id] && a[id] >= (id === 'flash' ? 2 : 1)) return 'Carrying the maximum';
  const price = priceOf(a, id);
  if (a.money < price) return 'Not enough money';
  a.money -= price;
  if (w) {
    if (w.slot === 'primary') { a.primary = weaponInstance(id); a.current = 'primary'; }
    else { a.secondary = weaponInstance(id); if (!a.primary) a.current = 'secondary'; }
    a.switching = 0.3;
  } else if (id === 'kit') a.kit = true;
  else if (GRENADES[id]) a[id]++;
  else { a.armor = 100; a.helmet = a.helmet || id === 'helm'; }
  const e = emit(state, 'buy', a.pos.x, a.pos.y, a.pos.z);
  e.actor = a; e.text = id;
  return '';
}

// Bots spend like a squad: a pistol or a vest on a pistol round, a save when the squad is poor,
// otherwise the best gun they can afford, then armour, a kit for defenders, and grenades.
export function botBuy(state, a, squadAverage, pistolRound) {
  const rng = state.rng;
  const get = (id) => buyItem(state, a, id) === '';
  if (pistolRound) {
    get(rng.chance(0.5) ? 'vest' : 'marten');
    if (rng.chance(0.5)) get('flash');
    return;
  }
  if (squadAverage < 2300 && !a.primary) {
    if (a.money > 1400 && rng.chance(0.4)) get('marten');
    return;
  }
  if (!a.primary && !(a.money >= 5600 && rng.chance(0.22) && get('longreach')) && !get('kestrel')) get(rng.chance(0.7) ? 'wren' : 'brush');
  if (!get('helm')) get('vest');
  if (a.team === 'def' && rng.chance(0.6)) get('kit');
  if (rng.chance(0.7)) get('smoke');
  if (rng.chance(0.6)) get('frag');
  if (rng.chance(0.5)) get('flash');
}

// What a side would be paid for losing the round now: more for every loss in a row.
export const lossBonus = (state, team) => Math.min(ECON.lossMax, ECON.loss + ECON.lossStep * state.match.lossStreak[team]);

// Pays both sides at the end of a round and moves the loss streaks. Returns the winners' bonus.
export function payRound(state, winner, byObjective) {
  const m = state.match, loser = winner === 'att' ? 'def' : 'att';
  const winPay = byObjective ? ECON.winBomb : ECON.win, lossPay = lossBonus(state, loser);
  m.lossStreak[loser]++;
  m.lossStreak[winner] = 0;
  for (const a of state.actors) a.money = Math.min(ECON.max, a.money + (a.team === winner ? winPay : lossPay));
  return winPay;
}
