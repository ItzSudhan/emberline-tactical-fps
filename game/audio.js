// Every sound is synthesised with WebAudio: filtered noise and oscillators shaped by envelopes.
// Sounds are placed by distance and by angle relative to where the listener looks, and distant
// shots get more of a procedural reverb, so you can hear where a fight is.

const SHOT = {
  pistol: { freq: 2400, q: 0.8, body: 150, len: 0.16, gain: 0.55 },
  heavy: { freq: 1500, q: 0.7, body: 110, len: 0.22, gain: 0.7 },
  smg: { freq: 2800, q: 0.9, body: 170, len: 0.11, gain: 0.45 },
  rifle: { freq: 1900, q: 0.7, body: 95, len: 0.2, gain: 0.65 },
  shotgun: { freq: 1100, q: 0.5, body: 70, len: 0.32, gain: 0.85 },
  sniper: { freq: 1300, q: 0.6, body: 60, len: 0.45, gain: 0.95 },
};

export function createAudio() {
  let ctx = null, master, verb, verbIn, noise;
  const listener = { x: 0, z: 0, yaw: 0 };

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Reverb impulse: 1.6 s of decaying noise, a stand-in for the plant's concrete walls.
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    verb = ctx.createConvolver();
    verb.buffer = ir;
    verbIn = ctx.createGain();
    verbIn.gain.value = 0.5;
    verbIn.connect(verb).connect(master);
  }

  // Output chain for a sound at world (x, z): distance gain, stereo pan, reverb send.
  function place(x, z, base, range = 30) {
    const dx = x - listener.x, dz = z - listener.z;
    const d = Math.hypot(dx, dz);
    const g = ctx.createGain();
    g.gain.value = base / (1 + (d / range) ** 2 * 4);
    const pan = ctx.createStereoPanner();
    if (d > 0.5) {
      const rx = Math.cos(listener.yaw), rz = -Math.sin(listener.yaw);
      pan.pan.value = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.85;
    }
    g.connect(pan).connect(master);
    const send = ctx.createGain();
    send.gain.value = Math.min(0.9, 0.12 + d / 60);
    g.connect(send).connect(verbIn);
    return { node: g, dist: d };
  }

  function burst(out, t, len, type, freq, q, gain) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(env).connect(out);
    src.start(t, Math.random() * 0.5, len + 0.05);
  }

  function tone(out, t, len, type, f0, f1, gain) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(env).connect(out);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  const api = {
    init,
    get ready() { return !!ctx; },
    setListener(x, z, yaw) { listener.x = x; listener.z = z; listener.yaw = yaw; },
    shot(kind, x, z, mine) {
      if (!ctx) return;
      const s = SHOT[kind] ?? SHOT.rifle;
      const t = ctx.currentTime;
      const { node, dist } = place(x, z, mine ? s.gain : s.gain * 1.1, 45);
      // Far shots lose their crack: lower the filter with distance.
      const crack = s.freq * Math.max(0.25, 1 - dist / 90);
      burst(node, t, s.len, 'bandpass', crack, s.q, 1);
      burst(node, t, s.len * 1.8, 'lowpass', 600, 0.5, 0.6);
      tone(node, t, 0.12, 'sine', s.body * 2, s.body * 0.5, mine ? 0.9 : 0.5);
    },
    step(x, z, mine) {
      if (!ctx) return;
      const { node } = place(x, z, mine ? 0.12 : 0.35, 9);
      burst(node, ctx.currentTime, 0.07, 'lowpass', 700 + Math.random() * 500, 1, 1);
    },
    click(x, z, pitch = 1) {
      if (!ctx) return;
      const { node } = place(x, z, 0.35, 8);
      const t = ctx.currentTime;
      tone(node, t, 0.03, 'square', 2200 * pitch, 1800 * pitch, 0.25);
      tone(node, t + 0.09, 0.04, 'square', 1500 * pitch, 1200 * pitch, 0.25);
    },
    dry(x, z) { if (ctx) tone(place(x, z, 0.4, 6).node, ctx.currentTime, 0.04, 'square', 900, 700, 0.2); },
    hitmark(head) {
      if (!ctx) return;
      const t = ctx.currentTime;
      if (head) { tone(master, t, 0.35, 'sine', 1900, 1750, 0.35); burst(master, t, 0.06, 'highpass', 3000, 1, 0.4); }
      else tone(master, t, 0.06, 'triangle', 1200, 900, 0.25);
    },
    hurt() { if (ctx) { const t = ctx.currentTime; tone(master, t, 0.18, 'sine', 140, 60, 0.6); burst(master, t, 0.1, 'lowpass', 400, 1, 0.5); } },
    explosion(x, z) {
      if (!ctx) return;
      const { node } = place(x, z, 1.4, 50);
      const t = ctx.currentTime;
      burst(node, t, 1.4, 'lowpass', 900, 0.7, 1);
      burst(node, t, 0.25, 'bandpass', 2400, 0.6, 0.6);
      tone(node, t, 0.8, 'sine', 90, 30, 1);
    },
    smoke(x, z) { if (ctx) burst(place(x, z, 0.5, 20).node, ctx.currentTime, 2.6, 'highpass', 2500, 0.4, 0.5); },
    flashbang(x, z, blinded) {
      if (!ctx) return;
      const t = ctx.currentTime;
      burst(place(x, z, 1.1, 40).node, t, 0.3, 'bandpass', 3000, 0.8, 1);
      if (blinded > 0.5) tone(master, t, Math.min(3.5, blinded), 'sine', 3400, 3300, 0.12);
    },
    bounce(x, z) { if (ctx) tone(place(x, z, 0.3, 10).node, ctx.currentTime, 0.05, 'triangle', 700, 500, 0.4); },
    beep(x, z) { if (ctx) tone(place(x, z, 0.5, 25).node, ctx.currentTime, 0.09, 'square', 1250, 1240, 0.3); },
    planted() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [523, 659, 784].forEach((f, i) => tone(master, t + i * 0.12, 0.25, 'sawtooth', f, f, 0.12));
    },
    cash() { if (ctx) { const t = ctx.currentTime; tone(master, t, 0.05, 'square', 2600, 2600, 0.12); tone(master, t + 0.06, 0.12, 'square', 3300, 3300, 0.12); } },
    error() { if (ctx) tone(master, ctx.currentTime, 0.12, 'square', 220, 180, 0.15); },
    stinger(win) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const notes = win ? [392, 494, 587, 784] : [392, 349, 311, 262];
      notes.forEach((f, i) => tone(master, t + i * 0.14, 0.4, 'triangle', f, f, 0.22));
    },
    radio() { if (ctx) { const t = ctx.currentTime; burst(master, t, 0.08, 'bandpass', 1800, 2, 0.15); tone(master, t + 0.02, 0.05, 'square', 1400, 1400, 0.05); } },
    scope() { if (ctx) tone(master, ctx.currentTime, 0.06, 'triangle', 600, 900, 0.15); },
  };
  return api;
}
