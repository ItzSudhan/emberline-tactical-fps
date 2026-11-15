// Every tunable the simulation reads lives here, so balance is edited in one place.

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const CELL = 2; // metres per map cell
export const GRAVITY = 20;

export const BODY = {
  radius: 0.34,
  height: 1.8,
  crouchHeight: 1.28,
  eye: 1.62,
  crouchEye: 1.14,
  headRadius: 0.19,
  runSpeed: 5.5,
  walkFactor: 0.5,
  crouchFactor: 0.36,
  accel: 52,
  airAccel: 8,
  friction: 10,
  jumpSpeed: 6.7,
  step: 0.48,
};

export const ROUND = {
  freeze: 5,
  buyWindow: 20,
  length: 105,
  bombTimer: 40,
  plantTime: 3.2,
  defuseTime: 7,
  kitDefuseTime: 3.6,
  endDelay: 5.5,
  toWin: 7,
  teamSize: 5,
};

export const ECON = {
  start: 800,
  max: 16000,
  kill: 300,
  win: 3250,
  winBomb: 3500,
  loss: 1400,
  lossStep: 500,
  lossMax: 3400,
  plant: 300,
};

export const SIDES = {
  att: { name: 'Vanguard', short: 'VGD', color: 0xd4652f, css: '#e07a43', verb: 'plant the Igniter' },
  def: { name: 'Bastion', short: 'BST', color: 0x2b9e95, css: '#3cc0b4', verb: 'hold both sites' },
};

// Spread and recoil are radians. moveSpread is added in full at run speed, scaled down as you slow.
export const WEAPONS = {
  pike: {
    id: 'pike', name: 'Pike-9', slot: 'secondary', kind: 'pistol', price: 0,
    dmg: 30, rpm: 400, auto: false, mag: 12, reserve: 48, reload: 2.1, falloff: 0.82, pen: 0.5, headMult: 4,
    spread: 0.006, moveSpread: 0.04, airSpread: 0.16, kick: 0.028, kickYaw: 0.006, sprayGrow: 0.008, recover: 9,
    speed: 1.0, pellets: 1, sound: 'pistol', reward: 300,
  },
  marten: {
    id: 'marten', name: 'Marten .45', slot: 'secondary', kind: 'pistol', price: 650,
    dmg: 52, rpm: 230, auto: false, mag: 7, reserve: 35, reload: 2.3, falloff: 0.78, pen: 0.85, headMult: 4,
    spread: 0.005, moveSpread: 0.06, airSpread: 0.2, kick: 0.05, kickYaw: 0.01, sprayGrow: 0.016, recover: 6,
    speed: 0.98, pellets: 1, sound: 'heavy', reward: 300,
  },
  wren: {
    id: 'wren', name: 'Wren SMG', slot: 'primary', kind: 'smg', price: 1250,
    dmg: 24, rpm: 820, auto: true, mag: 30, reserve: 120, reload: 2.3, falloff: 0.7, pen: 0.6, headMult: 3.6,
    spread: 0.009, moveSpread: 0.028, airSpread: 0.12, kick: 0.011, kickYaw: 0.006, sprayGrow: 0.0025, recover: 8,
    speed: 0.96, pellets: 1, sound: 'smg', reward: 600,
  },
  brush: {
    id: 'brush', name: 'Brushcutter', slot: 'primary', kind: 'shotgun', price: 1100,
    dmg: 17, rpm: 72, auto: false, mag: 6, reserve: 32, reload: 2.7, falloff: 0.45, pen: 0.6, headMult: 2.5,
    spread: 0.06, moveSpread: 0.015, airSpread: 0.1, kick: 0.08, kickYaw: 0.01, sprayGrow: 0, recover: 6,
    speed: 0.92, pellets: 9, sound: 'shotgun', reward: 900,
  },
  kestrel: {
    id: 'kestrel', name: 'Kestrel AR', slot: 'primary', kind: 'rifle', price: 2900,
    dmg: 35, rpm: 600, auto: true, mag: 30, reserve: 90, reload: 2.5, falloff: 0.97, pen: 0.78, headMult: 4,
    spread: 0.0035, moveSpread: 0.1, airSpread: 0.22, kick: 0.017, kickYaw: 0.009, sprayGrow: 0.0035, recover: 7,
    speed: 0.86, pellets: 1, sound: 'rifle', reward: 300,
  },
  longreach: {
    id: 'longreach', name: 'Longreach', slot: 'primary', kind: 'sniper', price: 4500,
    dmg: 118, rpm: 42, auto: false, mag: 5, reserve: 20, reload: 3.4, falloff: 0.99, pen: 0.97, headMult: 3,
    spread: 0.0012, moveSpread: 0.16, airSpread: 0.3, kick: 0.06, kickYaw: 0.004, sprayGrow: 0, recover: 4,
    unscoped: 0.07, zoomFov: 24, speed: 0.78, pellets: 1, sound: 'sniper', reward: 100,
  },
};

export const GEAR = {
  vest: { name: 'Kevlar Vest', price: 650 },
  helm: { name: 'Vest + Helm', price: 1000 },
  kit: { name: 'Defuse Kit', price: 400 },
  frag: { name: 'Shard Grenade', price: 300, fuse: 1.6, radius: 7, damage: 98 },
  smoke: { name: 'Veil Smoke', price: 300, fuse: 1.4, radius: 4.4, life: 16 },
  flash: { name: 'Glare Flash', price: 200, fuse: 1.3, radius: 22 },
};

// Buy menu layout: key, item id, category.
export const SHOP = [
  { key: '1', id: 'marten', cat: 'Pistols' },
  { key: '2', id: 'wren', cat: 'Primaries' },
  { key: '3', id: 'brush', cat: 'Primaries' },
  { key: '4', id: 'kestrel', cat: 'Primaries' },
  { key: '5', id: 'longreach', cat: 'Primaries' },
  { key: '6', id: 'vest', cat: 'Gear' },
  { key: '7', id: 'helm', cat: 'Gear' },
  { key: '8', id: 'kit', cat: 'Gear' },
  { key: '9', id: 'frag', cat: 'Utility' },
  { key: '0', id: 'smoke', cat: 'Utility' },
  { key: '-', id: 'flash', cat: 'Utility' },
];

export const BOT_NAMES = {
  att: ['Rook', 'Tansy', 'Ferro', 'Quill', 'Moth', 'Cinder'],
  def: ['Basalt', 'Juniper', 'Halyard', 'Sable', 'Wick', 'Larch'],
};

// Bot skill: reaction delay (s), aim settle rate, residual aim error (rad), counter-strafe discipline.
export const BOT_SKILL = {
  easy: { react: 0.55, settle: 4, error: 0.035, discipline: 0.4, spray: 4 },
  normal: { react: 0.36, settle: 6.5, error: 0.018, discipline: 0.75, spray: 6 },
  hard: { react: 0.24, settle: 9, error: 0.009, discipline: 0.95, spray: 8 },
};
