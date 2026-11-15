// The HUD: health, armour, money, ammunition, the round clock and the score; who is alive, the
// minimap, the kill feed and the squad radio; name tags over squadmates and a marker on the
// Igniter; the buy menu and the scoreboard. It reads state and writes the DOM only where a value
// changed: numbers that move every frame are compared before any string is built, and the text
// panels are rebuilt ten times a second.

import { SIDES, heldWeapon } from './state.js';
import { CELL, KIND, ZONE, COLS, ROWS, SITES, roomNameAt } from './map-kilnworks.js';
import { WEAPONS } from './weapons.js';
import { spreadOf } from './recoil-spread.js';
import { BOMB } from './bomb-plant-defuse.js';
import { ECON, SHOP, itemInfo, canBuy, priceOf, lossBonus } from './economy-buy.js';
import { ROUND } from './rounds-halftime.js';

const PX = 5; // minimap pixels per cell
const TAGS = 7; // pooled world labels: four squadmates, the Igniter, two sites
const IDS = ['hud', 'score-att', 'score-def', 'pips-att', 'pips-def', 'team-att', 'team-def', 'history', 'clock', 'timer', 'round-label',
  'phase-label', 'minimap', 'location', 'feed', 'radio', 'crosshair', 'hitmarker', 'dmg', 'hurt', 'center-msg', 'progress', 'progress-label',
  'progress-fill', 'hp', 'hp-val', 'hp-bar', 'armor-val', 'armor-bar', 'money-val', 'stance', 'weapon-name', 'ammo', 'slots', 'scope', 'flash',
  'vignette', 'spectate', 'tags', 'banner', 'banner-title', 'banner-sub', 'board', 'board-head', 'board-body', 'buy', 'buy-funds', 'buy-grid',
  'buy-squad', 'buy-msg', 'buy-sub'];
const pct = (v) => `${Math.round(Math.max(0.04, Math.min(1, v)) * 100)}%`;
const carried = (a) => (a.primary ? a.primary.def.name : a.secondary.def.name);
const clock = (sec) => { const s = Math.max(0, Math.ceil(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// What the buy menu says under an item: the numbers and four bars for a gun, one line for gear.
function describe(id) {
  const w = WEAPONS[id];
  if (!w) return `<i>${itemInfo(id).note}</i>`;
  const bar = (label, v) => `<span class="bar">${label}<b style="width:${pct(v)}"></b></span>`;
  return `<i>${w.dmg}${w.pellets > 1 ? `×${w.pellets}` : ''} dmg · ${w.rpm} rpm · ${w.mag}/${w.reserve}</i>`
    + `<span class="bars">${bar('DMG', (w.dmg * w.pellets) / 130)}${bar('RATE', w.rpm / 850)}${bar('AIM', 1 - w.spread / 0.06)}${bar('MOVE', (w.speed - 0.7) / 0.3)}</span>`;
}

export function createHud() {
  const el = {};
  for (const id of IDS) el[id] = document.getElementById(id);
  const ticks = el.crosshair.children;
  const teams = [['att', el['pips-att'], el['team-att']], ['def', el['pips-def'], el['team-def']]];
  const cache = new Map();
  // Each writer skips the DOM when the value is the one it wrote last.
  const text = (node, key, value, prop = 'textContent') => { if (cache.get(key) !== value) { cache.set(key, value); node[prop] = value; } };
  const num = (node, key, prop, value, unit = '') => { if (cache.get(key) !== value) { cache.set(key, value); node.style[prop] = value + unit; } };
  const flag = (node, key, cls, on) => { if (cache.get(key) !== on) { cache.set(key, on); node.classList.toggle(cls, on); } };

  // Static minimap layer, painted once.
  const base = document.createElement('canvas');
  base.width = COLS * PX; base.height = ROWS * PX;
  const mm = el.minimap.getContext('2d');
  let baseDrawn = false;
  function drawBase(map) {
    const g = base.getContext('2d');
    for (let z = 0; z < ROWS; z++) for (let x = 0; x < COLS; x++) {
      const i = z * COLS + x, k = map.kind[i], zone = map.zone[i];
      g.fillStyle = k === KIND.wall ? '#2b211b' : k === KIND.pillar ? '#4a2c22' : k === KIND.crate || k === KIND.pots || k === KIND.barrier ? '#7d6650'
        : k === KIND.tall ? '#2f6d69' : zone === ZONE.siteA || zone === ZONE.siteB ? '#b3784e' : k === KIND.step ? '#a58b72' : '#8a6c53';
      g.fillRect(x * PX, z * PX, PX, PX);
    }
    g.fillStyle = '#ffe2b0'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const site of ['A', 'B']) g.fillText(site, (SITES[site].x / CELL) * PX, (SITES[site].z / CELL) * PX);
    baseDrawn = true;
  }

  // Buy menu buttons and world labels, built once.
  const buyButtons = SHOP.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = item.id;
    b.innerHTML = `<small>${item.key} · ${item.cat}</small><b>${itemInfo(item.id).name}</b>${describe(item.id)}<span class="price"></span>`;
    el['buy-grid'].appendChild(b);
    return b;
  });
  const prices = buyButtons.map((b) => b.querySelector('.price'));
  const tags = [];
  for (let i = 0; i < TAGS; i++) tags.push({ node: el.tags.appendChild(document.createElement('div')), t: `t${i}`, c: `c${i}`, x: `x${i}`, y: `y${i}`, h: `h${i}` });

  let hitT = 0, hitHead = false, dmgT = 0, bannerT = 0, frames = 0, buyOpen = false, boardOpen = false, goalLabel = 'IGNITER';

  // Pins the next pooled label over a point in the world, if that point is on screen.
  function tag(n, view, x, y, z, label, cls) {
    const at = view.project(x, y, z);
    if (!at || n >= TAGS) return n;
    const t = tags[n];
    text(t.node, t.t, label);
    text(t.node.dataset, t.c, cls, 'kind');
    num(t.node, t.x, 'left', at.x, 'px');
    num(t.node, t.y, 'top', at.y, 'px');
    return n + 1;
  }

  // Every frame: only numbers and class flags.
  function fast(state, dt, view, subject) {
    const w = heldWeapon(subject);
    // The crosshair gap is the weapon's spread cone projected on screen: it opens when you run or
    // spray and closes when you stop, so the HUD shows exactly where the next round can go.
    const gap = Math.min(80, Math.round(4 + ((w ? spreadOf(subject) : 0.02) / Math.tan((view.fov * Math.PI) / 360)) * (window.innerHeight / 2)));
    num(ticks[0], 'c0', 'top', -gap - 8, 'px');
    num(ticks[1], 'c1', 'top', gap, 'px');
    num(ticks[2], 'c2', 'left', -gap - 8, 'px');
    num(ticks[3], 'c3', 'left', gap, 'px');
    flag(el.scope, 'sc', 'hidden', !subject.scoped);
    flag(el.crosshair, 'ch', 'hidden', subject.scoped || (!!w && w.def.kind === 'sniper'));
    hitT -= dt; dmgT -= dt; bannerT -= dt;
    num(el.hitmarker, 'hm', 'opacity', hitT > 0 ? 1 : 0);
    flag(el.hitmarker, 'hh', 'head', hitHead);
    num(el.dmg, 'dm', 'opacity', dmgT > 0 ? 1 : 0);
    flag(el.banner, 'bn', 'hidden', bannerT <= 0);
    // Damage direction: an arc that points toward whoever hit you.
    const since = state.time - subject.hurtTime;
    if (since < 1.2) {
      const rel = subject.yaw + Math.PI - Math.atan2(subject.hurtX - subject.pos.x, subject.hurtZ - subject.pos.z);
      num(el.hurt, 'hr', 'rotate', Math.round(rel * 20) / 20, 'rad');
    }
    num(el.hurt, 'ho', 'opacity', since < 1.2 ? Math.round((1 - since / 1.2) * 10) / 10 : 0);
    num(el.flash, 'fl', 'opacity', Math.round(Math.min(1, subject.flashed / 1.4) * 20) / 20);
    num(el.vignette, 'vg', 'opacity', subject.alive ? Math.round(Math.max(0, (40 - subject.hp) / 40) * 10) / 10 : 0);
    const bomb = state.bomb, using = subject.using > 0;
    flag(el.progress, 'pg', 'hidden', !using);
    if (using) num(el['progress-fill'], 'pf', 'width', Math.round(Math.min(1, bomb.state === 'planted' ? bomb.defuseProgress : bomb.plantProgress) * 200) / 2, '%');

    // World labels: squadmates' names, the Igniter when it is down, the sites while you carry it.
    let n = 0;
    for (const a of state.actors) if (a !== subject && a.alive && a.team === subject.team) n = tag(n, view, a.pos.x, a.pos.y + 2.05, a.pos.z, a.name, a.team);
    if (bomb.state === 'planted' || bomb.state === 'dropped') n = tag(n, view, bomb.x, bomb.y + 0.9, bomb.z, goalLabel, 'goal');
    else if (bomb.carrier === subject) {
      n = tag(n, view, SITES.A.x, 2.4, SITES.A.z, 'PLANT A', 'goal');
      n = tag(n, view, SITES.B.x, 2.4, SITES.B.z, 'PLANT B', 'goal');
    }
    for (let i = 0; i < TAGS; i++) flag(tags[i].node, tags[i].h, 'hidden', i >= n);
  }

  // Ten times a second: everything that is text.
  function panels(state, view, subject) {
    const p = state.player, m = state.match, bomb = state.bomb;
    const planted = bomb.state === 'planted';

    // Score, round clock, who is alive and how the rounds have gone.
    text(el['score-att'], 'sa', m.score.att);
    text(el['score-def'], 'sd', m.score.def);
    text(el['round-label'], 'rl', `ROUND ${m.round} · ${m.round > ROUND.half ? '2ND' : '1ST'} HALF`);
    flag(el.clock, 'cp', 'planted', planted);
    text(el['phase-label'], 'pl', m.phase === 'freeze' ? 'BUY PHASE' : planted ? 'IGNITER LIVE' : m.phase === 'post' ? 'ROUND OVER' : m.phase === 'over' ? 'MATCH OVER' : `FIRST TO ${ROUND.toWin}`);
    text(el.timer, 'tm', clock(m.phase === 'live' || m.phase === 'freeze' ? m.phaseTime : 0));
    for (const [team, pips, panel] of teams) {
      let html = '';
      for (const a of state.actors) if (a.team === team) html += a.alive ? '<i></i>' : '<i class="dead"></i>';
      text(pips, team, html, 'innerHTML');
      flag(panel, team + 'm', 'mine', team === p.team);
    }
    let history = '';
    for (const winner of m.history) history += `<i class="${winner}"></i>`;
    text(el.history, 'hi', history, 'innerHTML');

    // Vitals, stance and weapon of whoever the camera follows.
    text(el['hp-val'], 'hp', Math.max(0, Math.ceil(subject.hp)));
    num(el['hp-bar'], 'hb', 'width', Math.max(0, subject.hp), '%');
    flag(el.hp, 'hl', 'low', subject.hp <= 25);
    text(el['armor-val'], 'ar', Math.ceil(subject.armor) + (subject.helmet ? '+H' : ''));
    num(el['armor-bar'], 'ab', 'width', Math.ceil(subject.armor), '%');
    text(el['money-val'], 'mo', `$${subject.money}`);
    const speed = Math.hypot(subject.vel.x, subject.vel.z);
    const stance = !subject.grounded ? 'AIRBORNE' : subject.crouch > 0.5 ? 'CROUCHED' : speed > 3 ? 'RUNNING' : speed > 0.5 ? 'WALKING' : 'STEADY';
    text(el.stance, 'st', `${stance} · SPREAD ${((spreadOf(subject) * 180) / Math.PI).toFixed(1)}°`);
    const w = heldWeapon(subject);
    if (w) {
      text(el['weapon-name'], 'wn', `${w.def.name} · ${subject.reloading > 0 ? 'RELOADING' : w.def.auto ? 'AUTO' : 'SEMI'}`);
      text(el.ammo, 'am', `${w.mag} <span>/ ${w.reserve}</span>`, 'innerHTML');
    } else {
      text(el['weapon-name'], 'wn', itemInfo(subject.nadeType).name);
      text(el.ammo, 'am', `${subject[subject.nadeType]} <span>G to cycle</span>`, 'innerHTML');
    }
    flag(el.ammo, 'ae', 'empty', !!w && w.mag === 0);
    const slot = (on, label) => `<span class="${on ? 'on' : ''}">${label}</span>`;
    text(el.slots, 'sl', slot(subject.current === 'primary', `1 ${subject.primary ? subject.primary.def.name : '—'}`) + slot(subject.current === 'secondary', `2 ${subject.secondary.def.name}`)
      + slot(subject.current === 'nade', `4 FRAG ${subject.frag} · SMOKE ${subject.smoke} · FLASH ${subject.flash}`)
      + (subject.kit ? '<span class="on">KIT</span>' : '') + (bomb.carrier === subject ? '<span class="on">IGNITER</span>' : ''), 'innerHTML');
    if (subject.using > 0) text(el['progress-label'], 'pl2', planted ? (subject.kit ? 'DEFUSING THE IGNITER · KIT' : 'DEFUSING THE IGNITER') : 'PLANTING THE IGNITER');
    goalLabel = planted ? `IGNITER ${clock(bomb.timer)}` : 'IGNITER DROPPED';

    // Centre prompt.
    let msg = '';
    if (m.phase === 'freeze') msg = `<b>Buy phase</b>Press B to buy · ${p.team === 'att' ? 'plan your hit on A or B' : 'take your positions'}`;
    else if (m.phase === 'live' && m.roundClock < 3) msg = `<b>${p.team === 'att' ? 'Plant the Igniter' : 'Defend Kiln Hall and Silo Court'}</b>`;
    else if (p.alive && planted && p.team === 'def' && Math.hypot(p.pos.x - bomb.x, p.pos.z - bomb.z) < BOMB.reach && p.using === 0) msg = 'Hold E to defuse';
    else if (p.alive && bomb.state === 'dropped' && p.team === 'att' && Math.hypot(p.pos.x - bomb.x, p.pos.z - bomb.z) < 6) msg = 'The Igniter is on the ground, walk over it';
    else if (p.alive && bomb.carrier === p && view.onSite && p.using === 0) msg = 'Hold E to plant';
    text(el['center-msg'], 'cm', msg, 'innerHTML');
    flag(el.spectate, 'sp', 'hidden', subject === p);
    if (subject !== p) text(el.spectate, 'spt', `Spectating ${subject.name} · click for next`);

    // Kill feed, radio and where you are.
    let feed = '';
    for (const f of state.feed) {
      if (state.time - f.time > 7) continue;
      if (!f.victim) feed += `<div><span class="c-${f.killerTeam}">${f.killer}</span><span class="w">${f.weapon}</span></div>`;
      else feed += `<div class="${f.killer === p.name || f.victim === p.name ? 'mine' : ''}"><span class="c-${f.killerTeam}">${f.killer || 'The blast'}</span><span class="w">${f.weapon}${f.headshot ? ' <b>HS</b>' : ''}</span><span class="c-${f.victimTeam}">${f.victim}</span></div>`;
    }
    text(el.feed, 'fd', feed, 'innerHTML');
    let radio = '';
    for (const r of state.radio) if (r.team === p.team && state.time - r.time < 6) radio += `<div><span class="c-${r.team}">${r.name}:</span> ${r.text}</div>`;
    text(el.radio, 'rd', radio, 'innerHTML');
    text(el.location, 'lc', roomNameAt(state.map, subject.pos.x, subject.pos.z));

    if (buyOpen) {
      const can = canBuy(state, p);
      text(el['buy-funds'], 'bf', `$${p.money}`);
      text(el['buy-sub'], 'bs', can ? `Click an item or press its key; B or Esc closes. This round pays $${ECON.win} for a win, $${lossBonus(state, p.team)} for a loss, $${ECON.kill} a kill.` : 'Buy time is over.');
      for (let i = 0; i < buyButtons.length; i++) {
        const id = SHOP[i].id, price = priceOf(p, id);
        text(prices[i], 'pr' + i, `$${price}`);
        flag(buyButtons[i], 'bc' + i, 'cant', !can || p.money < price || (id === 'kit' && p.team !== 'def'));
        flag(buyButtons[i], 'bo' + i, 'owned', (!!WEAPONS[id] && (p.primary?.def.id === id || p.secondary.def.id === id)) || (id === 'vest' && p.armor >= 100) || (id === 'helm' && p.helmet) || (id === 'kit' && p.kit));
      }
      let squad = '';
      for (const a of state.actors) if (a.team === p.team) squad += `<span class="${a === p ? 'me' : ''}">${a.name} <b>$${a.money}</b> ${carried(a)}</span>`;
      text(el['buy-squad'], 'bq', squad, 'innerHTML');
    }
    if (boardOpen) {
      text(el['board-head'], 'bh', `<b class="c-att">${SIDES.att.name} ${m.score.att}</b> : <b class="c-def">${m.score.def} ${SIDES.def.name}</b><span>round ${m.round} · first to ${ROUND.toWin} · ★ round MVP</span>`, 'innerHTML');
      let rows = '';
      for (const [team] of teams) for (const a of state.actors) {
        if (a.team !== team) continue;
        rows += `<tr class="${a.alive ? '' : 'dead'} ${a === p ? 'me' : ''}"><td class="c-${team}">${a.name}${m.result && m.result.mvp === a ? ' ★' : ''}</td><td>${a.kills}</td><td>${a.assists}</td><td>${a.deaths}</td>`
          + `<td>${a.damage}</td><td>${a.kills ? Math.round((a.headKills / a.kills) * 100) : 0}%</td><td>$${a.money}</td><td>${carried(a)}</td></tr>`;
      }
      text(el['board-body'], 'bb', rows, 'innerHTML');
    }
  }

  function drawMinimap(state, subject) {
    mm.drawImage(base, 0, 0);
    const s = PX / CELL;
    const bomb = state.bomb;
    if (bomb.state === 'dropped' || bomb.state === 'planted') {
      mm.fillStyle = bomb.state === 'planted' && (state.tick & 16) ? '#ff3a1a' : '#ffb03a';
      mm.fillRect(bomb.x * s - 4, bomb.z * s - 4, 8, 8);
    }
    for (const a of state.actors) {
      if (!a.alive) continue;
      const friendly = a.team === state.player.team;
      // Enemies show only while one of your side has eyes on them.
      if (!friendly && state.time - a.seenBy[state.player.team] > 1.5) continue;
      mm.fillStyle = SIDES[a.team].css;
      mm.strokeStyle = friendly ? '#000' : '#fff';
      mm.lineWidth = 1;
      mm.beginPath();
      mm.arc(a.pos.x * s, a.pos.z * s, a === subject ? 4.5 : 3.5, 0, Math.PI * 2);
      mm.fill(); mm.stroke();
      if (a === subject) {
        mm.strokeStyle = '#fff';
        mm.beginPath();
        mm.moveTo(a.pos.x * s, a.pos.z * s);
        mm.lineTo(a.pos.x * s - Math.sin(a.yaw) * 11, a.pos.z * s - Math.cos(a.yaw) * 11);
        mm.stroke();
      }
      if (bomb.carrier === a && friendly) { mm.fillStyle = '#ffb03a'; mm.fillRect(a.pos.x * s + 3, a.pos.z * s - 6, 4, 4); }
    }
  }

  return {
    buyButtons,
    showHud(on) { el.hud.classList.toggle('hidden', !on); },
    flashHit(head, dmg) { hitT = 0.18; dmgT = 0.7; hitHead = head; text(el.dmg, 'dv', head ? `HEADSHOT -${dmg}` : `-${dmg}`); flag(el.dmg, 'dh', 'head', head); },
    buyMessage(msg) { el['buy-msg'].textContent = msg; },
    setBuyOpen(open) { buyOpen = open; el.buy.classList.toggle('hidden', !open); el['buy-msg'].textContent = ''; },
    showBoard(on) { boardOpen = on; flag(el.board, 'bd', 'hidden', !on); },
    banner(title, sub, color) {
      el['banner-title'].textContent = title;
      el['banner-title'].style.color = color;
      el['banner-sub'].textContent = sub;
      bannerT = 3.5;
    },
    update(state, dt, view) {
      if (!baseDrawn) drawBase(state.map);
      fast(state, dt, view, view.subject);
      if (frames++ % 6 === 0) panels(state, view, view.subject);
      drawMinimap(state, view.subject);
    },
  };
}
