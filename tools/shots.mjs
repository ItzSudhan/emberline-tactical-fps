// Takes candidate screenshots from live bot matches. Nothing is staged: the game runs its ordinary
// ?demo mode (a bot brain plays the player's slot), an observer installed here stops the clock when
// a moment matches a description ("the player is mid-burst at an enemy with the planted Igniter and
// a squadmate in view"), and the frame on screen is saved. Run with the game served (node serve.ts):
//
//   node tools/shots.mjs <shot> [--seeds 1-8] [--out dir] [--port 8080] [--max 3] [--size 768x480] [--scale 1.6666667]
//
// The window is 768x480 CSS pixels at a device pixel ratio of 5/3, so a screenshot is 1280x800.
// Candidates land in <out>/<shot>-s<seed>-<n>.jpg; the ones kept are copied to screenshots/ by hand.

import { mkdirSync } from 'node:fs';
import { launch } from './chrome.mjs';

// Helpers every observer may use, installed in the page once it has loaded.
const HELPERS = `
  import('./movement-collision.js').then(({ clearLine }) => {
    // Distance to the point (x, y, z) if it lies inside p's view cone with nothing in the way, else 0.
    window.seesPoint = (s, p, x, y, z, cone, far) => {
      const dx = x - p.pos.x, dz = z - p.pos.z, d = Math.hypot(dx, dz);
      const facing = (-Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz) / (d || 1);
      return facing > cone && d > 2 && d < far && clearLine(s.map, p.pos.x, p.pos.y + 1.5, p.pos.z, x, y, z) ? d : 0;
    };
    window.inView = (s, p, team, cone, far) => s.actors.filter((a) => a !== p && a.alive && a.team === team && seesPoint(s, p, a.pos.x, a.pos.y + 1.2, a.pos.z, cone, far)).length;
    window.firing = (s, p) => p.alive && p.current === 'primary' && s.time - p.lastShot < 0.03 && p.shots >= 2;
    window.coolUntil = 0;
    window.helpersReady = true;
  });`;

// Each shot: the demo's query, how fast to run the clock while waiting, the observer (page-side
// source of a function of the state that returns true on a frame worth keeping), and anything to
// do once the clock has stopped.
const SHOTS = {
  // The cover: a fight over the planted Igniter, with the charge, an enemy and a squadmate in view.
  retake: {
    query: 'side=def', speed: 8,
    when: `(s) => {
      const p = s.player, b = s.bomb;
      if (s.time < coolUntil || s.match.phase !== 'live' || b.state !== 'planted' || !firing(s, p)) return false;
      // The Igniter's marker must be on screen (it shows through walls), and an enemy in plain view.
      const dx = b.x - p.pos.x, dz = b.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > 30 || (-Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz) / (d || 1) < 0.78) return false;
      return inView(s, p, p.team === 'att' ? 'def' : 'att', 0.88, 24) >= 1;
    }`,
  },
  // Any firefight: the player mid-burst with two enemies and a squadmate in view.
  firefight: {
    query: 'side=att', speed: 6,
    when: `(s) => {
      const p = s.player;
      if (s.time < coolUntil || s.match.phase !== 'live' || !firing(s, p)) return false;
      return inView(s, p, p.team === 'att' ? 'def' : 'att', 0.88, 20) >= 2 && inView(s, p, p.team, 0.7, 26) >= 1;
    }`,
  },
  defuse: {
    query: 'side=def', speed: 6,
    when: `(s) => {
      const p = s.player, b = s.bomb;
      return s.time > coolUntil && p.alive && b.state === 'planted' && b.defuser === p && b.defuseProgress > 0.45 && b.defuseProgress < 0.8;
    }`,
  },
  plant: {
    query: 'side=att', speed: 6,
    when: `(s) => {
      const p = s.player, b = s.bomb;
      return s.time > coolUntil && p.alive && b.carrier === p && b.plantProgress > 0.45 && b.plantProgress < 0.8;
    }`,
  },
  buy: {
    query: 'side=att', speed: 8,
    when: `(s) => s.time > coolUntil && s.match.phase === 'freeze' && s.match.round >= 3 && s.match.phaseTime < 3.2 && s.player.money >= 1500`,
    after: (page) => page.eval('emberline.setBuy(true)'),
  },
  roundend: {
    query: 'side=def', speed: 8,
    when: `(s) => s.time > coolUntil && s.match.phase === 'post' && s.match.round >= 5 && s.match.phaseTime < 4.6 && s.match.result.reason.includes('Igniter')`,
    after: (page) => page.key('Tab'),
    release: (page) => page.key('Tab', 'Tab', false),
  },
};

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const shot = SHOTS[args[0]];
if (!shot) { console.error(`shot must be one of: ${Object.keys(SHOTS).join(', ')}`); process.exit(1); }
const [from, to] = opt('seeds', '1-6').split('-').map(Number);
const [width, height] = opt('size', '768x480').split('x').map(Number);
const out = opt('out', 'out/shots');
const max = Number(opt('max', 3));
mkdirSync(out, { recursive: true });

const chrome = await launch({ width, height, scale: Number(opt('scale', 5 / 3)) });
try {
  for (let seed = from; seed <= (to ?? from); seed++) {
    const page = await chrome.open(`http://localhost:${opt('port', '8080')}/?demo&seed=${seed}&${opt('query', shot.query)}`);
    await page.waitFor('window.emberline && emberline.app.state.match.phase !== "menu"');
    await page.eval(HELPERS);
    await page.waitFor('window.helpersReady');
    await page.eval(`emberline.app.pauseWhen = ${shot.when}; emberline.app.speed = ${shot.speed};`);
    let taken = 0;
    const deadline = Date.now() + Number(opt('wait', 60)) * 1000;
    while (taken < max && Date.now() < deadline) {
      const st = await page.eval('({ hold: emberline.app.hold, phase: emberline.app.state.match.phase })');
      if (st.phase === 'over') break;
      if (!st.hold) { await chrome.sleep(120); continue; }
      if (shot.after) await shot.after(page);
      await chrome.sleep(400); // let the HUD's text panels and the frame settle with the clock stopped
      const file = `${out}/${args[0]}-s${seed}-${taken}.jpg`;
      await page.screenshot(file, { quality: 90 });
      const info = await page.eval('(() => { const s = emberline.app.state, m = s.match; return `round ${m.round} ${m.score.att}:${m.score.def} t=${s.time.toFixed(1)} room=${document.getElementById("location").textContent}`; })()');
      console.log(`${file}  ${info}`);
      taken++;
      if (shot.release) await shot.release(page);
      await page.eval('emberline.setBuy(false); coolUntil = emberline.app.state.time + 4; emberline.app.hold = false;');
    }
    if (page.errors.length) console.log(`seed ${seed} console:`, page.errors);
    await page.close();
  }
} finally {
  await chrome.close();
}
