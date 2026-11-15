// Maps the keyboard and mouse onto the player's `input` record, the same record bots write.
// Mouse look is applied every rendered frame for responsiveness; movement keys are sampled per tick.

import { clamp } from './util.js';

const SENS = 0.0021;
const SLOT_KEYS = { Digit1: 'primary', Digit2: 'secondary', Digit3: 'nade', Digit4: 'nade', KeyG: 'nade' };
const WHEEL_ORDER = ['primary', 'secondary', 'nade'];

export function createControls(input) {
  return {
    // fovScale slows the mouse while scoped so long shots stay controllable.
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
      if (code === 'KeyR') { a.input.reload = true; return true; }
      if (code === 'KeyQ') { a.input.slot = a.lastSlot; return true; }
      if (SLOT_KEYS[code]) { a.input.slot = SLOT_KEYS[code]; return true; }
      return false;
    },
  };
}
