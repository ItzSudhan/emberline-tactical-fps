// Emberline: hands the game in (Node 22, standard library only).
// Copies game/ and screenshots/ to /output (or MAKEFUN_OUTPUT_DIR) and writes dossier.json.
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fail loudly rather than hand in an entry the gate would refuse.
for (const f of ['game/index.html', 'game/vendor/three/three.module.min.js', 'game/vendor/three/three.core.min.js']) {
  if (!existsSync(join(here, f))) throw new Error(`missing ${f}`);
}
const shots = existsSync(join(here, 'screenshots')) ? readdirSync(join(here, 'screenshots')).filter((n) => !n.startsWith('.')) : [];
if (shots.length < 3 || shots.length > 4) throw new Error(`screenshots/ must hold 3 or 4 images, found ${shots.length}`);

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
console.log(`Emberline handed in: game/, ${shots.length} screenshots, dossier.json -> ${out}`);
