// Emberline boot and frame loop. The simulation advances in fixed SIM_DT ticks from an accumulator;
// rendering interpolates between ticks. Systems talk to each other through state and its event ring.

import { SIM_DT, SIDES, SHOP } from './config.js';
import { createInput } from './input.js';
import { createControls } from './controls.js';
import { createState, eventAt, EVENT_CAPACITY } from './state.js';
import { setupMatch, buyItem } from './round.js';
import { stepSim } from './sim.js';
import { createView } from './view.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { eyeHeight } from './actors.js';
import { clearLine } from './physics.js';
import { zoneAt, ZONE } from './mapdata.js';
import { runShot } from './shots.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const $ = (id) => document.getElementById(id);

const menuState = createState({ seed: 3 });
const view = createView($('game'), menuState.map);
const hud = createHud();
const audio = createAudio();
const input = createInput(view.renderer.domElement);
const controls = createControls(input);

const app = {
  state: menuState,
  mode: 'menu', // menu | play
  side: 'att',
  difficulty: 'normal',
  acc: 0,
  last: performance.now(),
  cursor: 0,
  buyOpen: false,
  paused: false,
  spectate: null,
  spotT: 0,
  radioSeen: 0,
  frozen: false, // screenshot scenes stop the clock once staged
  frozenFrames: 0,
  postStage: null,
};
const muzzle = { x: 0, y: 0, z: 0, copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }, add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; } };

// ---------- menu ----------
for (const b of document.querySelectorAll('[data-side]')) {
  b.addEventListener('click', () => {
    app.side = b.dataset.side;
    for (const o of document.querySelectorAll('[data-side]')) o.classList.toggle('on', o === b);
  });
}
for (const b of document.querySelectorAll('[data-diff]')) {
  b.addEventListener('click', () => {
    app.difficulty = b.dataset.diff;
    for (const o of document.querySelectorAll('[data-diff]')) o.classList.toggle('on', o === b);
  });
}
$('play').addEventListener('click', () => startMatch());
$('again').addEventListener('click', () => startMatch());
$('resume').addEventListener('click', () => { audio.init(); input.lock(); });
view.renderer.domElement.addEventListener('click', () => {
  audio.init();
  if (app.mode === 'play' && !app.buyOpen && !input.locked) input.lock();
});
for (const b of hud.buyButtons) b.addEventListener('click', () => tryBuy(b.dataset.id));

export function startMatch(opts = {}) {
  if (!opts.noLock) audio.init(); // browsers only allow audio after a click
  const state = createState({
    seed: opts.seed ?? (Date.now() % 100000),
    side: opts.side ?? app.side,
    difficulty: opts.difficulty ?? app.difficulty,
    autoplay: !!opts.autoplay,
  });
  setupMatch(state);
  app.state = state;
  app.mode = 'play';
  app.cursor = state.eventCount;
  app.acc = 0;
  app.spectate = null;
  view.bindActors(state);
  view.fx.clear();
  $('menu').classList.add('hidden');
  $('over').classList.add('hidden');
  hud.showHud(true);
  if (!opts.noLock) input.lock();
  return state;
}

function tryBuy(id) {
  const msg = buyItem(app.state, app.state.player, id);
  hud.buyMessage(msg || 'Purchased');
  if (msg) audio.error(); else audio.cash();
}

function setBuy(open) {
  app.buyOpen = open;
  hud.setBuyOpen(open);
  if (open) input.unlock(); else input.lock();
}

document.addEventListener('pointerlockchange', () => {
  app.paused = app.mode === 'play' && !input.locked && !app.buyOpen && app.state.match.phase !== 'over' && !app.frozen;
  $('pause').classList.toggle('hidden', !app.paused);
});
window.addEventListener('resize', () => view.resize());

// ---------- per frame ----------
function handleKeys(state) {
  const p = state.player;
  for (const code of input.takePresses()) {
    if (app.mode !== 'play') continue;
    if (code === 'KeyB' && state.match.phase !== 'over') { setBuy(!app.buyOpen); continue; }
    if (app.buyOpen) {
      if (code === 'Escape') { setBuy(false); continue; }
      const item = SHOP.find((s) => `Digit${s.key}` === code || (s.key === '-' && code === 'Minus'));
      if (item) tryBuy(item.id);
      continue;
    }
    controls.press(p, code);
  }
}

function subjectOf(state) {
  const p = state.player;
  if (p.alive) { app.spectate = null; return p; }
  if (!app.spectate || !app.spectate.alive) app.spectate = state.actors.find((a) => a.alive && a.team === p.team) ?? p;
  return app.spectate;
}

function cycleSpectate(state) {
  const mates = state.actors.filter((a) => a.alive && a.team === state.player.team);
  if (!mates.length) return;
  const i = mates.indexOf(app.spectate);
  app.spectate = mates[(i + 1) % mates.length];
}

// The player's own eyes mark enemies on the minimap, five times a second.
function spotEnemies(state, dt) {
  app.spotT -= dt;
  if (app.spotT > 0) return;
  app.spotT = 0.2;
  const p = state.player;
  if (!p.alive) return;
  const ex = p.pos.x, ey = p.pos.y + eyeHeight(p), ez = p.pos.z;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  for (const e of state.actors) {
    if (!e.alive || e.team === p.team) continue;
    const dx = e.pos.x - ex, dz = e.pos.z - ez, d = Math.hypot(dx, dz);
    if ((dx * fx + dz * fz) / (d || 1) < 0.5) continue;
    if (clearLine(state.map, ex, ey, ez, e.pos.x, e.pos.y + 1.4, e.pos.z)) e.seenBy[p.team] = state.time;
  }
}

function consumeEvents(state, subject) {
  const p = state.player;
  if (state.eventCount - app.cursor > EVENT_CAPACITY) app.cursor = state.eventCount - EVENT_CAPACITY;
  for (; app.cursor < state.eventCount; app.cursor++) {
    const e = eventAt(state, app.cursor);
    const mine = e.actor === subject;
    switch (e.type) {
      case 'shot':
        audio.shot(e.text, e.x, e.z, mine);
        if (mine) view.kick(e.text === 'sniper' || e.text === 'shotgun' ? 1.4 : 0.7);
        else view.fx.muzzle(e.x - Math.sin(e.actor.yaw) * 0.7, e.y - 0.25, e.z - Math.cos(e.actor.yaw) * 0.7);
        break;
      case 'tracer':
        if (mine) { view.muzzleWorld(muzzle); view.fx.tracer(muzzle.x, muzzle.y, muzzle.z, e.a, e.b, e.c); view.fx.muzzle(muzzle.x, muzzle.y, muzzle.z); }
        else view.fx.tracer(e.x - Math.sin(e.actor.yaw) * 0.6, e.y - 0.25, e.z - Math.cos(e.actor.yaw) * 0.6, e.a, e.b, e.c);
        break;
      case 'impact': view.fx.impact(e.x, e.y, e.z, e.a, e.b, e.c); break;
      case 'blood': view.fx.blood(e.x, e.y, e.z, e.a, e.b, e.c, e.text === 'head'); break;
      case 'hit':
        if (e.actor === p) { hud.flashHit(e.text === 'head'); audio.hitmark(e.text === 'head'); }
        if (e.other === subject) { audio.hurt(); view.shake(0.03); }
        break;
      case 'death':
        if (e.other === p) hud.banner('Eliminated', e.actor ? `by ${e.actor.name} · ${e.text}` : 'by the blast', '#ff5a3c');
        break;
      case 'step': case 'land': audio.step(e.x, e.z, mine); break;
      case 'reload': audio.click(e.x, e.z, 0.8); break;
      case 'reloaded': audio.click(e.x, e.z, 1.2); break;
      case 'dry': audio.dry(e.x, e.z); break;
      case 'scope': if (mine) audio.scope(); break;
      case 'bounce': audio.bounce(e.x, e.z); break;
      case 'explode': view.fx.blast(e.x, e.y, e.z, false); audio.explosion(e.x, e.z); view.shake(0.02); break;
      case 'smoke': audio.smoke(e.x, e.z); break;
      case 'flash': view.fx.flash(e.x, e.y, e.z); audio.flashbang(e.x, e.z, subject.flashed); break;
      case 'beep': audio.beep(e.x, e.z); break;
      case 'planted': audio.planted(); hud.banner('Igniter planted', `Site ${state.bomb.site} · 40 seconds`, SIDES.att.css); break;
      case 'defused': audio.planted(); break;
      case 'igniterBlast': view.fx.blast(e.x, e.y, e.z, true); audio.explosion(e.x, e.z); view.shake(0.08); break;
      case 'roundEnd': {
        const r = state.match.result;
        audio.stinger(r.winner === p.team);
        hud.banner(`${SIDES[r.winner].name} take the round`, r.reason, SIDES[r.winner].css);
        break;
      }
      case 'roundStart': view.fx.clear(); break;
      case 'matchOver': showOver(state); break;
      default: break;
    }
  }
  if (state.radio.length && state.radio[state.radio.length - 1].time > app.radioSeen) {
    const r = state.radio[state.radio.length - 1];
    app.radioSeen = r.time;
    if (r.team === p.team) audio.radio();
  }
}

function showOver(state) {
  const p = state.player, m = state.match;
  const won = m.score[p.team] > m.score[p.team === 'att' ? 'def' : 'att'];
  $('over-title').textContent = won ? 'Victory' : 'Defeat';
  $('over-title').style.color = won ? SIDES[p.team].css : '#ff5a3c';
  $('over-sub').textContent = `${SIDES.att.name} ${m.score.att} : ${m.score.def} ${SIDES.def.name} · you went ${p.kills} kills, ${p.deaths} deaths`;
  $('over').classList.remove('hidden');
  input.unlock();
}

function frame(now) {
  // A frozen (screenshot) scene renders with zero elapsed time so effects hold still.
  const dt = app.frozen ? 0 : Math.min(0.1, (now - app.last) / 1000);
  app.last = now;
  const state = app.state;
  if (app.frozen && ++app.frozenFrames === 2 && app.postStage) app.postStage();
  if (app.frozen && app.frozenFrames > 4) window.__shotReady = true;
  if (app.mode === 'menu') {
    view.render(state, 1, dt, state.player, true);
    requestAnimationFrame(frame);
    return;
  }
  handleKeys(state);
  const p = state.player;
  if (input.locked && p.alive) {
    view.sway(-input.mouse.dx, input.mouse.dy);
    controls.look(p, view.fov / 78);
  } else if (input.locked && input.mouse.left) {
    input.mouse.left = false;
    cycleSpectate(state);
  } else input.takeMouse();

  if (!app.paused && !app.frozen) {
    app.acc += dt;
    while (app.acc >= SIM_DT) {
      controls.fill(p, input.locked && !app.buyOpen && p.alive);
      stepSim(state, SIM_DT);
      app.acc -= SIM_DT;
    }
  }
  const alpha = app.frozen ? 1 : app.acc / SIM_DT;
  const subject = subjectOf(state);
  spotEnemies(state, dt);
  consumeEvents(state, subject);
  audio.setListener(subject.pos.x, subject.pos.z, subject.yaw);
  if (app.buyOpen && state.match.phase !== 'freeze' && state.match.roundClock > 20) setBuy(false);
  hud.showBoard(input.down('Tab') || state.match.phase === 'over');
  const zone = zoneAt(state.map, p.pos.x, p.pos.z);
  view.render(state, alpha, dt, subject, false);
  hud.update(state, dt, { subject, fov: view.fov, onSite: zone === ZONE.siteA || zone === ZONE.siteB });
  requestAnimationFrame(frame);
}

// ?demo: watch a bot-only match from the player's seat (the player slot is driven by a bot brain).
if (params.has('demo')) startMatch({ autoplay: true, noLock: true, seed: Number(params.get('seed') ?? 5) });
if (shotName) {
  // Screenshot mode: stage a scene from shots.js, render it, then signal the capture script.
  runShot(shotName, { app, startMatch, view, hud, stepSim, setBuy: (open) => { app.buyOpen = open; hud.setBuyOpen(open); } });
}
requestAnimationFrame(frame);
