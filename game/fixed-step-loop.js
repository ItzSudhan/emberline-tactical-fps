// Emberline boot and frame loop. The simulation advances in fixed SIM_DT ticks from an accumulator
// and never sees a frame time; rendering interpolates between the last two ticks. Systems never
// call each other: stepSim mutates `state`, and the view, HUD and audio read it and drain its event
// ring once a frame. Nothing in the loop allocates: events, particles, tracers and marks are pooled.

import { SIM_DT, SIDES, createState, eventAt, EVENT_CAPACITY } from './state.js';
import { ZONE, zoneAt } from './map-kilnworks.js';
import { createControls } from './mouselook.js';
import { eyeHeight, clearLine } from './movement-collision.js';
import { SHOP, buyItem } from './economy-buy.js';
import { BOMB } from './bomb-plant-defuse.js';
import { createHud } from './hud.js';
import { setupMatch, stepSim } from './rounds-halftime.js';
import { createView } from './view.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';

const MAX_FRAME = 0.1; // seconds: a stalled tab never makes the fixed-step simulation catch up more than this
const params = new URLSearchParams(location.search);
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
  cursor: 0, // how far into the event ring this frame loop has read
  buyOpen: false,
  paused: false,
  spectate: null,
  spotT: 0,
  radioSeen: 0,
  // Demo mode only (see the end of this file): a clock multiplier, a stopped clock, and an observer
  // that may stop it.
  speed: 1,
  hold: false,
  pauseWhen: null,
};
const muzzle = { x: 0, y: 0, z: 0 };
const seen = { subject: null, fov: 78, onSite: false, project: view.project }; // what the HUD is told about the view, reused every frame

// ---------- menu ----------
function choice(attr, key) {
  const buttons = document.querySelectorAll(`[data-${attr}]`);
  for (const b of buttons) {
    b.addEventListener('click', () => {
      app[key] = b.dataset[attr];
      for (const o of buttons) o.classList.toggle('on', o === b);
    });
  }
}
choice('side', 'side');
choice('diff', 'difficulty');
$('play').addEventListener('click', () => startMatch());
$('again').addEventListener('click', () => startMatch());
$('resume').addEventListener('click', () => { audio.init(); input.lock(); });
view.renderer.domElement.addEventListener('click', () => {
  audio.init();
  if (app.mode === 'play' && !app.buyOpen && !input.locked) input.lock();
});
for (const b of hud.buyButtons) b.addEventListener('click', () => tryBuy(b.dataset.id));

function startMatch(opts = {}) {
  if (!opts.demo) audio.init(); // browsers only allow audio after a click
  const state = createState({
    seed: opts.seed ?? (Date.now() % 100000),
    side: opts.side ?? app.side,
    difficulty: opts.difficulty ?? app.difficulty,
    autoplay: !!opts.demo,
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
  if (!opts.demo) input.lock();
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
  app.paused = app.mode === 'play' && !input.locked && !app.buyOpen && !app.state.settings.autoplay && app.state.match.phase !== 'over';
  $('pause').classList.toggle('hidden', !app.paused);
});
window.addEventListener('resize', () => view.resize());

// ---------- per frame ----------
function handleKeys(state) {
  const presses = input.presses;
  for (let i = 0; i < presses.length; i++) {
    const code = presses[i];
    if (code === 'KeyB' && state.match.phase !== 'over') setBuy(!app.buyOpen);
    else if (!app.buyOpen) controls.press(state.player, code);
    else if (code === 'Escape') setBuy(false);
    else {
      const item = SHOP.find((s) => `Digit${s.key}` === code || (s.key === '-' && code === 'Minus'));
      if (item) tryBuy(item.id);
    }
  }
  presses.length = 0;
}

// Whose eyes the camera uses: the player, or a living teammate once the player is down.
function subjectOf(state) {
  const p = state.player;
  if (p.alive) { app.spectate = null; return p; }
  if (!app.spectate || !app.spectate.alive) app.spectate = nextMate(state, null) ?? p;
  return app.spectate;
}

function nextMate(state, after) {
  const actors = state.actors, n = actors.length;
  const from = after ? actors.indexOf(after) : -1;
  for (let k = 1; k <= n; k++) {
    const a = actors[(from + k) % n];
    if (a.alive && a.team === state.player.team && a !== state.player) return a;
  }
  return null;
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

// Turns this frame's simulation events into effects, sounds and banners.
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
      case 'impact': view.fx.impact(e.x, e.y, e.z, e.a, e.b, e.c, e.text === 'wood'); break;
      case 'blood': view.fx.blood(e.x, e.y, e.z, e.a, e.b, e.c, e.text === 'head'); break;
      case 'hit':
        if (e.actor === p) { hud.flashHit(e.text === 'head', e.a); audio.hitmark(e.text === 'head'); }
        if (e.other === subject) { audio.hurt(); view.shake(0.03); }
        break;
      case 'death':
        if (e.other === p) hud.banner('Eliminated', e.actor ? `by ${e.actor.name} · ${e.text}` : 'by the blast', '#ff5a3c');
        break;
      case 'step': case 'land': audio.step(e.x, e.z, mine); break;
      case 'reload': audio.click(e.x, e.z, 0.8); break;
      case 'reloaded': case 'pickup': case 'planting': case 'defusing': audio.click(e.x, e.z, 1.2); break;
      case 'dry': audio.dry(e.x, e.z); break;
      case 'scope': if (mine) audio.scope(); break;
      case 'throw': case 'bounce': audio.bounce(e.x, e.z); break;
      case 'explode': view.fx.blast(e.x, e.y, e.z, false); audio.explosion(e.x, e.z); view.shake(0.02); break;
      case 'smoke': audio.smoke(e.x, e.z); break;
      case 'flash': view.fx.flash(e.x, e.y, e.z); audio.flashbang(e.x, e.z, subject.flashed); break;
      case 'beep': audio.beep(e.x, e.z); break;
      case 'planted': audio.planted(); hud.banner('Igniter planted', `Site ${state.bomb.site} · ${BOMB.fuse} seconds on the fuse`, SIDES.att.css); break;
      case 'defused': audio.planted(); break;
      case 'igniterBlast': view.fx.blast(e.x, e.y, e.z, true); audio.explosion(e.x, e.z); view.shake(0.08); break;
      case 'roundEnd': {
        const r = state.match.result;
        audio.stinger(r.winner === p.team);
        hud.banner(`${SIDES[r.winner].name} take the round`, `${r.reason} · MVP ${r.mvp.name} · win +$${r.winPay}, loss +$${r.lossPay}`, SIDES[r.winner].css);
        break;
      }
      case 'roundStart':
        view.fx.clear();
        if (e.text === 'swap') { view.bindActors(state); hud.banner('Half time', `Sides swap: you now ${SIDES[p.team].verb}`, SIDES[p.team].css); }
        break;
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
  $('over-sub').textContent = `${SIDES.att.name} ${m.score.att} : ${m.score.def} ${SIDES.def.name} · you went ${p.kills} kills, ${p.assists} assists, ${p.deaths} deaths`;
  $('over').classList.remove('hidden');
  input.unlock();
}

function frame(now) {
  const dt = app.hold ? 0 : Math.min(MAX_FRAME, (now - app.last) / 1000);
  app.last = now;
  const state = app.state;
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
    app.spectate = nextMate(state, app.spectate) ?? app.spectate;
  } else input.takeMouse();

  if (!app.paused && !app.hold) {
    app.acc += dt * app.speed;
    while (app.acc >= SIM_DT && !app.hold) {
      controls.fill(p, input.locked && !app.buyOpen && p.alive);
      stepSim(state, SIM_DT);
      app.acc -= SIM_DT;
      if (app.pauseWhen && app.pauseWhen(state)) app.hold = true;
    }
  }
  const alpha = app.hold ? 1 : app.acc / SIM_DT;
  const subject = subjectOf(state);
  spotEnemies(state, dt);
  consumeEvents(state, subject);
  audio.setListener(subject.pos.x, subject.pos.z, subject.yaw);
  if (app.buyOpen && state.match.phase !== 'freeze' && state.match.roundClock > 20) setBuy(false);
  hud.showBoard(input.down('Tab') || state.match.phase === 'over');
  const zone = zoneAt(state.map, p.pos.x, p.pos.z);
  view.render(state, alpha, dt, subject, false);
  seen.subject = subject;
  seen.fov = view.fov;
  seen.onSite = zone === ZONE.siteA || zone === ZONE.siteB;
  hud.update(state, dt, seen);
  requestAnimationFrame(frame);
}

// ?demo plays a bot-only match seen through the player's eyes: a bot brain fills the player's input
// record, and everything else is the ordinary game. tools/shots.mjs took the screenshots this way; it
// watches the match through `window.emberline` and stops the clock on a moment worth keeping, so no
// scene is staged.
if (params.has('demo')) {
  startMatch({ demo: true, seed: Number(params.get('seed') ?? 5), side: params.get('side') ?? 'att', difficulty: params.get('bots') ?? 'normal' });
  window.emberline = { app, view, hud, setBuy };
}
requestAnimationFrame(frame);
