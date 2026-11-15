// Visual effects, all from fixed pools allocated once: tracers, bullet marks, sparks / dust / blood
// particles, frag fireballs, smoke clouds and the muzzle flash light.

import * as THREE from 'three';
import { softDot } from './textures.js';

const TRACERS = 24, MARKS = 80, PARTICLES = 400, BLASTS = 4, PUFFS = 16;

export function createFx(scene) {
  const tracerGeo = new THREE.BoxGeometry(0.025, 0.025, 1).translate(0, 0, -0.5);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const tracers = [];
  for (let i = 0; i < TRACERS; i++) {
    const m = new THREE.Mesh(tracerGeo, tracerMat);
    m.visible = false;
    m.userData.life = 0;
    scene.add(m);
    tracers.push(m);
  }

  const markGeo = new THREE.PlaneGeometry(0.14, 0.14);
  const markMat = new THREE.MeshBasicMaterial({ map: softDot('rgba(20,12,8,0.95)', 'rgba(20,12,8,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const marks = [];
  for (let i = 0; i < MARKS; i++) {
    const m = new THREE.Mesh(markGeo, markMat);
    m.visible = false;
    scene.add(m);
    marks.push(m);
  }
  let markNext = 0;

  // Particles: one Points object; dead particles park far below the map.
  const pPos = new Float32Array(PARTICLES * 3).fill(-500);
  const pCol = new Float32Array(PARTICLES * 3);
  const pVel = new Float32Array(PARTICLES * 3);
  const pLife = new Float32Array(PARTICLES);
  const pGrav = new Float32Array(PARTICLES);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, map: softDot('#fff', 'rgba(255,255,255,0)'), transparent: true, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);
  let pNext = 0;

  const blastMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const blasts = [];
  for (let i = 0; i < BLASTS; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), blastMat.clone());
    const light = new THREE.PointLight(0xff9a40, 0, 18, 1.5);
    m.visible = false;
    scene.add(m, light);
    blasts.push({ mesh: m, light, life: 0 });
  }
  let blastNext = 0;

  // Smoke: a cluster of soft sprites per live smoke slot.
  const smokeTex = softDot('rgba(236,230,220,0.95)', 'rgba(220,214,204,0)');
  const smokeClouds = [];
  for (let s = 0; s < 8; s++) {
    const group = new THREE.Group();
    const sprites = [];
    for (let i = 0; i < PUFFS; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0, fog: true }));
      const a = i * 2.39996, r = 0.5 + (i % 5) * 0.55;
      sp.userData.ox = Math.cos(a) * r; sp.userData.oz = Math.sin(a) * r; sp.userData.oy = ((i * 7) % 5) * 0.55 - 0.6;
      group.add(sp);
      sprites.push(sp);
    }
    group.visible = false;
    scene.add(group);
    smokeClouds.push({ group, sprites });
  }

  const muzzleLight = new THREE.PointLight(0xffc070, 0, 9, 2);
  scene.add(muzzleLight);
  let muzzleLife = 0;

  function spawnParticles(x, y, z, nx, ny, nz, count, r, g, b, speed, gravity, life) {
    for (let i = 0; i < count; i++) {
      const k = pNext++ % PARTICLES;
      pPos[k * 3] = x; pPos[k * 3 + 1] = y; pPos[k * 3 + 2] = z;
      pVel[k * 3] = (nx + (Math.random() - 0.5) * 1.4) * speed;
      pVel[k * 3 + 1] = (ny + Math.random() * 0.8) * speed;
      pVel[k * 3 + 2] = (nz + (Math.random() - 0.5) * 1.4) * speed;
      pCol[k * 3] = r; pCol[k * 3 + 1] = g; pCol[k * 3 + 2] = b;
      pLife[k] = life * (0.6 + Math.random() * 0.6);
      pGrav[k] = gravity;
    }
  }

  return {
    tracer(x0, y0, z0, x1, y1, z1) {
      const m = tracers.find((t) => !t.visible) ?? tracers[0];
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      if (len < 1.5) return;
      m.position.set(x0, y0, z0);
      m.lookAt(x1, y1, z1);
      m.rotateY(Math.PI);
      m.scale.set(1, 1, Math.min(len, 6));
      m.userData.life = 0.05;
      m.userData.len = len;
      m.userData.dir = m.userData.dir ?? new THREE.Vector3();
      m.userData.dir.set(x1 - x0, y1 - y0, z1 - z0).divideScalar(len);
      m.visible = true;
    },
    impact(x, y, z, nx, ny, nz) {
      const m = marks[markNext++ % MARKS];
      m.position.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01);
      m.lookAt(x + nx, y + ny, z + nz);
      m.visible = true;
      spawnParticles(x, y, z, nx, ny, nz, 6, 1, 0.8, 0.45, 2.5, 9, 0.25);
      spawnParticles(x, y, z, nx, ny, nz, 5, 0.75, 0.6, 0.45, 1.2, 2, 0.6);
    },
    blood(x, y, z, dx, dy, dz, head) {
      spawnParticles(x, y, z, dx, dy, dz, head ? 16 : 9, 0.55, 0.06, 0.04, 1.6, 9, 0.45);
    },
    blast(x, y, z, big) {
      const b = blasts[blastNext++ % BLASTS];
      b.mesh.position.set(x, y + 0.4, z);
      b.light.position.set(x, y + 1, z);
      b.life = big ? 1.2 : 0.55;
      b.max = b.life;
      b.size = big ? 9 : 3.6;
      b.mesh.visible = true;
      spawnParticles(x, y + 0.2, z, 0, 1, 0, big ? 80 : 40, 1, 0.55, 0.2, big ? 9 : 6, 10, 0.9);
      spawnParticles(x, y + 0.2, z, 0, 0.5, 0, 30, 0.35, 0.3, 0.27, 3, -0.5, 1.6);
    },
    flash(x, y, z) {
      const b = blasts[blastNext++ % BLASTS];
      b.mesh.position.set(x, y + 0.3, z);
      b.light.position.set(x, y + 0.5, z);
      b.life = 0.25; b.max = 0.25; b.size = 1.6;
      b.mesh.visible = true;
    },
    muzzle(x, y, z) {
      muzzleLight.position.set(x, y, z);
      muzzleLife = 0.05;
    },
    update(dt, state) {
      for (const m of tracers) {
        if (!m.visible) continue;
        m.userData.life -= dt;
        // Slide the streak along its path so it reads as a fast round, not a laser.
        m.position.addScaledVector(m.userData.dir, dt * 260);
        if (m.userData.life <= 0) m.visible = false;
      }
      for (let k = 0; k < PARTICLES; k++) {
        if (pLife[k] <= 0) continue;
        pLife[k] -= dt;
        if (pLife[k] <= 0) { pPos[k * 3 + 1] = -500; continue; }
        pVel[k * 3 + 1] -= pGrav[k] * dt;
        pPos[k * 3] += pVel[k * 3] * dt;
        pPos[k * 3 + 1] = Math.max(0.02, pPos[k * 3 + 1] + pVel[k * 3 + 1] * dt);
        pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;
      for (const b of blasts) {
        if (b.life <= 0) continue;
        b.life -= dt;
        const t = 1 - Math.max(0, b.life) / b.max;
        b.mesh.scale.setScalar(0.2 + b.size * Math.sqrt(t));
        b.mesh.material.opacity = (1 - t) * 0.9;
        b.light.intensity = (1 - t) * 60;
        if (b.life <= 0) { b.mesh.visible = false; b.light.intensity = 0; }
      }
      for (let s = 0; s < smokeClouds.length; s++) {
        const src = state.smokes[s], cloud = smokeClouds[s];
        cloud.group.visible = src.active;
        if (!src.active) continue;
        cloud.group.position.set(src.x, src.y, src.z);
        const d = src.density;
        for (let i = 0; i < cloud.sprites.length; i++) {
          const sp = cloud.sprites[i];
          const grow = 0.4 + d * 0.6;
          sp.position.set(sp.userData.ox * grow * 1.4, sp.userData.oy * grow + Math.sin(state.time * 0.4 + i) * 0.15, sp.userData.oz * grow * 1.4);
          sp.scale.setScalar(3.4 * grow);
          sp.material.opacity = 0.82 * d;
        }
      }
      muzzleLife -= dt;
      muzzleLight.intensity = muzzleLife > 0 ? 22 : 0;
    },
    clear() {
      for (const m of marks) m.visible = false;
    },
  };
}
