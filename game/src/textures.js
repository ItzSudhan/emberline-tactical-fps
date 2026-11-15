// Procedural materials painted on canvases at load: sun-baked plaster, clay ground, kiln tiles,
// crate planks, teal shipping steel, brick, stencil signs. No image files ship with the game.

import * as THREE from 'three';
import { createRng } from './util.js';

const rng = createRng(7);

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function speckle(g, w, h, count, colors, min, max) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[rng.int(colors.length)];
    g.globalAlpha = rng.range(0.05, 0.22);
    const r = rng.range(min, max);
    g.beginPath();
    g.arc(rng.next() * w, rng.next() * h, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function toTexture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function plaster(base, stain) {
  const [c, g] = canvas(256);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  // Trowel strokes: faint horizontal bands, then fine grit.
  for (let y = 0; y < 256; y += 4) {
    g.fillStyle = `rgba(${rng.next() < 0.5 ? '255,255,255' : '90,60,40'},${rng.range(0.01, 0.05)})`;
    g.fillRect(0, y, 256, rng.range(2, 6));
  }
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = rng.next() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(60,40,25,0.1)';
    g.fillRect(rng.next() * 256, rng.next() * 256, 1.5, 1.5);
  }
  speckle(g, 256, 256, 40, [stain], 6, 26);
  // Rain streaks down from the top edge and a soiled band at the foot.
  for (let i = 0; i < 14; i++) {
    const x = rng.next() * 256, len = rng.range(30, 140);
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(70,45,30,0.22)'); grad.addColorStop(1, 'rgba(70,45,30,0)');
    g.fillStyle = grad; g.fillRect(x, 0, rng.range(2, 7), len);
  }
  g.strokeStyle = 'rgba(60,40,30,0.35)'; g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    let x = rng.next() * 256, y = rng.next() * 256;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += rng.range(-12, 12); y += rng.range(4, 16); g.lineTo(x, y); }
    g.stroke();
  }
  return toTexture(c);
}

function ground() {
  const [c, g] = canvas(512);
  g.fillStyle = '#c99a6b'; g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 2600, ['#a8774d', '#e0b88c', '#8a5d3b', '#f0d0a8'], 1, 9);
  g.strokeStyle = 'rgba(90,55,30,0.25)';
  for (let i = 0; i < 30; i++) {
    g.lineWidth = rng.range(0.5, 2);
    let x = rng.next() * 512, y = rng.next() * 512;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += rng.range(-25, 25); y += rng.range(-25, 25); g.lineTo(x, y); }
    g.stroke();
  }
  return toTexture(c);
}

function tiles(a, b, grout) {
  const [c, g] = canvas(256);
  g.fillStyle = grout; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = (x + y) % 2 ? a : b;
    g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
  }
  speckle(g, 256, 256, 400, ['#000000', '#ffffff', '#6b3b22'], 1, 8);
  return toTexture(c);
}

function concrete() {
  const [c, g] = canvas(256);
  g.fillStyle = '#9d9184'; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 900, ['#7d7266', '#bdb2a4', '#5f564d'], 1, 6);
  g.strokeStyle = 'rgba(40,35,30,0.45)'; g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.stroke();
  return toTexture(c);
}

function crate() {
  const [c, g] = canvas(256);
  g.fillStyle = '#9c6a3c'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i % 2 ? '#a8743f' : '#8f5f34';
    g.fillRect(0, i * 43, 256, 41);
    g.fillStyle = 'rgba(40,20,10,0.5)'; g.fillRect(0, i * 43 + 41, 256, 2);
  }
  speckle(g, 256, 256, 300, ['#3d2412', '#d9a56b'], 1, 4);
  g.fillStyle = '#5e3a1d';
  g.fillRect(0, 0, 256, 22); g.fillRect(0, 234, 256, 22); g.fillRect(0, 0, 22, 256); g.fillRect(234, 0, 22, 256);
  g.save(); g.translate(128, 128); g.rotate(Math.atan2(212, 212));
  g.fillRect(-150, -11, 300, 22); g.restore();
  g.fillStyle = 'rgba(30,20,10,0.55)'; g.font = 'bold 26px monospace'; g.textAlign = 'center';
  g.fillText('KW-' + (100 + rng.int(800)), 128, 210);
  return toTexture(c);
}

function container() {
  const [c, g] = canvas(256);
  g.fillStyle = '#2f7f7a'; g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 5, 256);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 7, 0, 3, 256);
  }
  speckle(g, 256, 256, 260, ['#8a4a22', '#b3622c', '#1d4f4c'], 2, 12);
  g.fillStyle = '#1d3f3d'; g.fillRect(0, 0, 256, 14); g.fillRect(0, 242, 256, 14);
  g.fillStyle = 'rgba(240,230,210,0.75)'; g.font = 'bold 30px monospace'; g.textAlign = 'center';
  g.fillText('EMBER CO', 128, 120);
  return toTexture(c);
}

function brick() {
  const [c, g] = canvas(256);
  g.fillStyle = '#5b3326'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 16; y++) for (let x = -1; x < 5; x++) {
    const off = y % 2 ? 32 : 0;
    g.fillStyle = ['#a24f33', '#8f432b', '#b25d3c', '#97503a'][rng.int(4)];
    g.fillRect(x * 64 + off + 2, y * 16 + 2, 60, 12);
  }
  speckle(g, 256, 256, 300, ['#000000', '#f2c09a'], 1, 3);
  return toTexture(c);
}

function roof() {
  const [c, g] = canvas(128);
  g.fillStyle = '#9c8573'; g.fillRect(0, 0, 128, 128);
  speckle(g, 128, 128, 700, ['#3f352e', '#8d7b6b'], 0.5, 3);
  return toTexture(c);
}

function hazard() {
  const [c, g] = canvas(128, 32);
  g.fillStyle = '#e1b13c'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#222';
  for (let x = -32; x < 160; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 0); g.lineTo(x + 32, 0); g.lineTo(x + 16, 32); g.fill(); }
  return toTexture(c);
}

// Painted floor marking for a bomb site: a hatched border and a huge letter.
export function siteDecal(letter, color) {
  const [c, g] = canvas(512, 512);
  g.clearRect(0, 0, 512, 512);
  g.strokeStyle = color; g.lineWidth = 14; g.globalAlpha = 0.75;
  g.strokeRect(14, 14, 484, 484);
  g.lineWidth = 4;
  for (let i = 0; i < 512; i += 40) { g.beginPath(); g.moveTo(i, 30); g.lineTo(i + 20, 4); g.stroke(); g.beginPath(); g.moveTo(i, 508); g.lineTo(i + 20, 482); g.stroke(); }
  g.globalAlpha = 0.6; g.fillStyle = color; g.font = 'bold 300px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 256, 270);
  return toTexture(c, false);
}

export function signTexture(text, bg, fg) {
  const [c, g] = canvas(512, 128);
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(10, 10, 492, 108);
  g.fillStyle = fg; g.font = 'bold 54px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  speckle(g, 512, 128, 120, ['#000000', '#ffffff'], 1, 5);
  return toTexture(c, false);
}

export function softDot(inner, outer) {
  const [c, g] = canvas(64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return toTexture(c, false);
}

export function makeTextures() {
  return {
    plaster: plaster('#e3c9a3', '#b0703f'),
    plasterWarm: plaster('#d9a77c', '#8f4f2b'),
    ground: ground(),
    tiles: tiles('#b8643c', '#c97a4f', '#5a3424'),
    concrete: concrete(),
    crate: crate(),
    container: container(),
    brick: brick(),
    roof: roof(),
    hazard: hazard(),
  };
}
