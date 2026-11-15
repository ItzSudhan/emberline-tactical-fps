// Mouse look and keyboard movement. The mouse turns the player's view; WASD, crouch, walk, jump,
// fire, reload and use fill the player's `input` record, the same record a bot brain fills, so
// player and bots are moved by one simulation. Also the yaw/pitch conventions everything shares:
// yaw 0 looks down -Z and positive yaw turns left, as a three.js camera's rotation.y does.

const SENS = 0.0021; // mouse look: radians of view per pixel of mouse travel, scaled down while scoped
const SLOT_KEYS = { Digit1: 'primary', Digit2: 'secondary', Digit3: 'nade', Digit4: 'nade', KeyG: 'nade' };
const WHEEL_ORDER = ['primary', 'secondary', 'nade'];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// The yaw that faces along (dx, dz).
export function yawTo(dx, dz) {
  return Math.atan2(-dx, -dz);
}

// The unit view direction for a yaw and pitch, written into `out`.
export function dirFromAngles(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

// Turns an actor's view toward (yaw, pitch) by at most `rate` radians a second: how bots aim.
export function turnToward(a, yaw, pitch, rate, dt) {
  const max = rate * dt;
  a.yaw = wrapAngle(a.yaw + clamp(wrapAngle(yaw - a.yaw), -max, max));
  a.pitch = clamp(a.pitch + clamp(pitch - a.pitch, -max, max), -1.2, 1.2);
}

export function createControls(input) {
  return {
    // Applied every rendered frame so aiming never waits for a simulation tick.
    look(a, fovScale) {
      const { dx, dy, wheel } = input.takeMouse();
      if (!a.alive) return;
      a.yaw -= dx * SENS * fovScale;
      a.pitch = clamp(a.pitch - dy * SENS * fovScale, -1.45, 1.45);
      if (wheel) {
        let i = WHEEL_ORDER.indexOf(a.current);
        for (let k = 0; k < 3; k++) {
          i = (i + (wheel > 0 ? 1 : 2)) % 3;
          const slot = WHEEL_ORDER[i];
          if (slot === 'primary' && !a.primary) continue;
          if (slot === 'nade' && a.frag + a.smoke + a.flash === 0) continue;
          a.input.slot = slot;
          break;
        }
      }
    },
    // Sampled once per simulation tick.
    fill(a, enabled) {
      const inp = a.input;
      const d = input.down;
      if (!enabled) {
        inp.fwd = inp.side = 0;
        inp.fire = inp.jump = inp.use = inp.scope = false;
        return;
      }
      inp.fwd = (d('KeyW') || d('ArrowUp') ? 1 : 0) - (d('KeyS') || d('ArrowDown') ? 1 : 0);
      inp.side = (d('KeyD') || d('ArrowRight') ? 1 : 0) - (d('KeyA') || d('ArrowLeft') ? 1 : 0);
      inp.jump = d('Space');
      inp.crouch = d('ControlLeft') || d('KeyC');
      inp.walk = d('ShiftLeft') || d('ShiftRight');
      inp.fire = input.mouse.left;
      inp.scope = input.mouse.right;
      inp.use = d('KeyE');
    },
    // One-shot keys that act on the player's weapons.
    press(a, code) {
      if (code === 'KeyR') a.input.reload = true;
      else if (code === 'KeyQ') a.input.slot = a.lastSlot;
      else if (SLOT_KEYS[code]) a.input.slot = SLOT_KEYS[code];
    },
  };
}
