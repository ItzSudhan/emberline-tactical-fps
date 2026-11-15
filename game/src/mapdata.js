// Kilnworks: an abandoned desert ceramics plant. The map is a 40 x 33 grid of 2 m cells carved out of
// solid buildings. Rooms are named so the HUD and the bots' radio calls can say where things happen.
//
//   Watch Yard (defender spawn) top-centre, Ash Gate (attacker spawn) bottom-centre.
//   Site A: Kiln Hall (north-west, brick and firelight), reached by Long Gallery, Short A or Upper Walk A.
//   Site B: Silo Court (north-east, sheet steel and cold lamps), reached by the Culverts, Short B or Upper Walk B.
//   The Courtyard in the middle links both short routes and the Mid Door to the defenders.
//   Every site has three ways in, each lane has cover that breaks its long sightline, and the two
//   long lanes (Long Gallery, Culverts) trade distance for safety against the short ones.

import { CELL } from './config.js';

export const COLS = 40;
export const ROWS = 33;

export const KIND = { floor: 0, wall: 1, crate: 2, tall: 3, pillar: 4, step: 5, barrier: 6, pots: 7 };
export const ZONE = { none: 0, siteA: 1, siteB: 2 };

// [name, x0, z0, x1, z1] inclusive cell rectangles that become open floor.
const ROOMS = [
  ['Watch Yard', 16, 1, 23, 4],
  ['Upper Walk A', 6, 2, 15, 4],
  ['Upper Walk B', 24, 2, 33, 4],
  ['Kiln Hall', 1, 5, 11, 12],
  ['Silo Court', 28, 5, 38, 12],
  ['Mid Door', 19, 5, 20, 12],
  ['Short A', 10, 13, 13, 15],
  ['Short B', 26, 13, 29, 15],
  ['Courtyard', 14, 13, 25, 21],
  ['Long Gallery', 1, 13, 3, 26],
  ['Culverts', 35, 13, 37, 23],
  ['South Arch', 18, 22, 21, 23],
  ['Clay Pits', 1, 24, 14, 26],
  ['Drain Run', 25, 24, 37, 26],
  ['Ash Gate', 15, 24, 24, 31],
];

const ZONES = [
  [ZONE.siteA, 3, 7, 8, 10],
  [ZONE.siteB, 31, 7, 36, 10],
];

// [kind, x, z, height?] solid props inside rooms. Low cover (crates and pallets of fired pots, 1.1 m)
// hides a crouched body, can be jumped onto and can be shot through at a cost; containers hide a
// standing body and stop bullets.
const PROPS = [
  // Kiln Hall (A): a raised balcony in the corner, a container stack mid-site, scattered low cover.
  [KIND.step, 1, 5, 0.9], [KIND.step, 2, 5, 0.9], [KIND.step, 1, 6, 0.9], [KIND.step, 2, 6, 0.9],
  [KIND.step, 3, 5, 0.45], [KIND.step, 3, 6, 0.45],
  [KIND.tall, 5, 8], [KIND.tall, 6, 8], [KIND.pots, 9, 7], [KIND.crate, 8, 11], [KIND.pots, 4, 11],
  [KIND.pillar, 10, 6],
  // Silo Court (B): a loading dock on the east wall, a crate column, a pillar.
  [KIND.step, 36, 5, 0.9], [KIND.step, 37, 5, 0.9], [KIND.step, 38, 5, 0.9],
  [KIND.step, 36, 6, 0.9], [KIND.step, 37, 6, 0.9], [KIND.step, 38, 6, 0.9],
  [KIND.step, 36, 7, 0.9], [KIND.step, 37, 7, 0.9], [KIND.step, 38, 7, 0.9],
  [KIND.step, 35, 5, 0.45], [KIND.step, 35, 6, 0.45], [KIND.step, 35, 7, 0.45],
  [KIND.tall, 33, 8], [KIND.tall, 33, 9], [KIND.crate, 30, 10], [KIND.crate, 31, 6], [KIND.crate, 37, 10],
  [KIND.pillar, 29, 7],
  // Courtyard: a tall stack breaks the Mid Door to South Arch sightline.
  [KIND.tall, 19, 17], [KIND.tall, 20, 17], [KIND.pots, 16, 15], [KIND.crate, 23, 19], [KIND.crate, 15, 20],
  [KIND.barrier, 22, 14], [KIND.barrier, 23, 14],
  // Lanes.
  [KIND.pots, 3, 17], [KIND.tall, 1, 21],
  [KIND.pots, 8, 25], [KIND.tall, 11, 24],
  [KIND.crate, 16, 26], [KIND.crate, 23, 26],
  [KIND.tall, 29, 26], [KIND.crate, 32, 24],
  [KIND.crate, 35, 16], [KIND.tall, 37, 19],
  [KIND.crate, 16, 4], [KIND.crate, 23, 4],
  [KIND.pots, 12, 3], [KIND.crate, 27, 3],
  [KIND.pots, 13, 15], [KIND.crate, 26, 15],
];

const PROP_HEIGHT = { [KIND.crate]: 1.1, [KIND.pots]: 1.1, [KIND.tall]: 2.3, [KIND.pillar]: 7, [KIND.barrier]: 1.05 };
const isSoft = (kind) => kind === KIND.crate || kind === KIND.pots || kind === KIND.barrier;

// The player takes the first cell of a side, at the back, so the squad stands in view at the buy.
export const SPAWNS = {
  att: [[19, 31], [17, 29], [21, 29], [18, 30], [22, 30]],
  def: [[20, 1], [18, 3], [21, 3], [19, 2], [22, 2]],
};

export const PLANT_SPOTS = { A: [[4, 9], [7, 9]], B: [[32, 10], [35, 8]] };

// Defender holds: stand on `cell`, watch `watch`.
export const HOLDS = [
  { name: 'A Balcony', site: 'A', cell: [1, 5], watch: [2, 13] },
  { name: 'A Short', site: 'A', cell: [7, 11], watch: [11, 14] },
  { name: 'Mid Door', site: 'mid', cell: [19, 10], watch: [19, 15] },
  { name: 'B Short', site: 'B', cell: [31, 11], watch: [28, 14] },
  { name: 'B Dock', site: 'B', cell: [37, 6], watch: [36, 13] },
];

// Attacker routes: waypoints ending at a plant spot. The second-last waypoint is the staging point
// where the squad waits for the execute.
export const ROUTES = {
  A: [
    { name: 'Long Gallery', points: [[2, 25], [2, 16], [4, 9]], smoke: [8, 5] },
    { name: 'Short A', points: [[19, 22], [15, 16], [12, 14], [7, 9]], smoke: [3, 6] },
  ],
  B: [
    { name: 'Culverts', points: [[27, 25], [36, 23], [36, 15], [35, 8]], smoke: [30, 5] },
    { name: 'Short B', points: [[20, 22], [24, 17], [27, 14], [32, 10]], smoke: [37, 6] },
  ],
};

export const POSTPLANT = {
  A: [{ cell: [3, 8], watch: [8, 4] }, { cell: [6, 10], watch: [11, 13] }, { cell: [2, 12], watch: [8, 4] }, { cell: [9, 10], watch: [8, 4] }],
  B: [{ cell: [35, 10], watch: [30, 4] }, { cell: [32, 7], watch: [28, 14] }, { cell: [37, 8], watch: [30, 4] }, { cell: [34, 11], watch: [28, 13] }],
};

// Deterministic per-block hash so building heights vary into a skyline.
function blockHash(x, z) {
  let h = (x * 374761393 + z * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h & 0xffff) / 0xffff;
}

export function buildMap() {
  const n = COLS * ROWS;
  const map = {
    cols: COLS,
    rows: ROWS,
    h: new Float32Array(n),
    kind: new Uint8Array(n),
    zone: new Uint8Array(n),
    room: new Int8Array(n).fill(-1),
    rooms: ROOMS.map((r) => r[0]),
  };
  for (let z = 0; z < ROWS; z++) {
    for (let x = 0; x < COLS; x++) {
      const i = z * COLS + x;
      map.kind[i] = KIND.wall;
      map.h[i] = 4.6 + Math.round(blockHash(x >> 2, z >> 2) * 4) * 0.9;
    }
  }
  ROOMS.forEach(([, x0, z0, x1, z1], r) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = z * COLS + x;
      map.kind[i] = KIND.floor;
      map.h[i] = 0;
      if (map.room[i] < 0) map.room[i] = r;
    }
  });
  for (const [zone, x0, z0, x1, z1] of ZONES) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) map.zone[z * COLS + x] = zone;
  }
  for (const [kind, x, z, height] of PROPS) {
    const i = z * COLS + x;
    map.kind[i] = kind;
    map.h[i] = height ?? PROP_HEIGHT[kind];
  }
  // The same grid with soft cover flattened: what a bullet still hits after it punches through wood.
  map.hard = { cols: COLS, rows: ROWS, h: map.h.map((h, i) => (isSoft(map.kind[i]) ? 0 : h)) };
  return map;
}

export const cellCenter = (c) => c * CELL + CELL / 2;
export const cellOf = (v) => Math.floor(v / CELL);

export function roomNameAt(map, x, z) {
  const cx = cellOf(x), cz = cellOf(z);
  if (cx < 0 || cz < 0 || cx >= COLS || cz >= ROWS) return '';
  const zone = map.zone[cz * COLS + cx];
  if (zone === ZONE.siteA) return 'A Site';
  if (zone === ZONE.siteB) return 'B Site';
  const r = map.room[cz * COLS + cx];
  return r >= 0 ? map.rooms[r] : '';
}

export function zoneAt(map, x, z) {
  const cx = cellOf(x), cz = cellOf(z);
  if (cx < 0 || cz < 0 || cx >= COLS || cz >= ROWS) return ZONE.none;
  return map.zone[cz * COLS + cx];
}
