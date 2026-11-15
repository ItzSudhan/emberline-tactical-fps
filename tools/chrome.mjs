// Drives headless Chrome over the DevTools protocol with Node's standard library only (Node 22 has a
// built-in WebSocket). Used to play-test the game and to take the screenshots in screenshots/.
//
//   const chrome = await launch({ width: 1280, height: 720 });
//   const page = await chrome.open('http://localhost:8080/?demo');
//   await page.eval('window.__game.state.time');
//   await page.screenshot('shot.jpg');
//   console.log(page.errors);
//   await chrome.close();

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// `width` x `height` is the page's size in CSS pixels; `scale` is the device pixel ratio, so a
// screenshot is width * scale pixels wide.
export async function launch({ width = 1280, height = 720, scale = 1, gpu = true } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'chrome-shots-'));
  const args = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    ...(gpu ? ['--use-angle=metal', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error(`Chrome exited (${code})`)));
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  async function open(url) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const cmd = (method, params) => send(method, params, sessionId);
    const errors = [], logs = [];
    listeners.add((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        (msg.params.type === 'error' || msg.params.type === 'warning' ? errors : logs).push(`[${msg.params.type}] ${text}`);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(`[exception] ${d.exception?.description ?? d.text} @ ${d.url ?? ''}:${d.lineNumber ?? ''}`);
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        errors.push(`[log] ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
      } else if (msg.method === 'Network.loadingFailed') {
        errors.push(`[network] ${msg.params.errorText} ${msg.params.requestId}`);
      }
    });
    await cmd('Runtime.enable');
    await cmd('Log.enable');
    await cmd('Network.enable');
    await cmd('Page.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    await cmd('Page.navigate', { url });

    const page = {
      errors, logs, cmd,
      // Evaluates an expression in the page and returns its JSON value; promises are awaited.
      async eval(expression) {
        const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      },
      async waitFor(expression, timeout = 30000, step = 100) {
        const until = Date.now() + timeout;
        for (;;) {
          const v = await page.eval(expression).catch(() => false);
          if (v) return v;
          if (Date.now() > until) throw new Error(`timed out waiting for ${expression}`);
          await sleep(step);
        }
      },
      async screenshot(file, { quality = 86 } = {}) {
        const png = file.endsWith('.png');
        const r = await cmd('Page.captureScreenshot', png ? { format: 'png' } : { format: 'jpeg', quality });
        writeFileSync(file, Buffer.from(r.data, 'base64'));
        return file;
      },
      async key(code, key = code, down = true) {
        await cmd('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key });
      },
      close: () => send('Target.closeTarget', { targetId }),
    };
    return page;
  }

  return {
    open,
    sleep,
    async close() {
      try { await send('Browser.close'); } catch { /* already gone */ }
      proc.kill();
      await sleep(200);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
