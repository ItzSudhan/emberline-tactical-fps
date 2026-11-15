// Turns the height grid into meshes. Each material gets one merged geometry holding only the faces
// a player can see (a side is emitted only where the neighbour is lower), so the whole map is a
// handful of draw calls. The two sites are told apart at a glance: Kiln Hall is brick lit by the
// orange mouths of its kilns, Silo Court is sheet steel under cold lamps, and the smokestacks and
// silos above them show over every roof.

import * as THREE from 'three';
import { CELL, KIND, ZONE, COLS, ROWS } from './map-kilnworks.js';
import { heightAt } from './movement-collision.js';
import { makeTextures, siteDecal, signTexture, softDot } from './textures.js';

const FLOOR_STYLE = {
  'Kiln Hall': 'tiles', 'Silo Court': 'tiles', 'Watch Yard': 'tiles',
  'Long Gallery': 'concrete', 'Culverts': 'concrete', 'Short A': 'concrete', 'Short B': 'concrete',
  'Mid Door': 'concrete', 'Upper Walk A': 'concrete', 'Upper Walk B': 'concrete', 'South Arch': 'concrete',
};

// Things hung on walls: [cellX, cellZ, side of that floor cell the wall is on, ...].
const SIGNS = [
  [15, 13, 'n', '◀ A  SHORT'], [24, 13, 'n', 'SHORT B ▶'], [6, 12, 's', 'KILN HALL · A'], [32, 12, 's', 'SILO COURT · B'],
  [19, 31, 's', 'ASH GATE'], [20, 1, 'n', 'WATCH YARD'], [1, 25, 'w', 'LONG GALLERY'], [37, 25, 'e', 'CULVERTS · B'], [19, 5, 'w', 'MID'],
];
const LETTERS = [[1, 7, 'w', 'A'], [8, 12, 's', 'A'], [38, 10, 'e', 'B'], [30, 12, 's', 'B']]; // stencilled on each site's walls
const LAMPS = [[33, 12, 's', 0x8fe4ff], [38, 9, 'e', 0x8fe4ff], [20, 1, 'n', 0x8fe4ff], [19, 31, 's', 0xffb46b], [14, 18, 'w', 0xffb46b]];
const KILNS = [[1, 9, 'w'], [1, 11, 'w'], [4, 5, 'n']];
const STACKS = [[15, 8, 26], [8, 19, 22], [25, 9, 30]]; // cellX, cellZ, height

const at = (c) => c * CELL + CELL / 2;
// A repeatable 0..1 value per pair of integers, for scattering windows, doors and pot glazes.
function hash(a, b) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h & 0xffff) / 0xffff;
}

// Puts `obj` against the wall on `side` of floor cell (cx, cz), `y` up and `out` metres proud of it.
function mount(obj, cx, cz, side, y, out = 0.03) {
  const off = CELL / 2 - out;
  if (side === 'n') obj.position.set(at(cx), y, at(cz) - off);
  else if (side === 's') { obj.position.set(at(cx), y, at(cz) + off); obj.rotation.y = Math.PI; }
  else if (side === 'w') { obj.position.set(at(cx) - off, y, at(cz)); obj.rotation.y = Math.PI / 2; }
  else { obj.position.set(at(cx) + off, y, at(cz)); obj.rotation.y = -Math.PI / 2; }
  return obj;
}

class Mesher {
  constructor() { this.p = []; this.n = []; this.uv = []; this.i = []; }
  // A vertical quad from bottom-left (ax, az) to bottom-right (bx, bz) as seen from outside.
  wall(ax, az, bx, bz, y0, y1, nx, nz, us, vs, u0 = 0) {
    const k = this.p.length / 3;
    const len = Math.hypot(bx - ax, bz - az);
    this.p.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
    for (let j = 0; j < 4; j++) this.n.push(nx, 0, nz);
    this.uv.push(u0 * us, y0 * vs, (u0 + len) * us, y0 * vs, (u0 + len) * us, y1 * vs, u0 * us, y1 * vs);
    this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  top(x0, z0, x1, z1, y, us, local) {
    const k = this.p.length / 3;
    this.p.push(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0);
    for (let j = 0; j < 4; j++) this.n.push(0, 1, 0);
    if (local) this.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    else this.uv.push(x0 * us, -z1 * us, x1 * us, -z1 * us, x1 * us, -z0 * us, x0 * us, -z0 * us);
    this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.i);
    return g;
  }
}

// Brick around Kiln Hall, sheet steel around Silo Court, two plasters everywhere else.
function wallStyle(cx, cz) {
  if (cz < 13 && cx < 13) return 'brick';
  if (cz < 13 && cx > 26) return 'steel';
  return ((cx >> 2) + (cz >> 2)) % 2 ? 'plasterA' : 'plasterB';
}

export function buildWorld(scene, map) {
  const tex = makeTextures();
  const mat = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, ...extra });
  const materials = {
    plasterA: mat(tex.plaster),
    plasterB: mat(tex.plasterWarm),
    brick: mat(tex.brick),
    steel: mat(tex.steel, { roughness: 0.6, metalness: 0.35 }),
    roof: mat(tex.roof),
    trim: mat(tex.concrete, { color: 0x8a6a58 }),
    crate: mat(tex.crate, { roughness: 0.85 }),
    tall: mat(tex.container, { roughness: 0.55, metalness: 0.35 }),
    step: mat(tex.concrete),
    barrier: mat(tex.hazard, { roughness: 0.7 }),
    ground: mat(tex.ground),
    tiles: mat(tex.tiles, { roughness: 0.75 }),
    concrete: mat(tex.concrete),
    window: mat(tex.window, { roughness: 0.25, metalness: 0.5 }),
    windowLit: new THREE.MeshBasicMaterial({ map: tex.window, color: new THREE.Color(2.8, 1.8, 0.85) }),
    door: mat(tex.door, { roughness: 0.7 }),
  };
  const meshers = {};
  const m = (k) => (meshers[k] ??= new Mesher());
  const potCells = [];

  const C = CELL;
  for (let cz = 0; cz < ROWS; cz++) for (let cx = 0; cx < COLS; cx++) {
    const i = cz * COLS + cx;
    const kind = map.kind[i];
    const x0 = cx * C, x1 = x0 + C, z0 = cz * C, z1 = z0 + C;
    if (kind !== KIND.wall) {
      const room = map.room[i] >= 0 ? map.rooms[map.room[i]] : '';
      m(FLOOR_STYLE[room] ?? 'ground').top(x0, z0, x1, z1, 0, 0.25);
    }
    // A pallet of pots is drawn as a low wooden pallet; the pots themselves are instanced below.
    const h = kind === KIND.pots ? 0.16 : map.h[i];
    if (h <= 0) continue;
    if (kind === KIND.pots) potCells.push(cx, cz);
    let side, topKey, us = 0.5, vs = 0.5, local = false;
    if (kind === KIND.wall) { side = wallStyle(cx, cz); topKey = 'roof'; }
    else if (kind === KIND.crate || kind === KIND.pots) { side = topKey = 'crate'; us = 1 / C; vs = 1 / map.h[i]; local = true; }
    else if (kind === KIND.tall) { side = topKey = 'tall'; us = 1 / C; vs = 1 / h; local = true; }
    else if (kind === KIND.pillar) { side = 'brick'; topKey = 'roof'; }
    else if (kind === KIND.barrier) { side = 'barrier'; topKey = 'step'; us = 1 / C; vs = 1 / h; }
    else { side = topKey = 'step'; }
    m(topKey).top(x0, z0, x1, z1, h, 0.5, local);
    const faces = [
      [cx + 1, cz, x1, z1, x1, z0, 1, 0],
      [cx - 1, cz, x0, z0, x0, z1, -1, 0],
      [cx, cz + 1, x0, z1, x1, z1, 0, 1],
      [cx, cz - 1, x1, z0, x0, z0, 0, -1],
    ];
    for (const [nx, nz, ax, az, bx, bz, fx, fz] of faces) {
      const nh = Math.min(heightAt(map, nx, nz), 50);
      if (nh >= h) continue;
      const u0 = local ? 0 : fx !== 0 ? (fx > 0 ? -az : az) : (fz > 0 ? ax : -ax);
      m(side).wall(ax, az, bx, bz, nh, h, fx, fz, us, vs, u0);
      if (kind !== KIND.wall) continue;
      // Building walls get a coping along the top and, where they meet the ground, a base course
      // and the odd window or door.
      const px = fx * 0.03, pz = fz * 0.03;
      m('trim').wall(ax + px, az + pz, bx + px, bz + pz, Math.max(nh, h - 0.3), h, fx, fz, 0.5, 0.5, u0);
      if (nh > 0) continue;
      m('trim').wall(ax + px, az + pz, bx + px, bz + pz, 0, 0.45, fx, fz, 0.5, 0.5, u0);
      const r = hash(cx * 4 + fx, cz * 4 + fz);
      const mx = (ax + bx) / 2 + px * 2, mz = (az + bz) / 2 + pz * 2, tx = (bx - ax) * 0.3, tz = (bz - az) * 0.3;
      if (r < 0.24 && h >= 5) m(r < 0.08 ? 'windowLit' : 'window').wall(mx - tx, mz - tz, mx + tx, mz + tz, 2.8, 4.2, fx, fz, 1 / 1.2, 1 / 1.4);
      else if (r > 0.94) m('door').wall(mx - tx, mz - tz, mx + tx, mz + tz, 0, 2.2, fx, fz, 1 / 1.2, 1 / 2.2);
    }
  }
  for (const [key, mesher] of Object.entries(meshers)) {
    const mesh = new THREE.Mesh(mesher.build(), materials[key]);
    mesh.receiveShadow = true;
    mesh.castShadow = !['ground', 'tiles', 'concrete', 'window', 'windowLit', 'door', 'trim'].includes(key);
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }

  addPots(scene, potCells);
  addDecals(scene, map);
  for (const [cx, cz, side, text] of SIGNS) {
    scene.add(mount(new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: signTexture(text, '#1f4f4b', '#f1e3c6'), roughness: 0.8 })), cx, cz, side, 2.6));
  }
  for (const [cx, cz, side, letter] of LETTERS) {
    scene.add(mount(new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.MeshStandardMaterial({ map: siteDecal(letter, '#f4e6c8'), transparent: true, roughness: 0.9 })), cx, cz, side, 2.2, 0.08));
  }
  const animated = addLandmarks(scene, tex);
  const sun = addLights(scene);
  const sky = addSkyAndLand(scene, tex, sun);

  return {
    sun,
    // Per-frame motion that is not part of the simulation: flicker, smoke and drifting embers.
    update(time) {
      sky.embers.value = time;
      for (let i = 0; i < animated.blinkers.length; i++) animated.blinkers[i].visible = Math.sin(time * 2.4 + i) > 0;
      for (let i = 0; i < animated.fires.length; i++) animated.fires[i].intensity = 30 + Math.sin(time * 9 + i * 2) * Math.sin(time * 13.7 + i) * 7;
      for (let i = 0; i < animated.smoke.length; i++) {
        const sp = animated.smoke[i], s = sp.userData;
        const u = (time * 0.06 + s.phase) % 1;
        sp.position.set(s.x + u * 10, s.y + u * 13, s.z - u * 6);
        sp.scale.setScalar(2.4 + u * 10);
        sp.material.opacity = 0.5 * (1 - u) * Math.min(1, u * 6);
      }
    },
  };
}

// Four fired amphorae on every pallet, in terracotta with the odd teal glaze.
function addPots(scene, cells) {
  const profile = [[0, 0], [0.17, 0], [0.31, 0.26], [0.37, 0.5], [0.3, 0.72], [0.16, 0.83], [0.2, 0.92], [0, 0.92]].map(([r, y]) => new THREE.Vector2(r, y));
  const mesh = new THREE.InstancedMesh(new THREE.LatheGeometry(profile, 12), new THREE.MeshStandardMaterial({ roughness: 0.65 }), cells.length * 2);
  const o = new THREE.Object3D(), color = new THREE.Color();
  for (let k = 0; k < cells.length * 2; k++) {
    const cx = cells[(k >> 2) * 2], cz = cells[(k >> 2) * 2 + 1];
    o.position.set(cx * CELL + (k & 1 ? 1.5 : 0.5), 0.16, cz * CELL + (k & 2 ? 1.5 : 0.5));
    o.scale.setScalar(0.92 + hash(k, cx) * 0.22);
    o.rotation.y = k;
    o.updateMatrix();
    mesh.setMatrixAt(k, o.matrix);
    mesh.setColorAt(k, color.set(hash(cx, k) < 0.22 ? 0x2f8f88 : 0xb5633a).multiplyScalar(0.75 + hash(k, cz) * 0.5));
  }
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
}

function addDecals(scene, map) {
  for (const [letter, zone] of [['A', ZONE.siteA], ['B', ZONE.siteB]]) {
    let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
    for (let i = 0; i < map.zone.length; i++) {
      if (map.zone[i] !== zone) continue;
      const x = i % COLS, z = (i / COLS) | 0;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const w = (maxX - minX + 1) * CELL, d = (maxZ - minZ + 1) * CELL;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ map: siteDecal(letter, '#f4e6c8'), transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(minX * CELL + w / 2, 0.02, minZ * CELL + d / 2);
    plane.receiveShadow = true;
    scene.add(plane);
  }
}

function addLandmarks(scene, tex) {
  const blinkers = [], fires = [], smoke = [];
  const brick = new THREE.MeshStandardMaterial({ map: tex.brick, roughness: 0.9 });
  const soot = new THREE.MeshStandardMaterial({ color: 0x2a211c, roughness: 1 });
  const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.5, 0.2) });
  const puff = softDot('rgba(120,100,92,0.9)', 'rgba(120,100,92,0)');
  // Kiln smokestacks: tall brick chimneys with soot caps, a warning lamp and a trail of smoke.
  STACKS.forEach(([cx, cz, h], n) => {
    const x = at(cx), z = at(cz);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.35, h, 14), brick);
    stack.position.set(x, h / 2, z);
    stack.castShadow = true;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.95, 1.6, 14), soot);
    cap.position.set(x, h - 0.4, z);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), red);
    lamp.position.set(x, h + 0.6, z);
    blinkers.push(lamp);
    scene.add(stack, cap, lamp);
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false }));
      sp.userData = { x, y: h, z, phase: i / 5 + n * 0.13 };
      smoke.push(sp);
      scene.add(sp);
    }
  });
  // Glaze silos over B.
  const siloMat = new THREE.MeshStandardMaterial({ color: 0xcfd6d2, roughness: 0.45, metalness: 0.55 });
  const band = new THREE.MeshStandardMaterial({ color: 0x2b9e95, roughness: 0.5, metalness: 0.3 });
  for (const [cx, cz, r, h] of [[29, 19, 2.6, 14], [32, 21, 2.1, 11], [31, 17, 1.7, 9]]) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), siloMat);
    body.position.set(at(cx), h / 2, at(cz));
    body.castShadow = true;
    const dome = new THREE.Mesh(new THREE.ConeGeometry(r * 1.02, r * 0.7, 20), siloMat);
    dome.position.set(at(cx), h + r * 0.35, at(cz));
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.7, 20), band);
    ring.position.set(at(cx), h * 0.7, at(cz));
    scene.add(body, dome, ring);
  }
  // Beehive kiln domes between Long Gallery and the Courtyard.
  const kilnMat = new THREE.MeshStandardMaterial({ color: 0xb4623a, roughness: 0.95 });
  for (const [cx, cz, r] of [[7, 21, 3.4], [11, 19, 2.6]]) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), kilnMat);
    dome.position.set(at(cx), 6.4, at(cz));
    dome.castShadow = true;
    scene.add(dome);
  }
  // Steel beams over the long lanes.
  const steel = new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.5, metalness: 0.6 });
  for (const [x0, x1, z] of [[2, 8, 34], [2, 8, 44], [70, 76, 32], [70, 76, 40]]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.35, 0.35), steel);
    beam.position.set((x0 + x1) / 2, 4.6, z);
    beam.castShadow = true;
    scene.add(beam);
  }
  // Kiln mouths around site A: a brick front, a glowing arch and a flickering light.
  const glow = new THREE.MeshBasicMaterial({ map: tex.kilnMouth, transparent: true, color: new THREE.Color(3.4, 1.8, 0.8) });
  for (const [cx, cz, side] of KILNS) {
    const kiln = mount(new THREE.Group(), cx, cz, side, 1.3, 0.12);
    const front = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.6, 0.24), brick);
    front.castShadow = true;
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.6), glow);
    mouth.position.set(0, -0.5, 0.13);
    const fire = new THREE.PointLight(0xff7a30, 30, 13, 1.7);
    fire.position.set(0, -0.3, 1.1);
    fires.push(fire);
    kiln.add(front, mouth, fire);
    scene.add(kiln);
  }
  // Wall lamps: warm on the attackers' side of the map, cold on the defenders'.
  for (const [cx, cz, side, color] of LAMPS) {
    const lamp = mount(new THREE.Group(), cx, cz, side, 3.3, 0.12);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.24), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(5) }));
    const light = new THREE.PointLight(color, 16, 16, 1.6);
    light.position.set(0, -0.3, 0.5);
    lamp.add(bulb, light);
    scene.add(lamp);
  }
  return { blinkers, fires, smoke };
}

const SKY_FRAGMENT = `
uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 sunDir;
varying vec3 vP;
void main() {
  vec3 d = normalize(vP);
  float h = d.y;
  vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.6, h)) : mix(low, mid, smoothstep(-0.1, 0.08, h));
  // Long thin cloud bands low in the sky, lit from below by the sun.
  float band = sin(d.x * 7.0 + sin(d.z * 4.0) * 2.0) * sin(h * 30.0 + d.z * 5.0);
  c = mix(c, vec3(1.0, 0.62, 0.42), smoothstep(0.5, 1.0, band) * smoothstep(0.03, 0.16, h) * (1.0 - smoothstep(0.22, 0.5, h)) * 0.55);
  float s = max(dot(d, sunDir), 0.0);
  c += vec3(1.0, 0.55, 0.25) * (pow(s, 5.0) * 0.45 + pow(s, 50.0) * 1.4) + vec3(1.0, 0.85, 0.6) * smoothstep(0.9990, 0.9996, s) * 14.0;
  gl_FragColor = vec4(c, 1.0);
}`;

const EMBER_VERTEX = `
uniform float time;
attribute float seed;
varying float vGlow;
void main() {
  float t = time * (0.25 + seed * 0.4) + seed * 40.0;
  vec3 p = position;
  p.y = mod(p.y + t, 12.0);
  p.x += sin(t * 1.3 + seed * 9.0) * 0.7;
  p.z += cos(t * 1.1 + seed * 5.0) * 0.7;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(7.0, (40.0 + seed * 70.0) / -mv.z);
  vGlow = (0.55 + 0.45 * sin(t * 3.0)) * (1.0 - smoothstep(8.0, 12.0, p.y));
}`;

function addSkyAndLand(scene, tex, sun) {
  const sunDir = new THREE.Vector3().copy(sun.position).sub(sun.target.position).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(0x2c5d92) }, mid: { value: new THREE.Color(0xf0a070) }, low: { value: new THREE.Color(0xf6c08a) }, sunDir: { value: sunDir } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: SKY_FRAGMENT,
    }),
  );
  sky.position.set(40, 0, 33);
  scene.add(sky);

  // Embers from the kilns drift up over the whole plant; the vertex shader moves them, so they cost
  // the CPU nothing.
  const count = 420, pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = hash(i, 1) * COLS * CELL; pos[i * 3 + 1] = hash(i, 2) * 12; pos[i * 3 + 2] = hash(i, 3) * ROWS * CELL;
    seed[i] = hash(i, 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const embers = { value: 0 };
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { time: embers },
    vertexShader: EMBER_VERTEX,
    fragmentShader: 'varying float vGlow; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vec3(4.0, 1.5, 0.35) * vGlow * (1.0 - d), 1.0); }',
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  }));
  points.frustumCulled = false;
  scene.add(points);

  const g = tex.ground.clone();
  g.repeat.set(60, 60);
  g.needsUpdate = true;
  const land = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: g, roughness: 1, color: 0xd8b48a }));
  land.rotation.x = -Math.PI / 2;
  land.position.set(40, -0.02, 33);
  land.receiveShadow = true;
  scene.add(land);

  // Mesas on the horizon.
  const mesaMat = new THREE.MeshStandardMaterial({ color: 0xb36a43, roughness: 1, flatShading: true });
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + Math.sin(i * 7.3) * 0.08;
    const r = 170 + (i % 3) * 45;
    const h = 18 + ((i * 37) % 23);
    const mesa = new THREE.Mesh(new THREE.CylinderGeometry(14 + (i % 4) * 5, 26 + (i % 5) * 6, h, 7), mesaMat);
    mesa.position.set(40 + Math.cos(a) * r, h / 2 - 1, 33 + Math.sin(a) * r);
    mesa.rotation.y = i;
    scene.add(mesa);
  }
  return { embers };
}

// A low sun from the south-west: long warm shadows across the lanes, cool sky light in the shade.
function addLights(scene) {
  scene.fog = new THREE.FogExp2(0xd9a27c, 0.0055);
  scene.add(new THREE.HemisphereLight(0xb9d2ee, 0xa8643c, 1.5));
  const sun = new THREE.DirectionalLight(0xffc48a, 3.4);
  sun.position.set(40 - 38, 34, 33 + 30);
  sun.target.position.set(40, 0, 33);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -54; cam.right = 54; cam.top = 54; cam.bottom = -54; cam.near = 5; cam.far = 150;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  return sun;
}
