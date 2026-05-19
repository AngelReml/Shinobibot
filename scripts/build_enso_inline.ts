// scripts/build_enso_inline.ts
//
// Bloque 8.2 fix — emite src/web/public/styles/enso-inline.css con la
// silueta del ensō como data: URI inline.
//
// Por qué inline: el PNG original (~7.6 MB) falla como mask-image en
// algunos Chrome reales (no headless). El data URI carga sincrónico
// con la CSS, sin red, y es invulnerable a cualquier CSP/quirk.
//
// El PNG queda intacto en /assets/ para el splash de README.
//
// Uso: npx tsx scripts/build_enso_inline.ts

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import Jimp from 'jimp';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const SRC_PNG = path.join(ROOT, 'src', 'web', 'public', 'assets', 'enso-logo.png');
const OUT_CSS = path.join(ROOT, 'src', 'web', 'public', 'styles', 'enso-inline.css');
// Tamaño objetivo: 512×512 — el watermark llega hasta 520px, y el sidebar
// downscale a 24px lo absorbe sin pérdida visible.
const TARGET = 512;

async function main() {
  const srcBytes = fs.statSync(SRC_PNG).size;
  console.log(`[build] leyendo ${SRC_PNG} (${(srcBytes / 1024 / 1024).toFixed(2)} MB)`);
  const img = await Jimp.read(SRC_PNG);
  console.log(`[build] original: ${img.getWidth()}x${img.getHeight()}`);

  // Preservar aspect ratio. El original es 2816×1536 (no cuadrado), así
  // que escalamos el lado más largo a TARGET y dejamos al CSS mask-size
  // contain hacer el fit final en el elemento.
  const w = img.getWidth(), h = img.getHeight();
  const scale = TARGET / Math.max(w, h);
  img.resize(Math.round(w * scale), Math.round(h * scale), Jimp.RESIZE_BICUBIC);

  // Re-encode como PNG. Jimp ya optimiza; no exponemos compression level
  // porque depende de versión.
  const buffer = await img.getBufferAsync(Jimp.MIME_PNG);
  const base64 = buffer.toString('base64');
  console.log(`[build] resized → ${img.getWidth()}x${img.getHeight()}, ${(buffer.length / 1024).toFixed(1)} KB PNG → ${(base64.length / 1024).toFixed(1)} KB base64`);

  const css = `/* enso-inline.css — generado por scripts/build_enso_inline.ts
 *
 * Imagen del ensō como data: URI inline para uso en mask-image. El PNG
 * original de 7.6 MB en /assets/ es propenso a fallar como mask-image
 * en Chrome real (no headless). Embebida aquí en 512×512 optimizado
 * para garantizar render consistente cross-browser.
 *
 * Variables:
 *   --enso-mask — URL al data: URI, usable directamente en mask-image
 *
 * NO EDITAR A MANO. Regenerar con:
 *   npx tsx scripts/build_enso_inline.ts
 */

:root {
  --enso-mask: url('data:image/png;base64,${base64}');
}
`;

  fs.mkdirSync(path.dirname(OUT_CSS), { recursive: true });
  fs.writeFileSync(OUT_CSS, css);
  console.log(`[build] escrito ${OUT_CSS} (${(css.length / 1024).toFixed(1)} KB)`);
}

main().catch(err => {
  console.error('[build] fatal:', err);
  process.exit(1);
});
