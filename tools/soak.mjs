// Plays whole bot-versus-bot matches in plain Node: the simulation imports nothing from three.js or the
// DOM, so it runs headless at thousands of ticks a second. Prints how rounds end, how long they last
// and which side wins, which is how the bots and the economy were balanced.
//
//   node tools/soak.mjs [matches=20] [difficulty=normal]

import { SIM_DT } from '../game/src/config.js';
import { createState, eventAt } from '../game/src/state.js';
import { setupMatch } from '../game/src/round.js';
import { stepSim } from '../game/src/sim.js';

const matches = Number(process.argv[2] ?? 20);
const difficulty = process.argv[3] ?? 'normal';
const tally = { rounds: 0, att: 0, def: 0, seconds: 0, reasons: {}, plants: 0, kills: 0, headshots: 0, shots: 0, nades: {}, stuck: 0, matchWins: { att: 0, def: 0 } };
const lengths = [];
const t0 = Date.now();

for (let seed = 1; seed <= matches; seed++) {
  const state = createState({ seed, side: seed % 2 ? 'att' : 'def', difficulty, autoplay: true });
  setupMatch(state);
  let cursor = 0, roundStart = 0, guard = 0;
  while (state.match.phase !== 'over' && guard++ < 60 * 60 * 40) {
    stepSim(state, SIM_DT);
    for (; cursor < state.eventCount; cursor++) {
      const e = eventAt(state, cursor);
      if (e.type === 'live') roundStart = state.time;
      else if (e.type === 'shot') tally.shots++;
      else if (e.type === 'planted') tally.plants++;
      else if (e.type === 'throw') tally.nades[e.text] = (tally.nades[e.text] ?? 0) + 1;
      else if (e.type === 'death') { tally.kills++; if (e.a) tally.headshots++; }
      else if (e.type === 'roundEnd') {
        const r = state.match.result;
        tally.rounds++;
        tally[r.winner]++;
        const why = r.reason.replace(/^.* defused/, 'Defused');
        tally.reasons[why] = (tally.reasons[why] ?? 0) + 1;
        const len = state.time - roundStart;
        tally.seconds += len;
        lengths.push(len);
      }
    }
  }
  if (state.match.phase !== 'over') tally.stuck++;
  else tally.matchWins[state.match.score.att > state.match.score.def ? 'att' : 'def']++;
}

lengths.sort((a, b) => a - b);
const pct = (p) => lengths[Math.floor((lengths.length - 1) * p)].toFixed(0);
console.log(`${matches} matches (${difficulty}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`rounds ${tally.rounds}: attackers ${tally.att} (${((tally.att / tally.rounds) * 100).toFixed(0)}%), defenders ${tally.def}; matches att ${tally.matchWins.att} / def ${tally.matchWins.def}; unfinished ${tally.stuck}`);
console.log(`round length s: mean ${(tally.seconds / tally.rounds).toFixed(0)}, p10 ${pct(0.1)}, median ${pct(0.5)}, p90 ${pct(0.9)}`);
console.log(`plants ${tally.plants} (${((tally.plants / tally.rounds) * 100).toFixed(0)}% of rounds), kills/round ${(tally.kills / tally.rounds).toFixed(1)}, headshots ${((tally.headshots / tally.kills) * 100).toFixed(0)}%, shots/kill ${(tally.shots / tally.kills).toFixed(1)}`);
console.log('ends:', tally.reasons);
console.log('grenades thrown:', tally.nades);
