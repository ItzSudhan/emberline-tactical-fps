// The HUD reads state once a frame and writes the DOM only where a value changed.

import { SIDES, SHOP, WEAPONS, GEAR, ROUND, CELL } from './config.js';
import { KIND, ZONE, COLS, ROWS, roomNameAt } from './mapdata.js';
import { heldWeapon } from './actors.js';
import { spreadOf } from './weapons.js';
import { canBuy, priceOf } from './round.js';
import { fmtTime } from './util.js';

const $ = (id) => document.getElementById(id);
const PX = 5; // minimap pixels per cell

export function createHud() {
  const el = {};
  for (const id of ['hud', 'score-att', 'score-def', 'pips-att', 'pips-def', 'clock', 'timer', 'round-label', 'phase-label', 'minimap', 'location',
    'feed', 'radio', 'crosshair', 'hitmarker', 'hurt', 'center-msg', 'progress', 'progress-label', 'progress-fill', 'hp', 'hp-val', 'hp-bar',
    'armor-val', 'armor-bar', 'money-val', 'carry', 'weapon-name', 'ammo', 'slots', 'scope', 'flash', 'vignette', 'spectate', 'banner',
    'banner-title', 'banner-sub', 'board', 'board-body', 'buy', 'buy-grid', 'buy-msg', 'buy-sub']) el[id] = $(id);
  const ticks = el.crosshair.children;
  const cache = new Map();
  const set = (node, key, value, prop = 'textContent') => {
    if (cache.get(key) === value) return;
    cache.set(key, value);
    node[prop] = value;
  };
  const style = (node, key, prop, value) => {
    const k = key + prop;
    if (cache.get(k) === value) return;
    cache.set(k, value);
    node.style[prop] = value;
  };

  // Static minimap layer, painted once.
  const base = document.createElement('canvas');
  base.width = COLS * PX; base.height = ROWS * PX;
  const mm = el.minimap.getContext('2d');
  let baseDrawn = false;
  function drawBase(map) {
    const g = base.getContext('2d');
    for (let z = 0; z < ROWS; z++) for (let x = 0; x < COLS; x++) {
      const i = z * COLS + x, k = map.kind[i], zone = map.zone[i];
      g.fillStyle = k === KIND.wall ? '#2b211b' : k === KIND.pillar ? '#4a2c22' : k === KIND.crate || k === KIND.barrier ? '#7d6650'
        : k === KIND.tall ? '#2f6d69' : zone === ZONE.siteA || zone === ZONE.siteB ? '#b3784e' : k === KIND.step ? '#a58b72' : '#8a6c53';
      g.fillRect(x * PX, z * PX, PX, PX);
    }
    g.fillStyle = '#ffe2b0'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('A', 5.5 * PX, 8.5 * PX); g.fillText('B', 33.5 * PX, 8.5 * PX);
    baseDrawn = true;
  }

  // Buy menu buttons, built once.
  const buyButtons = SHOP.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = item.id;
    const name = WEAPONS[item.id]?.name ?? GEAR[item.id].name;
    b.innerHTML = `<small>${item.key} · ${item.cat}</small><b>${name}</b><span class="price"></span>`;
    el['buy-grid'].appendChild(b);
    return b;
  });

  let hitT = 0, hitHead = false, bannerT = 0;

  return {
    buyButtons,
    showHud(on) { el.hud.classList.toggle('hidden', !on); },
    flashHit(head) { hitT = 0.18; hitHead = head; },
    buyMessage(text) { el['buy-msg'].textContent = text; },
    setBuyOpen(open) { el.buy.classList.toggle('hidden', !open); if (open) el['buy-msg'].textContent = ''; },
    showBoard(on) { el.board.classList.toggle('hidden', !on); },
    banner(title, sub, color) {
      el['banner-title'].textContent = title;
      el['banner-title'].style.color = color;
      el['banner-sub'].textContent = sub;
      el.banner.classList.remove('hidden');
      bannerT = 3.5;
    },

    update(state, dt, view) {
      const p = state.player, m = state.match, bomb = state.bomb;
      const subject = view.subject;
      if (!baseDrawn) drawBase(state.map);

      // Score, round clock and the alive pips.
      set(el['score-att'], 'sa', String(m.score.att));
      set(el['score-def'], 'sd', String(m.score.def));
      set(el['round-label'], 'rl', `ROUND ${m.round}`);
      const planted = bomb.state === 'planted';
      el.clock.classList.toggle('planted', planted);
      const label = m.phase === 'freeze' ? 'BUY PHASE' : planted ? 'IGNITER LIVE' : m.phase === 'post' ? 'ROUND OVER' : m.phase === 'over' ? 'MATCH OVER' : `FIRST TO ${ROUND.toWin}`;
      set(el['phase-label'], 'pl', label);
      set(el.timer, 'tm', fmtTime(m.phase === 'live' ? m.phaseTime : m.phase === 'freeze' ? m.phaseTime : 0));
      for (const team of ['att', 'def']) {
        let html = '';
        for (const a of state.actors) if (a.team === team) html += a.alive ? '<i></i>' : '<i class="dead"></i>';
        set(el[`pips-${team}`], 'pip' + team, html, 'innerHTML');
      }

      // Vitals and weapon of whoever the camera follows.
      set(el['hp-val'], 'hp', String(Math.max(0, Math.ceil(subject.hp))));
      style(el['hp-bar'], 'hpb', 'width', `${Math.max(0, subject.hp)}%`);
      el.hp.classList.toggle('low', subject.hp <= 25);
      set(el['armor-val'], 'ar', String(Math.ceil(subject.armor)) + (subject.helmet ? '+H' : ''));
      style(el['armor-bar'], 'arb', 'width', `${subject.armor}%`);
      set(el['money-val'], 'mo', `$${subject.money}`);
      const w = heldWeapon(subject);
      if (subject.current === 'nade') {
        const names = { frag: 'Shard Grenade', smoke: 'Veil Smoke', flash: 'Glare Flash' };
        set(el['weapon-name'], 'wn', names[subject.nadeType]);
        set(el.ammo, 'am', `${subject[subject.nadeType]} <span>G to cycle</span>`, 'innerHTML');
      } else if (w) {
        set(el['weapon-name'], 'wn', subject.reloading > 0 ? `${w.def.name} · reloading` : w.def.name);
        set(el.ammo, 'am', `${w.mag} <span>/ ${w.reserve}</span>`, 'innerHTML');
        el.ammo.classList.toggle('empty', w.mag === 0);
      }
      const slots = `<span class="${subject.current === 'primary' ? 'on' : ''}">1 ${subject.primary ? subject.primary.def.name : '-'}</span>`
        + `<span class="${subject.current === 'secondary' ? 'on' : ''}">2 ${subject.secondary.def.name}</span>`
        + `<span class="${subject.current === 'nade' ? 'on' : ''}">4 ◆${subject.frag} ☁${subject.smoke} ✶${subject.flash}</span>`
        + (subject.kit ? '<span>KIT</span>' : '');
      set(el.slots, 'sl', slots, 'innerHTML');
      el.carry.classList.toggle('hidden', !(bomb.carrier === p && p.alive));

      // Crosshair gap follows spread, so it opens when you run and closes when you stop.
      const sp = w ? spreadOf(subject) : 0.02;
      const gap = Math.round(4 + (sp / Math.tan((view.fov * Math.PI) / 360)) * (window.innerHeight / 2));
      const gk = Math.min(gap, 80);
      style(ticks[0], 'c0', 'top', `${-gk - 8}px`);
      style(ticks[1], 'c1', 'top', `${gk}px`);
      style(ticks[2], 'c2', 'left', `${-gk - 8}px`);
      style(ticks[3], 'c3', 'left', `${gk}px`);
      const scoped = subject.scoped;
      el.scope.classList.toggle('hidden', !scoped);
      style(el.crosshair, 'cv', 'visibility', scoped || (w && w.def.kind === 'sniper' && subject === p) ? 'hidden' : 'visible');

      hitT -= dt;
      style(el.hitmarker, 'hmo', 'opacity', hitT > 0 ? '1' : '0');
      el.hitmarker.classList.toggle('head', hitHead);

      // Damage direction: an arc that points toward whoever hit you.
      const since = state.time - subject.hurtTime;
      if (since < 1.2) {
        const ang = Math.atan2(subject.hurtX - subject.pos.x, subject.hurtZ - subject.pos.z);
        const rel = -(ang - (subject.yaw + Math.PI));
        style(el.hurt, 'hr', 'transform', `rotate(${rel}rad)`);
        style(el.hurt, 'ho', 'opacity', String(Math.max(0, 1 - since / 1.2).toFixed(2)));
      } else style(el.hurt, 'ho', 'opacity', '0');
      style(el.flash, 'fl', 'opacity', Math.min(1, subject.flashed / 1.4).toFixed(2));
      style(el.vignette, 'vg', 'opacity', subject.alive ? Math.max(0, (40 - subject.hp) / 40).toFixed(2) : '0');

      // Plant / defuse progress.
      const using = subject.using > 0;
      el.progress.classList.toggle('hidden', !using);
      if (using) {
        const defusing = planted;
        set(el['progress-label'], 'pgl', defusing ? (subject.kit ? 'DEFUSING (KIT)' : 'DEFUSING') : 'PLANTING THE IGNITER');
        const frac = defusing ? bomb.defuseProgress : bomb.plantProgress;
        style(el['progress-fill'], 'pgf', 'width', `${Math.min(100, frac * 100).toFixed(1)}%`);
      }

      // Center prompt.
      let msg = '';
      if (m.phase === 'freeze') msg = `<b>Buy phase</b>Press B to buy · ${state.settings.side === 'att' ? 'plan your hit on A or B' : 'take your positions'}`;
      else if (m.phase === 'live' && m.roundClock < 3) msg = `<b>${state.settings.side === 'att' ? 'Plant the Igniter' : 'Defend Kiln Hall and Silo Court'}</b>`;
      else if (p.alive && bomb.state === 'planted' && p.team === 'def' && Math.hypot(p.pos.x - bomb.x, p.pos.z - bomb.z) < 1.5 && !using) msg = 'Hold E to defuse';
      else if (p.alive && bomb.state === 'dropped' && p.team === 'att' && Math.hypot(p.pos.x - bomb.x, p.pos.z - bomb.z) < 6) msg = 'The Igniter is on the ground, walk over it';
      else if (p.alive && bomb.carrier === p && view.onSite && !using) msg = 'Hold E to plant';
      set(el['center-msg'], 'cm', msg, 'innerHTML');

      // Spectating after death.
      el.spectate.classList.toggle('hidden', subject === p);
      if (subject !== p) set(el.spectate, 'sp', `Spectating ${subject.name} · click for next`);

      // Kill feed and radio.
      let feed = '';
      for (const f of state.feed) {
        if (state.time - f.time > 7) continue;
        const mine = f.killer === 'You' || f.victim === 'You';
        if (!f.victim) feed += `<div><span class="c-${f.killerTeam}">${f.killer}</span><span class="w">${f.weapon}</span></div>`;
        else feed += `<div class="${mine ? 'mine' : ''}"><span class="c-${f.killerTeam}">${f.killer || 'The blast'}</span><span class="w">${f.weapon}${f.headshot ? ' ⊕' : ''}</span><span class="c-${f.victimTeam}">${f.victim}</span></div>`;
      }
      set(el.feed, 'fd', feed, 'innerHTML');
      let radio = '';
      for (const r of state.radio) if (r.team === p.team && state.time - r.time < 5) radio += `<div><span class="c-${r.team}">${r.name}:</span> ${r.text}</div>`;
      set(el.radio, 'rd', radio, 'innerHTML');

      set(el.location, 'lc', roomNameAt(state.map, subject.pos.x, subject.pos.z));
      drawMinimap(state, subject);

      if (!el.buy.classList.contains('hidden')) {
        const can = canBuy(state, p);
        set(el['buy-sub'], 'bs', can ? `Funds $${p.money}. Click or press the key. B or Esc closes.` : 'Buy time is over.');
        for (const b of buyButtons) {
          const id = b.dataset.id;
          const price = priceOf(p, id);
          b.querySelector('.price').textContent = `$${price}`;
          b.classList.toggle('cant', !can || p.money < price || (id === 'kit' && p.team !== 'def'));
          const owned = (WEAPONS[id] && (p.primary?.def.id === id || p.secondary.def.id === id)) || (id === 'helm' && p.helmet) || (id === 'kit' && p.kit);
          b.classList.toggle('owned', !!owned);
        }
      }
      if (!el.board.classList.contains('hidden')) {
        let rows = '';
        for (const team of ['att', 'def']) {
          for (const a of state.actors) {
            if (a.team !== team) continue;
            rows += `<tr class="${a.alive ? '' : 'dead'} ${a === p ? 'me' : ''}"><td class="c-${team}">${a.name}</td><td>${a.kills}</td><td>${a.deaths}</td><td>$${a.money}</td><td>${a.primary ? a.primary.def.name : a.secondary.def.name}</td></tr>`;
          }
        }
        set(el['board-body'], 'bb', rows, 'innerHTML');
      }
      bannerT -= dt;
      if (bannerT <= 0) el.banner.classList.add('hidden');
    },
  };

  function drawMinimap(state, subject) {
    mm.drawImage(base, 0, 0);
    const s = PX / CELL;
    const bomb = state.bomb;
    if (bomb.state === 'dropped' || bomb.state === 'planted') {
      mm.fillStyle = bomb.state === 'planted' && (state.tick & 16) ? '#ff3a1a' : '#ffb03a';
      mm.fillRect(bomb.x * s - 3, bomb.z * s - 3, 6, 6);
    }
    for (const a of state.actors) {
      if (!a.alive) continue;
      const friendly = a.team === state.player.team;
      if (!friendly && state.time - a.seenBy[state.player.team] > 1.5) continue;
      mm.fillStyle = SIDES[a.team].css;
      mm.strokeStyle = friendly ? '#000' : '#fff';
      mm.lineWidth = 1;
      mm.beginPath();
      mm.arc(a.pos.x * s, a.pos.z * s, a === subject ? 4 : 3, 0, Math.PI * 2);
      mm.fill(); mm.stroke();
      if (a === subject) {
        mm.strokeStyle = '#fff';
        mm.beginPath();
        mm.moveTo(a.pos.x * s, a.pos.z * s);
        mm.lineTo(a.pos.x * s - Math.sin(a.yaw) * 10, a.pos.z * s - Math.cos(a.yaw) * 10);
        mm.stroke();
      }
      if (bomb.carrier === a && friendly) { mm.fillStyle = '#ffb03a'; mm.fillRect(a.pos.x * s + 3, a.pos.z * s - 6, 4, 4); }
    }
  }
}
