// Character and weapon models built from primitives. Vanguard wear rust jackets with amber visors;
// Bastion wear slate-teal with cyan visors, so a silhouette reads at a glance even in shade.

import * as THREE from 'three';
import { SIDES } from './config.js';
import { lerp } from './util.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const GEO = {
  leg: box(0.17, 0.82, 0.2).translate(0, -0.41, 0),
  boot: box(0.19, 0.12, 0.3).translate(0, -0.82, 0.04),
  torso: box(0.46, 0.58, 0.27),
  vest: box(0.5, 0.42, 0.33),
  arm: box(0.13, 0.55, 0.14).translate(0, -0.26, 0),
  head: new THREE.SphereGeometry(0.15, 12, 10),
  helmet: new THREE.SphereGeometry(0.175, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  visor: box(0.26, 0.07, 0.06),
  gun: box(0.07, 0.11, 0.62),
  pack: new THREE.CylinderGeometry(0.11, 0.11, 0.42, 10),
};

const teamMats = {};
function mats(team) {
  if (teamMats[team]) return teamMats[team];
  const side = SIDES[team];
  const cloth = new THREE.Color(side.color).multiplyScalar(team === 'att' ? 0.8 : 0.7);
  teamMats[team] = {
    cloth: new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.85 }),
    vest: new THREE.MeshStandardMaterial({ color: team === 'att' ? 0x4a3a2c : 0x26343a, roughness: 0.8 }),
    pants: new THREE.MeshStandardMaterial({ color: team === 'att' ? 0x5e4a36 : 0x37444a, roughness: 0.9 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xb98563, roughness: 0.7 }),
    helmet: new THREE.MeshStandardMaterial({ color: team === 'att' ? 0x6b3a22 : 0x1d3c40, roughness: 0.55, metalness: 0.2 }),
    visor: new THREE.MeshStandardMaterial({ color: side.color, emissive: team === 'att' ? 0xffa040 : 0x40fff0, emissiveIntensity: 1.4 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.45, metalness: 0.6 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.9 }),
  };
  return teamMats[team];
}
const igniterMat = new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a10, emissiveIntensity: 0.8, roughness: 0.4 });

function part(geo, mat, parent, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function createSoldier(actor) {
  const M = mats(actor.team);
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.86;
  root.add(hips);
  const legL = part(GEO.leg, M.pants, hips, -0.11, 0, 0);
  const legR = part(GEO.leg, M.pants, hips, 0.11, 0, 0);
  part(GEO.boot, M.boot, legL, 0, 0, 0);
  part(GEO.boot, M.boot, legR, 0, 0, 0);
  const upper = new THREE.Group();
  hips.add(upper);
  part(GEO.torso, M.cloth, upper, 0, 0.3, 0);
  part(GEO.vest, M.vest, upper, 0, 0.34, 0.01);
  const head = new THREE.Group();
  head.position.set(0, 0.76, 0);
  upper.add(head);
  part(GEO.head, M.skin, head, 0, 0, 0);
  part(GEO.helmet, M.helmet, head, 0, 0.02, 0);
  part(GEO.visor, M.visor, head, 0, 0.01, -0.13);
  const armL = part(GEO.arm, M.cloth, upper, -0.29, 0.55, 0);
  const armR = part(GEO.arm, M.cloth, upper, 0.29, 0.55, 0);
  armL.rotation.set(-1.25, 0, 0.45);
  armR.rotation.set(-1.35, 0, -0.1);
  const gun = part(GEO.gun, M.gun, upper, 0.1, 0.42, -0.42);
  const pack = part(GEO.pack, igniterMat, upper, 0, 0.36, 0.24);
  pack.rotation.z = Math.PI / 2;
  return { root, hips, upper, head, legL, legR, armL, armR, gun, pack, phase: 0 };
}

// Poses a soldier for this frame from the interpolated simulation state.
export function updateSoldier(v, a, alpha, dt, carrying, now) {
  const x = lerp(a.prev.x, a.pos.x, alpha), y = lerp(a.prev.y, a.pos.y, alpha), z = lerp(a.prev.z, a.pos.z, alpha);
  v.root.position.set(x, y, z);
  v.pack.visible = carrying;
  if (!a.alive) {
    const k = 1 - (1 - Math.min(1, (now - a.diedAt) * 2.6)) ** 3;
    v.root.rotation.set(-k * Math.PI * 0.5, a.yaw, 0, 'YXZ');
    v.hips.position.y = lerp(0.86, 0.22, k);
    return;
  }
  v.root.rotation.set(0, a.yaw, 0);
  const speed = Math.hypot(a.vel.x, a.vel.z);
  v.phase += dt * speed * 2.1;
  const swing = Math.min(1, speed / 4) * 0.7;
  const crouch = a.crouch;
  v.hips.position.y = lerp(0.86, 0.5, crouch);
  v.legL.rotation.x = Math.sin(v.phase) * swing + crouch * 1.1;
  v.legR.rotation.x = -Math.sin(v.phase) * swing + crouch * 0.2;
  v.upper.rotation.x = crouch * 0.15;
  v.head.rotation.x = a.pitch * 0.6;
  const aim = a.pitch * 0.7;
  v.armL.rotation.x = -1.25 - aim;
  v.armR.rotation.x = -1.35 - aim;
  v.gun.rotation.x = aim;
  v.gun.position.y = 0.42 + aim * 0.3;
}

// ---------- first-person weapons ----------

const vmMat = {
  metal: new THREE.MeshStandardMaterial({ color: 0x4a5257, roughness: 0.35, metalness: 0.6 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x25292c, roughness: 0.55, metalness: 0.4 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.7 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x3a3029, roughness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x113344, roughness: 0.1, metalness: 0.9, emissive: 0x0b2a33 }),
};

function vmPart(g, geo, mat, x, y, z, rx = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  g.add(m);
  return m;
}

// Each weapon is a few boxes and cylinders; `muzzle` marks where the flash appears.
export function createViewmodel(kind, team) {
  const g = new THREE.Group();
  const accent = new THREE.MeshStandardMaterial({ color: SIDES[team].color, roughness: 0.6 });
  const cyl = (r, l) => new THREE.CylinderGeometry(r, r, l, 10).rotateX(Math.PI / 2);
  let muzzleZ = -0.5;
  if (kind === 'pistol') {
    vmPart(g, box(0.045, 0.06, 0.22), vmMat.metal, 0, 0.02, -0.12);
    vmPart(g, box(0.04, 0.1, 0.06), vmMat.dark, 0, -0.04, -0.04, 0.25);
    vmPart(g, box(0.047, 0.016, 0.05), accent, 0, 0.0, -0.07);
    muzzleZ = -0.24;
  } else if (kind === 'nade') {
    vmPart(g, new THREE.SphereGeometry(0.045, 10, 8), accent, 0, 0, -0.08);
    vmPart(g, box(0.02, 0.03, 0.02), vmMat.metal, 0, 0.05, -0.08);
    muzzleZ = -0.1;
  } else {
    const long = kind === 'sniper' ? 0.95 : kind === 'rifle' ? 0.78 : kind === 'shotgun' ? 0.72 : 0.55;
    vmPart(g, box(0.06, 0.08, long * 0.55), vmMat.metal, 0, 0, -long * 0.3);
    vmPart(g, cyl(kind === 'shotgun' ? 0.022 : 0.013, long * 0.5), vmMat.dark, 0, 0.012, -long * 0.75);
    vmPart(g, box(0.05, 0.07, 0.2), kind === 'shotgun' || kind === 'sniper' ? vmMat.wood : vmMat.dark, 0, -0.015, 0.1);
    if (kind !== 'shotgun') vmPart(g, box(0.035, kind === 'smg' ? 0.16 : 0.13, 0.05), vmMat.dark, 0, -0.09, -long * 0.32, 0.18);
    else vmPart(g, cyl(0.026, 0.3), vmMat.wood, 0, -0.035, -long * 0.6);
    vmPart(g, box(0.04, 0.09, 0.05), vmMat.dark, 0, -0.07, -0.05, 0.3);
    vmPart(g, box(0.064, 0.022, 0.1), accent, 0, 0.005, -long * 0.18);
    if (kind === 'sniper') {
      vmPart(g, cyl(0.03, 0.3), vmMat.dark, 0, 0.08, -0.3);
      vmPart(g, cyl(0.026, 0.01), vmMat.glass, 0, 0.08, -0.455);
    } else {
      vmPart(g, box(0.03, 0.035, 0.05), vmMat.dark, 0, 0.06, -0.2);
    }
    muzzleZ = -long;
  }
  vmPart(g, box(0.08, 0.08, 0.16), vmMat.glove, 0.0, -0.06, kind === 'pistol' ? -0.02 : -0.02);
  if (kind !== 'pistol' && kind !== 'nade') vmPart(g, box(0.07, 0.07, 0.14), vmMat.glove, -0.02, -0.05, -0.42);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, muzzleZ);
  g.add(muzzle);
  return { group: g, muzzle };
}

export function createIgniterModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 12), igniterMat);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.17;
  const cap = new THREE.Mesh(box(0.22, 0.2, 0.3), vmMat.dark);
  cap.position.set(0, 0.17, 0);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a10 }));
  light.position.set(0, 0.3, 0);
  g.add(body, cap, light);
  return { group: g, light };
}
