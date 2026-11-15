// Everything drawn: the world, soldiers, the first-person weapon, effects and the camera.
// It reads the simulation state and interpolates actor positions between the last two ticks.

import * as THREE from 'three';
import { BODY, WEAPONS } from './config.js';
import { buildWorld } from './mapview.js';
import { createFx } from './fx.js';
import { createSoldier, updateSoldier, createViewmodel, createIgniterModel } from './models.js';
import { eyeHeight } from './actors.js';
import { softDot } from './textures.js';
import { lerp } from './util.js';

const BASE_FOV = 78;

export function createView(container, map) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 1500);
  camera.rotation.order = 'YXZ';
  const world = buildWorld(scene, map);
  const fx = createFx(scene);

  // The held weapon lives in its own scene and is drawn after clearing depth, so it never clips walls.
  const vmScene = new THREE.Scene();
  const vmCamera = new THREE.PerspectiveCamera(62, camera.aspect, 0.01, 10);
  vmScene.add(new THREE.HemisphereLight(0xcfe0ee, 0x8a5434, 1.5));
  const vmSun = new THREE.DirectionalLight(0xffd4a3, 2.4);
  vmScene.add(vmSun, vmSun.target);
  const holder = new THREE.Group();
  holder.scale.setScalar(0.72);
  vmScene.add(holder);
  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot('rgba(255,236,170,1)', 'rgba(255,140,40,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flashSprite.scale.setScalar(0.22);
  flashSprite.visible = false;
  const vmCache = new Map();
  let vmKey = '', vm = null;
  const vmState = { kick: 0, swayX: 0, swayY: 0, phase: 0, flash: 0, shake: 0 };

  const igniter = createIgniterModel();
  scene.add(igniter.group);
  const soldiers = new Map();

  const sunDir = new THREE.Vector3().copy(world.sun.position).sub(world.sun.target.position).normalize();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  let fov = BASE_FOV;
  let menuAngle = null;

  function bindActors(state) {
    for (const v of soldiers.values()) scene.remove(v.root);
    soldiers.clear();
    for (const a of state.actors) {
      const v = createSoldier(a);
      soldiers.set(a.id, v);
      scene.add(v.root);
    }
  }

  function pickViewmodel(subject) {
    const w = subject.current === 'primary' ? subject.primary : subject.current === 'secondary' ? subject.secondary : null;
    const kind = subject.current === 'nade' ? 'nade' : w.def.kind;
    const key = `${kind}:${subject.team}`;
    if (key === vmKey) return;
    vmKey = key;
    if (vm) holder.remove(vm.group);
    if (!vmCache.has(key)) vmCache.set(key, createViewmodel(kind, subject.team));
    vm = vmCache.get(key);
    holder.add(vm.group);
    vm.muzzle.add(flashSprite);
  }

  return {
    renderer,
    camera,
    fx,
    bindActors,
    get fov() { return fov; },
    setMenuAngle(a) { menuAngle = a; },
    resize() {
      camera.aspect = vmCamera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      vmCamera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    },
    kick(strength) { vmState.kick = Math.min(1.6, vmState.kick + strength); vmState.flash = 0.045; },
    shake(amount) { vmState.shake = Math.max(vmState.shake, amount); },
    sway(dx, dy) { vmState.swayX += dx; vmState.swayY += dy; },
    // World-space point near the subject's muzzle, for tracers.
    muzzleWorld(out) {
      tmpV.set(0.16, -0.12, -0.7).applyQuaternion(camera.quaternion);
      return out.copy(camera.position).add(tmpV);
    },

    render(state, alpha, dt, subject, menu) {
      const time = state.time;
      for (const a of state.actors) {
        const v = soldiers.get(a.id);
        if (!v) continue;
        updateSoldier(v, a, alpha, dt, state.bomb.carrier === a, time);
        v.root.visible = menu || a !== subject;
      }
      const bomb = state.bomb;
      igniter.group.visible = bomb.state === 'dropped' || bomb.state === 'planted';
      igniter.group.position.set(bomb.x, bomb.y, bomb.z);
      igniter.light.visible = bomb.state !== 'planted' || bomb.beep > Math.max(0.12, Math.min(1, bomb.timer / 30)) - 0.08;
      for (let i = 0; i < world.blinkers.length; i++) world.blinkers[i].visible = Math.sin(time * 2.4 + i) > 0;
      fx.update(dt, state);

      if (menu) {
        const t = menuAngle ?? performance.now() * 0.00004;
        // Orbit offset to the right of centre so the map sits beside the menu panel.
        camera.position.set(28 + Math.cos(t) * 50, 52, 33 + Math.sin(t) * 42);
        camera.lookAt(28, 0, 33);
        camera.fov = 55;
        camera.updateProjectionMatrix();
        renderer.clear();
        renderer.render(scene, camera);
        return;
      }

      // First-person camera at the subject's interpolated eye, with view punch from recoil.
      const ex = lerp(subject.prev.x, subject.pos.x, alpha);
      const ez = lerp(subject.prev.z, subject.pos.z, alpha);
      let ey = lerp(subject.prev.y, subject.pos.y, alpha) + eyeHeight(subject);
      const speed = Math.hypot(subject.vel.x, subject.vel.z);
      vmState.phase += dt * speed * 1.9;
      const bobAmt = subject.grounded ? Math.min(1, speed / BODY.runSpeed) : 0;
      if (!subject.alive) ey = lerp(subject.prev.y, subject.pos.y, alpha) + 0.35;
      ey += Math.abs(Math.sin(vmState.phase)) * 0.035 * bobAmt;
      vmState.shake *= Math.exp(-8 * dt);
      const shakeX = (Math.random() - 0.5) * vmState.shake, shakeY = (Math.random() - 0.5) * vmState.shake;
      camera.position.set(ex, ey, ez);
      camera.rotation.set(subject.pitch + subject.punchPitch * 0.9 + shakeY, subject.yaw + subject.punchYaw * 0.9 + shakeX, 0);
      const w = subject.current === 'primary' ? subject.primary : subject.current === 'secondary' ? subject.secondary : null;
      const wantFov = subject.scoped && w ? WEAPONS[w.def.id].zoomFov ?? BASE_FOV : BASE_FOV;
      fov = lerp(fov, wantFov, Math.min(1, dt * 18));
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

      renderer.clear();
      renderer.render(scene, camera);
      if (!subject.alive || subject.scoped) return;

      // Weapon: bob, sway against mouse motion, recoil kick, reload dip, draw from below.
      pickViewmodel(subject);
      vmState.kick *= Math.exp(-14 * dt);
      vmState.swayX *= Math.exp(-9 * dt);
      vmState.swayY *= Math.exp(-9 * dt);
      const bob = Math.sin(vmState.phase) * 0.012 * bobAmt;
      let dip = 0, tilt = 0;
      if (subject.reloading > 0 && w) {
        const k = Math.sin(Math.PI * (1 - subject.reloading / w.def.reload));
        dip = k * 0.13; tilt = k * 0.7;
      }
      if (subject.switching > 0) dip += subject.switching * 0.9;
      const crouchOff = subject.crouch * 0.015;
      holder.position.set(0.15 + bob + vmState.swayX * 0.0004, -0.16 - Math.abs(bob) * 0.6 - dip + crouchOff + vmState.swayY * 0.0004, -0.24 + vmState.kick * 0.05);
      holder.rotation.set(vmState.kick * 0.1 + tilt * 0.4, 0.05 + vmState.swayX * 0.0012, tilt * 0.5);
      vmState.flash -= dt;
      flashSprite.visible = vmState.flash > 0;
      flashSprite.material.rotation = Math.random() * 6.28;
      // Keep the weapon's light consistent with the sun as the view turns.
      tmpQ.copy(camera.quaternion).invert();
      vmSun.position.copy(sunDir).applyQuaternion(tmpQ).multiplyScalar(5);
      renderer.clearDepth();
      renderer.render(vmScene, vmCamera);
    },
  };
}
