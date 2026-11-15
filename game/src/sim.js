// One fixed simulation tick (SIM_DT). Rendering never calls into here; it interpolates between the
// last two ticks using each actor's prev/pos. Nothing below this file imports three.js or touches
// the DOM, so tools/soak.mjs plays whole matches in plain Node to balance the bots.

import { stepActor, separateActors } from './actors.js';
import { updateWeapon } from './weapons.js';
import { updateGrenades } from './grenades.js';
import { updateRound } from './round.js';
import { updateBot } from './bots.js';

export function stepSim(state, dt) {
  const phase = state.match.phase;
  if (phase === 'menu') return;
  state.time += dt;
  state.tick++;
  const actors = state.actors;
  const autoplay = state.settings.autoplay;
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    if (a.brain && (!a.isPlayer || autoplay)) updateBot(state, a, dt);
  }
  for (let i = 0; i < actors.length; i++) stepActor(state, actors[i], dt);
  separateActors(actors);
  if (phase !== 'over') for (let i = 0; i < actors.length; i++) updateWeapon(state, actors[i], dt);
  updateGrenades(state, dt);
  updateRound(state, dt);
}
