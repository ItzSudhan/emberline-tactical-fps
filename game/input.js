// Keyboard and mouse. Held keys are read every tick; one-shot presses queue until consumed, so a
// tap between two simulation ticks is never lost. Mouse motion accumulates until the frame reads it.

export function createInput(target) {
  const held = new Set();
  const pressed = [];
  const mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0 };
  const snap = { dx: 0, dy: 0, wheel: 0 };
  let locked = false;

  const onKey = (e, down) => {
    const k = e.code;
    if (['Tab', 'Space', 'ControlLeft', 'KeyB', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(k) && locked) e.preventDefault();
    if (k === 'Tab') e.preventDefault();
    if (down) { if (!held.has(k)) pressed.push(k); held.add(k); }
    else held.delete(k);
  };
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => { held.clear(); mouse.left = mouse.right = false; });
  window.addEventListener('mousemove', (e) => {
    if (!locked) return;
    mouse.dx += e.movementX;
    mouse.dy += e.movementY;
  });
  window.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) mouse.left = true;
    if (e.button === 2) mouse.right = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => { if (locked) mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === target;
    if (!locked) { held.clear(); mouse.left = mouse.right = false; }
  });

  return {
    mouse,
    get locked() { return locked; },
    lock() { if (!locked && target.requestPointerLock) { const p = target.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } },
    unlock() { if (locked) document.exitPointerLock(); },
    down: (code) => held.has(code),
    // Key codes pressed since the frame loop last emptied the queue; the reader sets its length to 0.
    presses: pressed,
    // Copies this frame's mouse motion into a reused snapshot and clears the accumulator.
    takeMouse() { snap.dx = mouse.dx; snap.dy = mouse.dy; snap.wheel = mouse.wheel; mouse.dx = mouse.dy = mouse.wheel = 0; return snap; },
  };
}
