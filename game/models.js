// Soldiers and first-person weapons, modelled from boxes, cylinders and spheres. Each model's parts
// are baked into a few merged geometries with per-part vertex colours, so a soldier is nine draw
// calls and a held weapon is one. Stokers wear rust with amber visors, the Kilnwatch slate-teal with
// cyan visors; the visors glow, so a silhouette reads at a glance even in deep shade.

import * as THREE from 'three';
import { SIDES } from './state.js';
import { lerp } from './movement-collision.js';

// A box or a cylinder along the barrel axis (-z), already moved into place and painted one colour.
function tint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return geo;
}
const box = (hex, w, h, d, x, y, z, rx = 0, ry = 0) => tint(new THREE.BoxGeometry(w, h, d).rotateX(rx).rotateY(ry).translate(x, y, z), hex);
const rod = (hex, r, len, x, y, z) => tint(new THREE.CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2).translate(x, y, z), hex);
const ball = (hex, r, x, y, z, arc = Math.PI) => tint(new THREE.SphereGeometry(r, 12, 9, 0, Math.PI * 2, 0, arc).translate(x, y, z), hex);

// Joins painted parts into one indexed geometry.
function merge(parts) {
  const p = [], n = [], c = [], idx = [];
  for (const g of parts) {
    const base = p.length / 3;
    for (const v of g.attributes.position.array) p.push(v);
    for (const v of g.attributes.normal.array) n.push(v);
    for (const v of g.attributes.color.array) c.push(v);
    for (const i of g.index.array) idx.push(i + base);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  out.setIndex(idx);
  return out;
}

const painted = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 });
const gunmetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.55 });
const igniterMat = new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a10, emissiveIntensity: 2.2, roughness: 0.4 });
const STEEL = 0x5d676d, DARK = 0x1c2023, OLIVE = 0x41463a, WOOD = 0x7a4a2a, GLOVE = 0x26221f, SKIN = 0xb98563, BOOT = 0x241d18;

// ---------- soldiers ----------

const kits = {};
// The shared geometry of one side's soldiers, built on first use.
function kit(team) {
  if (kits[team]) return kits[team];
  const att = team === 'att';
  const cloth = new THREE.Color(SIDES[team].color).multiplyScalar(att ? 0.8 : 0.7).getHex();
  const vest = att ? 0x4a3a2c : 0x26343a, pants = att ? 0x5e4a36 : 0x37444a, helmet = att ? 0x6b3a22 : 0x1d3c40;
  kits[team] = {
    upper: merge([
      box(cloth, 0.44, 0.56, 0.26, 0, 0.3, 0), box(vest, 0.48, 0.4, 0.31, 0, 0.36, 0), box(DARK, 0.47, 0.07, 0.3, 0, 0.06, 0),
      box(vest, 0.1, 0.12, 0.07, -0.14, 0.2, -0.17), box(vest, 0.1, 0.12, 0.07, 0, 0.2, -0.18), box(vest, 0.1, 0.12, 0.07, 0.14, 0.2, -0.17),
      box(pants, 0.3, 0.36, 0.15, 0, 0.36, 0.21), box(vest, 0.17, 0.09, 0.21, -0.3, 0.57, 0), box(vest, 0.17, 0.09, 0.21, 0.3, 0.57, 0),
      box(SKIN, 0.13, 0.1, 0.13, 0, 0.62, 0),
    ]),
    head: merge([ball(SKIN, 0.14, 0, 0, 0), ball(helmet, 0.175, 0, 0.02, 0, Math.PI * 0.55), box(helmet, 0.34, 0.07, 0.24, 0, -0.02, 0.03)]),
    arm: merge([box(cloth, 0.12, 0.46, 0.13, 0, -0.22, 0), box(GLOVE, 0.11, 0.12, 0.12, 0, -0.5, 0)]),
    leg: merge([box(pants, 0.17, 0.8, 0.2, 0, -0.4, 0), box(DARK, 0.19, 0.11, 0.06, 0, -0.42, -0.11), box(BOOT, 0.19, 0.13, 0.3, 0, -0.81, -0.05)]),
    visor: new THREE.MeshStandardMaterial({ color: SIDES[team].color, emissive: att ? 0xffa040 : 0x40fff0, emissiveIntensity: 3 }),
  };
  return kits[team];
}
const rifleGeo = merge([
  box(STEEL, 0.06, 0.1, 0.34, 0, 0, -0.05), box(DARK, 0.05, 0.07, 0.2, 0, 0, -0.3), rod(DARK, 0.014, 0.22, 0, 0.01, -0.5),
  box(OLIVE, 0.045, 0.085, 0.2, 0, -0.01, 0.2), box(DARK, 0.035, 0.15, 0.055, 0, -0.11, -0.1, 0.2), box(DARK, 0.02, 0.03, 0.08, 0, 0.065, -0.08),
]);
const visorGeo = new THREE.BoxGeometry(0.25, 0.065, 0.05);
const packGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.42, 10).rotateZ(Math.PI / 2);

function limb(geo, mat, parent, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function createSoldier(actor) {
  const K = kit(actor.team);
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.86;
  root.add(hips);
  const legL = limb(K.leg, painted, hips, -0.11, 0, 0);
  const legR = limb(K.leg, painted, hips, 0.11, 0, 0);
  const upper = new THREE.Group();
  hips.add(upper);
  limb(K.upper, painted, upper, 0, 0, 0);
  const head = limb(K.head, painted, upper, 0, 0.76, 0);
  limb(visorGeo, K.visor, head, 0, 0.01, -0.125);
  const armL = limb(K.arm, painted, upper, -0.29, 0.55, 0);
  const armR = limb(K.arm, painted, upper, 0.29, 0.55, 0);
  const gun = limb(rifleGeo, gunmetal, upper, 0.1, 0.42, -0.42);
  const pack = limb(packGeo, igniterMat, upper, 0, 0.6, 0.22); // the Igniter, slung across the carrier's pack
  return { root, hips, upper, head, legL, legR, armL, armR, gun, pack, phase: 0 };
}

// Poses a soldier for this frame from the interpolated simulation state.
export function updateSoldier(v, a, alpha, dt, carrying, now) {
  v.root.position.set(lerp(a.prev.x, a.pos.x, alpha), lerp(a.prev.y, a.pos.y, alpha), lerp(a.prev.z, a.pos.z, alpha));
  v.pack.visible = carrying;
  v.gun.visible = a.alive;
  if (!a.alive) {
    // Fall backwards and come to rest sprawled, the weapon dropped.
    const k = 1 - (1 - Math.min(1, (now - a.diedAt) * 2.6)) ** 3;
    v.root.rotation.set(-k * Math.PI * 0.5, a.yaw, 0, 'YXZ');
    v.hips.position.y = lerp(0.86, 0.2, k);
    v.legL.rotation.x = 0.25; v.legR.rotation.x = -0.1;
    v.armL.rotation.set(-0.4, 0, 1.1); v.armR.rotation.set(0.3, 0, -0.9);
    v.upper.rotation.x = v.head.rotation.x = 0;
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
  v.armL.rotation.set(-1.25 - aim, 0, 0.45);
  v.armR.rotation.set(-1.35 - aim, 0, -0.1);
  v.gun.rotation.x = aim;
  v.gun.position.y = 0.42 + aim * 0.3;
  v.gun.scale.z = a.current === 'primary' ? 1 : 0.5; // a sidearm reads shorter than a long gun
}

// ---------- first-person weapons ----------

// The parts of each kind of weapon, grip at the origin and barrel along -z; `muzzle` is where the
// flash appears and `hold` where the support hand sits (0 for one-handed kinds).
const WEAPON_PARTS = {
  pistol: (accent) => ({ muzzle: -0.25, hold: 0, parts: [
    box(STEEL, 0.034, 0.045, 0.21, 0, 0.02, -0.13), box(DARK, 0.03, 0.03, 0.17, 0, -0.012, -0.12), box(DARK, 0.032, 0.11, 0.05, 0, -0.07, -0.045, -0.22),
    box(DARK, 0.008, 0.008, 0.05, 0, -0.04, -0.11), box(DARK, 0.006, 0.012, 0.008, 0, 0.048, -0.225), box(DARK, 0.02, 0.012, 0.008, 0, 0.048, -0.035),
    rod(DARK, 0.009, 0.02, 0, 0.02, -0.245), box(accent, 0.036, 0.012, 0.05, 0, 0.02, -0.07),
  ] }),
  smg: (accent) => ({ muzzle: -0.46, hold: -0.25, parts: [
    box(STEEL, 0.056, 0.085, 0.3, 0, 0, -0.14), rod(DARK, 0.02, 0.12, 0, 0.005, -0.35), rod(DARK, 0.01, 0.05, 0, 0.005, -0.43),
    box(DARK, 0.028, 0.2, 0.04, 0, -0.14, -0.16, 0.05), box(DARK, 0.034, 0.1, 0.046, 0, -0.08, -0.04, -0.3), box(DARK, 0.01, 0.012, 0.2, 0.03, 0.02, 0.1),
    box(DARK, 0.01, 0.07, 0.012, 0.03, -0.01, 0.2), box(DARK, 0.02, 0.025, 0.02, 0, 0.055, -0.26), box(DARK, 0.026, 0.03, 0.02, 0, 0.057, -0.02),
    box(OLIVE, 0.04, 0.05, 0.12, 0, -0.045, -0.25), box(accent, 0.058, 0.018, 0.06, 0, 0.02, -0.2),
  ] }),
  shotgun: (accent) => ({ muzzle: -0.75, hold: -0.42, parts: [
    box(STEEL, 0.055, 0.085, 0.24, 0, 0, -0.12), rod(DARK, 0.016, 0.5, 0, 0.02, -0.49), rod(DARK, 0.014, 0.4, 0, -0.018, -0.44),
    box(DARK, 0.008, 0.012, 0.008, 0, 0.042, -0.72), box(WOOD, 0.05, 0.05, 0.16, 0, -0.02, -0.42), box(WOOD, 0.048, 0.085, 0.24, 0, -0.025, 0.1, 0.12),
    box(DARK, 0.034, 0.09, 0.046, 0, -0.075, -0.03, -0.45), box(accent, 0.057, 0.016, 0.05, 0, 0.03, -0.1),
  ] }),
  rifle: (accent) => ({ muzzle: -0.77, hold: -0.4, parts: [
    box(STEEL, 0.056, 0.078, 0.27, 0, 0, -0.16), box(STEEL, 0.03, 0.016, 0.22, 0, 0.047, -0.17), rod(DARK, 0.011, 0.24, 0, 0.008, -0.62),
    rod(DARK, 0.018, 0.06, 0, 0.008, -0.74), box(DARK, 0.03, 0.15, 0.058, 0, -0.105, -0.2, 0.2), box(DARK, 0.034, 0.1, 0.046, 0, -0.08, -0.05, -0.3),
    box(DARK, 0.008, 0.04, 0.012, 0, 0.055, -0.5), box(DARK, 0.032, 0.03, 0.02, 0, 0.066, -0.07), box(DARK, 0.01, 0.008, 0.06, 0, -0.045, -0.1),
    box(OLIVE, 0.05, 0.062, 0.25, 0, 0, -0.415), box(OLIVE, 0.046, 0.07, 0.2, 0, -0.012, 0.085), box(OLIVE, 0.04, 0.03, 0.12, 0, 0.035, 0.07),
    box(accent, 0.058, 0.02, 0.05, 0, 0, -0.3),
  ] }),
  sniper: (accent) => ({ muzzle: -0.89, hold: -0.42, parts: [
    box(STEEL, 0.052, 0.07, 0.3, 0, 0, -0.15), box(STEEL, 0.012, 0.012, 0.05, 0.04, 0.02, -0.06), rod(DARK, 0.012, 0.52, 0, 0.008, -0.56),
    rod(DARK, 0.02, 0.07, 0, 0.008, -0.85), rod(DARK, 0.024, 0.3, 0, 0.085, -0.16), rod(DARK, 0.032, 0.07, 0, 0.085, -0.33),
    rod(DARK, 0.03, 0.05, 0, 0.085, 0), box(DARK, 0.02, 0.03, 0.02, 0, 0.055, -0.08), box(DARK, 0.02, 0.03, 0.02, 0, 0.055, -0.24),
    box(DARK, 0.03, 0.07, 0.07, 0, -0.06, -0.17), box(WOOD, 0.05, 0.05, 0.3, 0, -0.02, -0.42), box(WOOD, 0.048, 0.09, 0.26, 0, -0.03, 0.1, 0.1),
    rod(0x2fd0c0, 0.027, 0.004, 0, 0.085, -0.367), box(accent, 0.054, 0.016, 0.05, 0, 0, -0.3),
  ] }),
  nade: (accent) => ({ muzzle: -0.1, hold: 0, parts: [
    ball(accent, 0.045, 0, 0, -0.08), box(STEEL, 0.012, 0.05, 0.02, 0, 0.045, -0.08), rod(DARK, 0.016, 0.03, 0, 0.03, -0.08),
  ] }),
};

// A weapon and the arms that hold it: two meshes. `muzzle` is an empty marker for the flash.
export function createViewmodel(kind, team) {
  const sleeve = new THREE.Color(SIDES[team].color).multiplyScalar(0.7).getHex();
  const { muzzle: muzzleZ, hold, parts } = WEAPON_PARTS[kind](SIDES[team].color);
  // Right hand on the grip with its forearm running back to the lower right...
  const arms = [box(GLOVE, 0.07, 0.085, 0.075, 0, -0.075, -0.045), box(sleeve, 0.085, 0.085, 0.36, 0.05, -0.16, 0.16, 0.42, -0.12)];
  // ...and the support hand: under the fore-end of a long gun, wrapped round the grip of a pistol.
  if (hold) arms.push(box(GLOVE, 0.07, 0.06, 0.1, -0.012, -0.055, hold), box(sleeve, 0.085, 0.085, 0.42, -0.14, -0.15, hold + 0.2, 0.36, 0.62));
  else if (kind === 'pistol') arms.push(box(GLOVE, 0.075, 0.08, 0.07, -0.03, -0.08, -0.04), box(sleeve, 0.085, 0.085, 0.36, -0.11, -0.16, 0.15, 0.42, 0.36));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(merge(parts), gunmetal), new THREE.Mesh(merge(arms), painted));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, muzzleZ);
  group.add(muzzle);
  return { group, muzzle };
}

export function createIgniterModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 12).rotateZ(Math.PI / 2), igniterMat);
  body.position.y = 0.17;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.3), new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.5, metalness: 0.4 }));
  cap.position.y = 0.17;
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.6, 0.2) }));
  light.position.y = 0.3;
  g.add(body, cap, light);
  return { group: g, light };
}
