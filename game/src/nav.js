// Bot pathfinding: A* over the map's cells. Bots walk floors and steps whose height differs from a
// neighbour by at most half a metre; crates are cover to them, not floor. Cells hugging walls cost
// a little more, so routes run down the middle of lanes instead of scraping corners.

import { KIND, cellCenter } from './mapdata.js';

let N = 0, COLS = 0, H = null;
let walk, extra, g, f, came, stamp, closed, heap;
let search = 0;

export function initNav(map) {
  COLS = map.cols;
  N = map.cols * map.rows;
  H = map.h;
  walk = new Uint8Array(N);
  extra = new Float32Array(N);
  g = new Float32Array(N);
  f = new Float32Array(N);
  came = new Int32Array(N);
  stamp = new Uint32Array(N);
  closed = new Uint32Array(N);
  heap = new Int32Array(N * 8);
  for (let i = 0; i < N; i++) walk[i] = map.kind[i] === KIND.floor || map.kind[i] === KIND.step ? 1 : 0;
  for (let z = 0; z < map.rows; z++) for (let x = 0; x < map.cols; x++) {
    const i = z * COLS + x;
    if (!walk[i]) continue;
    let near = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= map.cols || nz >= map.rows || !walk[nz * COLS + nx]) near++;
    }
    extra[i] = near ? 0.35 + near * 0.12 : 0;
  }
}

export const isWalkable = (cx, cz) => cx >= 0 && cz >= 0 && cx < COLS && cz * COLS + cx < N && walk[cz * COLS + cx] === 1;

function canStep(a, b) {
  return walk[b] === 1 && Math.abs(H[a] - H[b]) <= 0.5;
}

// Nearest walkable cell to (cx, cz), searching outward in rings.
export function nearestWalkable(cx, cz) {
  for (let r = 0; r < 4; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (isWalkable(cx + dx, cz + dz)) return (cz + dz) * COLS + cx + dx;
    }
  }
  return -1;
}

// Binary min-heap of cell indices keyed by f, shared by every search.
let size = 0;
function push(i) {
  let k = size++;
  heap[k] = i;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (f[heap[p]] <= f[heap[k]]) break;
    const t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p;
  }
}
function pop() {
  const top = heap[0];
  heap[0] = heap[--size];
  let k = 0;
  for (;;) {
    const l = k * 2 + 1, r = l + 1;
    let m = k;
    if (l < size && f[heap[l]] < f[heap[m]]) m = l;
    if (r < size && f[heap[r]] < f[heap[m]]) m = r;
    if (m === k) break;
    const t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m;
  }
  return top;
}

// Writes cell indices from start (exclusive) to goal (inclusive) into `out`; returns the count.
export function findPath(sx, sz, gx, gz, out) {
  const start = nearestWalkable(sx, sz), goal = nearestWalkable(gx, gz);
  if (start < 0 || goal < 0) return 0;
  if (start === goal) { out[0] = goal; return 1; }
  search++;
  const gxC = goal % COLS, gzC = (goal / COLS) | 0;
  size = 0;
  stamp[start] = search;
  g[start] = 0;
  f[start] = 0;
  came[start] = -1;
  push(start);
  while (size > 0) {
    const cur = pop();
    if (closed[cur] === search) continue;
    closed[cur] = search;
    if (cur === goal) break;
    const cx = cur % COLS, cz = (cur / COLS) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (!isWalkable(nx, nz)) continue;
      const ni = nz * COLS + nx;
      if (!canStep(cur, ni)) continue;
      if (dx && dz && (!canStep(cur, cz * COLS + nx) || !canStep(cur, nz * COLS + cx))) continue;
      const cost = g[cur] + (dx && dz ? 1.414 : 1) + extra[ni];
      if (stamp[ni] === search && cost >= g[ni]) continue;
      stamp[ni] = search;
      g[ni] = cost;
      came[ni] = cur;
      f[ni] = cost + Math.hypot(nx - gxC, nz - gzC);
      if (size < heap.length) push(ni);
    }
  }
  if (closed[goal] !== search) return 0;
  let len = 0;
  for (let c = goal; c !== start && c >= 0; c = came[c]) len++;
  if (len > out.length) return 0;
  let k = len;
  for (let c = goal; c !== start && c >= 0; c = came[c]) out[--k] = c;
  return len;
}

export const cellX = (i) => cellCenter(i % COLS);
export const cellZ = (i) => cellCenter((i / COLS) | 0);
