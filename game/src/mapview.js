// Turns the height grid into meshes. Each material gets one merged geometry holding only the faces
// a player can see (a side is emitted only where the neighbour is lower), so the whole map is a
// handful of draw calls. Landmarks (smokestacks, silos, kilns) rise above the roofs so you can
// orient by skyline: stacks over A, silos over B.

import * as THREE from 'three';
import { CELL } from './config.js';
import { KIND, ZONE, COLS, ROWS } from './mapdata.js';
import { makeTextures, siteDecal, signTexture, softDot } from './textures.js';
import { heightAt } from './physics.js';

const FLOOR_STYLE = {
  'Kiln Hall': 'tiles', 'Silo Court': 'tiles', 'Bastion Yard': 'tiles',
  'Long Gallery': 'concrete', 'Culverts': 'concrete', 'Short A': 'concrete', 'Short B': 'concrete',
  'Mid Door': 'concrete', 'Upper Walk A': 'concrete', 'Upper Walk B': 'concrete', 'South Arch': 'concrete',
};

// [text, cellX, cellZ, side of the floor cell the wall is on]
const SIGNS = [
  ['◀ A  SHORT', 15, 13, 'n'],
  ['SHORT B ▶', 24, 13, 'n'],
  ['KILN HALL · A', 6, 12, 's'],
  ['SILO COURT · B', 32, 12, 's'],
  ['VANGUARD GATE', 19, 31, 's'],
  ['BASTION YARD', 20, 1, 'n'],
  ['LONG GALLERY', 1, 25, 'w'],
  ['CULVERTS · B', 37, 25, 'e'],
  ['MID', 19, 5, 'w'],
];

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

export function buildWorld(scene, map) {
  const tex = makeTextures();
  const mat = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, ...extra });
  const materials = {
    plasterA: mat(tex.plaster),
    plasterB: mat(tex.plasterWarm),
    roof: mat(tex.roof),
    skirt: mat(tex.concrete, { color: 0x8a7a6a }),
    crate: mat(tex.crate, { roughness: 0.85 }),
    tall: mat(tex.container, { roughness: 0.55, metalness: 0.35 }),
    pillar: mat(tex.brick),
    step: mat(tex.concrete),
    barrier: mat(tex.hazard, { roughness: 0.7 }),
    ground: mat(tex.ground),
    tiles: mat(tex.tiles, { roughness: 0.75 }),
    concrete: mat(tex.concrete),
  };
  const meshers = {};
  const m = (k) => (meshers[k] ??= new Mesher());

  const C = CELL;
  for (let cz = 0; cz < ROWS; cz++) for (let cx = 0; cx < COLS; cx++) {
    const i = cz * COLS + cx;
    const kind = map.kind[i], h = map.h[i];
    const x0 = cx * C, x1 = x0 + C, z0 = cz * C, z1 = z0 + C;
    if (kind !== KIND.wall) {
      const room = map.room[i] >= 0 ? map.rooms[map.room[i]] : '';
      m(FLOOR_STYLE[room] ?? 'ground').top(x0, z0, x1, z1, 0, 0.25);
    }
    if (h <= 0) continue;
    let side, topKey, us = 0.5, vs = 0.5, local = false;
    if (kind === KIND.wall) { side = ((cx >> 2) + (cz >> 2)) % 2 ? 'plasterA' : 'plasterB'; topKey = 'roof'; }
    else if (kind === KIND.crate) { side = topKey = 'crate'; us = 1 / C; vs = 1 / h; local = true; }
    else if (kind === KIND.tall) { side = topKey = 'tall'; us = 1 / C; vs = 1 / h; local = true; }
    else if (kind === KIND.pillar) { side = 'pillar'; topKey = 'roof'; }
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
      m(side).wall(ax, az, bx, bz, nh, h, fx, fz, us, vs, local ? 0 : u0);
      if (kind === KIND.wall && nh === 0) {
        m('skirt').wall(ax + fx * 0.02, az + fz * 0.02, bx + fx * 0.02, bz + fz * 0.02, 0, 0.45, fx, fz, 0.5, 0.5, u0);
      }
    }
  }
  for (const [key, mesher] of Object.entries(meshers)) {
    const mesh = new THREE.Mesh(mesher.build(), materials[key]);
    mesh.receiveShadow = true;
    mesh.castShadow = !['ground', 'tiles', 'concrete'].includes(key);
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }

  addDecals(scene, map);
  addSigns(scene);
  const blinkers = addLandmarks(scene, tex);
  addSkyAndLand(scene, tex);
  const sun = addLights(scene);
  return { sun, blinkers };
}

function addDecals(scene, map) {
  const sites = [['A', ZONE.siteA], ['B', ZONE.siteB]];
  for (const [letter, zone] of sites) {
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

function addSigns(scene) {
  for (const [text, cx, cz, side] of SIGNS) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 0.8),
      new THREE.MeshStandardMaterial({ map: signTexture(text, '#1f4f4b', '#f1e3c6'), roughness: 0.8 }),
    );
    const x = cx * CELL + CELL / 2, z = cz * CELL + CELL / 2;
    const off = CELL / 2 - 0.03;
    if (side === 'n') { mesh.position.set(x, 2.6, z - off); }
    if (side === 's') { mesh.position.set(x, 2.6, z + off); mesh.rotation.y = Math.PI; }
    if (side === 'w') { mesh.position.set(x - off, 2.6, z); mesh.rotation.y = Math.PI / 2; }
    if (side === 'e') { mesh.position.set(x + off, 2.6, z); mesh.rotation.y = -Math.PI / 2; }
    scene.add(mesh);
  }
}

function addLandmarks(scene, tex) {
  const blinkers = [];
  const brick = new THREE.MeshStandardMaterial({ map: tex.brick, roughness: 0.9 });
  const soot = new THREE.MeshStandardMaterial({ color: 0x2a211c, roughness: 1 });
  const red = new THREE.MeshBasicMaterial({ color: 0xff3a1a });
  const at = (cx, cz) => [cx * CELL + CELL / 2, cz * CELL + CELL / 2];
  // Kiln smokestacks: tall brick chimneys with soot caps and a warning lamp.
  for (const [cx, cz, h] of [[15, 8, 26], [8, 19, 22], [25, 9, 30]]) {
    const [x, z] = at(cx, cz);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.35, h, 14), brick);
    stack.position.set(x, h / 2, z);
    stack.castShadow = true;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.95, 1.6, 14), soot);
    cap.position.set(x, h - 0.4, z);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), red);
    lamp.position.set(x, h + 0.6, z);
    blinkers.push(lamp);
    scene.add(stack, cap, lamp);
  }
  // Glaze silos over B.
  const siloMat = new THREE.MeshStandardMaterial({ color: 0xcfd6d2, roughness: 0.45, metalness: 0.55 });
  const band = new THREE.MeshStandardMaterial({ color: 0x2b9e95, roughness: 0.5, metalness: 0.3 });
  for (const [cx, cz, r, h] of [[29, 19, 2.6, 14], [32, 21, 2.1, 11], [31, 17, 1.7, 9]]) {
    const [x, z] = at(cx, cz);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), siloMat);
    body.position.set(x, h / 2, z);
    body.castShadow = true;
    const dome = new THREE.Mesh(new THREE.ConeGeometry(r * 1.02, r * 0.7, 20), siloMat);
    dome.position.set(x, h + r * 0.35, z);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.7, 20), band);
    ring.position.set(x, h * 0.7, z);
    scene.add(body, dome, ring);
  }
  // Beehive kilns between Long Gallery and the Courtyard.
  const kilnMat = new THREE.MeshStandardMaterial({ color: 0xb4623a, roughness: 0.95 });
  for (const [cx, cz, r] of [[7, 21, 3.4], [11, 19, 2.6]]) {
    const [x, z] = at(cx, cz);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), kilnMat);
    dome.position.set(x, 6.4, z);
    dome.castShadow = true;
    scene.add(dome);
  }
  // Steel beams over the long lanes, and lamps on the site walls.
  const steel = new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.5, metalness: 0.6 });
  for (const [x0, x1, z] of [[2, 8, 34], [2, 8, 44], [70, 76, 32], [70, 76, 40]]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.35, 0.35), steel);
    beam.position.set((x0 + x1) / 2, 4.6, z);
    beam.castShadow = true;
    scene.add(beam);
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  for (const [x, y, z, color] of [[6, 3.4, 10.2, 0xffb46b], [72, 3.4, 10.2, 0xffb46b], [33, 3.4, 26.2, 0x9fe3ff], [40, 3.6, 2.2, 0x9fe3ff]]) {
    const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), lampMat);
    fixture.position.set(x, y, z);
    const light = new THREE.PointLight(color, 14, 16, 1.6);
    light.position.set(x, y - 0.3, z);
    scene.add(fixture, light);
  }
  return blinkers;
}

function addSkyAndLand(scene, tex) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(0x3d6f9e) }, mid: { value: new THREE.Color(0xe7a77a) }, low: { value: new THREE.Color(0xf3c99a) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.55, h)) : mix(low, mid, smoothstep(-0.1, 0.08, h)); gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  sky.position.set(40, 0, 33);
  scene.add(sky);
  // A soft glowing sun low in the west, where the shadows point from.
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot('rgba(255,244,214,1)', 'rgba(255,160,80,0)'), fog: false, depthWrite: false, transparent: true }));
  sun.position.set(-240, 150, 230);
  sun.scale.setScalar(150);
  scene.add(sun);

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
}

function addLights(scene) {
  scene.fog = new THREE.Fog(0xe9b98a, 95, 340);
  scene.add(new THREE.HemisphereLight(0xc4d8e8, 0xa86a40, 1.55));
  const sun = new THREE.DirectionalLight(0xffd4a3, 3.0);
  sun.position.set(40 - 34, 46, 33 + 26);
  sun.target.position.set(40, 0, 33);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -52; cam.right = 52; cam.top = 52; cam.bottom = -52; cam.near = 5; cam.far = 140;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  return sun;
}
