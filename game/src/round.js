// Match flow: freeze (buy) -> live -> post -> next round, first side to ROUND.toWin takes the match.
// Also the Igniter (the objective charge): carrying, dropping, planting, the fuse and defusing,
// and the money each round pays out.

import { ROUND, ECON, WEAPONS, GEAR, BOT_NAMES } from './config.js';
import { createActor, resetForRound, applyDamage, weaponInstance } from './actors.js';
import { createBrain, planRound, botBuy } from './bots.js';
import { SPAWNS, ZONE, zoneAt } from './mapdata.js';
import { emit, makeNoise, pushLine } from './state.js';

export function setupMatch(state) {
  const { side, difficulty, autoplay } = state.settings;
  state.actors.length = 0;
  const player = createActor(side, 'You', true);
  if (autoplay) player.brain = createBrain(difficulty);
  state.player = player;
  state.actors.push(player);
  for (const team of ['att', 'def']) {
    const count = ROUND.teamSize - (team === side ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const bot = createActor(team, BOT_NAMES[team][i]);
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

export function startRound(state) {
  const m = state.match;
  m.round++;
  m.phase = 'freeze';
  m.phaseTime = ROUND.freeze;
  m.roundClock = 0;
  m.result = null;
  const idx = { att: 0, def: 0 };
  for (const a of state.actors) resetForRound(state, a, SPAWNS[a.team][idx[a.team]++ % SPAWNS[a.team].length]);
  for (const g of state.grenades) g.active = false;
  for (const s of state.smokes) s.active = false;
  state.intel.att.time = state.intel.def.time = -99;
  state.radio.length = 0;

  const bomb = state.bomb;
  const attackers = state.actors.filter((a) => a.team === 'att');
  bomb.state = 'carried';
  bomb.carrier = attackers[state.rng.int(attackers.length)];
  bomb.site = '';
  bomb.timer = 0;
  bomb.plantProgress = bomb.defuseProgress = 0;
  bomb.defuser = null;

  for (const team of ['att', 'def']) {
    const mates = state.actors.filter((a) => a.team === team);
    const avg = mates.reduce((s, a) => s + a.money, 0) / mates.length;
    for (const a of mates) if (a.brain && (!a.isPlayer || state.settings.autoplay)) botBuy(state, a, avg);
  }
  planRound(state);
  emit(state, 'roundStart').a = m.round;
}

export function canBuy(state, a) {
  const m = state.match;
  return a.alive && (m.phase === 'freeze' || (m.phase === 'live' && m.roundClock < ROUND.buyWindow));
}

export function priceOf(a, id) {
  if (id === 'helm') return a.armor >= 100 && !a.helmet ? 350 : GEAR.helm.price;
  return WEAPONS[id]?.price ?? GEAR[id].price;
}

// Returns '' on success, or the reason the purchase failed.
export function buyItem(state, a, id) {
  if (!canBuy(state, a)) return 'Buy time is over';
  const price = priceOf(a, id);
  const w = WEAPONS[id];
  if (w) {
    const owned = w.slot === 'primary' ? a.primary : a.secondary;
    if (owned && owned.def.id === id) return 'Already owned';
  } else if (id === 'vest' && a.armor >= 100) return 'Already owned';
  else if (id === 'helm' && a.helmet && a.armor >= 100) return 'Already owned';
  else if (id === 'kit' && (a.team !== 'def' || a.kit)) return a.kit ? 'Already owned' : 'Bastion only';
  else if ((id === 'frag' || id === 'smoke') && a[id] >= 1) return 'Carrying the maximum';
  else if (id === 'flash' && a.flash >= 2) return 'Carrying the maximum';
  if (a.money < price) return 'Not enough money';
  a.money -= price;
  if (w) {
    if (w.slot === 'primary') { a.primary = weaponInstance(id); a.current = 'primary'; }
    else { a.secondary = weaponInstance(id); if (!a.primary) a.current = 'secondary'; }
    a.switching = 0.3;
  } else if (id === 'vest') a.armor = 100;
  else if (id === 'helm') { a.armor = 100; a.helmet = true; }
  else if (id === 'kit') a.kit = true;
  else a[id]++;
  const e = emit(state, 'buy', a.pos.x, a.pos.y, a.pos.z);
  e.actor = a; e.text = id;
  return '';
}

export function updateRound(state, dt) {
  const m = state.match;
  if (m.phase === 'menu' || m.phase === 'over') return;
  m.phaseTime -= dt;
  if (m.phase === 'freeze') {
    if (m.phaseTime <= 0) { m.phase = 'live'; m.phaseTime = ROUND.length; emit(state, 'live'); }
    return;
  }
  if (m.phase === 'post') {
    if (m.phaseTime <= 0) {
      if (m.score.att >= ROUND.toWin || m.score.def >= ROUND.toWin) { m.phase = 'over'; emit(state, 'matchOver'); }
      else startRound(state);
    }
    return;
  }
  m.roundClock += dt;
  updateBomb(state, dt);
  if (m.phase !== 'live') return;
  let att = 0, def = 0;
  for (const a of state.actors) if (a.alive) { if (a.team === 'att') att++; else def++; }
  const planted = state.bomb.state === 'planted';
  if (def === 0) endRound(state, 'att', 'Bastion eliminated');
  else if (att === 0 && !planted) endRound(state, 'def', 'Vanguard eliminated');
  else if (!planted && m.phaseTime <= 0) endRound(state, 'def', 'Time ran out');
}

function updateBomb(state, dt) {
  const bomb = state.bomb;
  const actors = state.actors;
  if (bomb.state === 'dropped') {
    for (const a of actors) {
      if (!a.alive || a.team !== 'att') continue;
      if (Math.hypot(a.pos.x - bomb.x, a.pos.z - bomb.z) < 1.2) {
        bomb.state = 'carried';
        bomb.carrier = a;
        emit(state, 'pickup', a.pos.x, a.pos.y, a.pos.z).actor = a;
        break;
      }
    }
  }
  if (bomb.state === 'carried') {
    const c = bomb.carrier;
    bomb.x = c.pos.x; bomb.y = c.pos.y; bomb.z = c.pos.z;
    const zone = zoneAt(state.map, c.pos.x, c.pos.z);
    const onSite = zone === ZONE.siteA || zone === ZONE.siteB;
    for (const a of actors) if (a !== c) a.using = 0;
    if (c.input.use && onSite && c.grounded) {
      c.using += dt;
      if (c.using - dt <= 0) emit(state, 'planting', c.pos.x, c.pos.y, c.pos.z).actor = c;
      bomb.plantProgress = c.using / ROUND.plantTime;
      if (c.using >= ROUND.plantTime) {
        c.using = 0;
        bomb.state = 'planted';
        bomb.carrier = null;
        bomb.site = zone === ZONE.siteA ? 'A' : 'B';
        bomb.timer = ROUND.bombTimer;
        bomb.beep = 0;
        c.money = Math.min(ECON.max, c.money + ECON.plant);
        state.match.phaseTime = ROUND.bombTimer;
        pushLine(state.feed, { time: state.time, killer: c.name, killerTeam: 'att', victim: '', victimTeam: '', weapon: `planted the Igniter at ${bomb.site}`, headshot: false });
        emit(state, 'planted', bomb.x, bomb.y, bomb.z).actor = c;
        makeNoise(state, c, bomb.x, bomb.z, 200);
      }
    } else {
      c.using = 0;
      bomb.plantProgress = 0;
    }
    return;
  }
  if (bomb.state !== 'planted') return;
  bomb.timer -= dt;
  state.match.phaseTime = bomb.timer;
  bomb.beep -= dt;
  if (bomb.beep <= 0) {
    bomb.beep = Math.max(0.12, Math.min(1, bomb.timer / 30));
    emit(state, 'beep', bomb.x, bomb.y + 0.2, bomb.z).a = bomb.timer;
  }
  // Defusing: hold use beside the charge, standing still; any interruption starts over.
  let defuser = null;
  for (const a of actors) {
    if (a.alive && a.team === 'def' && a.input.use && a.grounded && Math.hypot(a.pos.x - bomb.x, a.pos.z - bomb.z) < 1.5) { defuser = a; break; }
  }
  for (const a of actors) if (a !== defuser && a.team === 'def') a.using = 0;
  if (defuser) {
    if (bomb.defuser !== defuser) { bomb.defuser = defuser; defuser.using = 0; emit(state, 'defusing', bomb.x, bomb.y, bomb.z).actor = defuser; }
    defuser.using += dt;
    const need = defuser.kit ? ROUND.kitDefuseTime : ROUND.defuseTime;
    bomb.defuseProgress = defuser.using / need;
    if (defuser.using >= need) {
      defuser.using = 0;
      bomb.state = 'defused';
      emit(state, 'defused', bomb.x, bomb.y, bomb.z).actor = defuser;
      endRound(state, 'def', `${defuser.name === 'You' ? 'You' : defuser.name} defused the Igniter`);
      return;
    }
  } else {
    bomb.defuser = null;
    bomb.defuseProgress = 0;
  }
  if (bomb.timer <= 0) {
    bomb.state = 'exploded';
    emit(state, 'igniterBlast', bomb.x, bomb.y, bomb.z);
    for (const a of actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.pos.x - bomb.x, a.pos.z - bomb.z);
      if (d < 22) applyDamage(state, a, null, 500 * (1 - d / 22) ** 1.5, 'body', 1, 'Igniter');
    }
    endRound(state, 'att', 'The Igniter detonated');
  }
}

export function endRound(state, winner, reason) {
  const m = state.match;
  if (m.phase !== 'live') return;
  m.phase = 'post';
  m.phaseTime = ROUND.endDelay;
  m.score[winner]++;
  m.result = { winner, reason };
  m.history.push(winner);
  const loser = winner === 'att' ? 'def' : 'att';
  const winPay = reason.includes('Igniter') ? ECON.winBomb : ECON.win;
  const lossPay = Math.min(ECON.lossMax, ECON.loss + ECON.lossStep * m.lossStreak[loser]);
  m.lossStreak[loser]++;
  m.lossStreak[winner] = 0;
  for (const a of state.actors) {
    a.money = Math.min(ECON.max, a.money + (a.team === winner ? winPay : lossPay));
    a.using = 0;
  }
  const e = emit(state, 'roundEnd');
  e.text = winner;
}
