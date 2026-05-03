import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = 'build';
const BUNDLE_FILE = path.join(OUT_DIR, 'shinobi-bundle.cjs');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

console.log('[build_sea] bundling with esbuild...');
try {
  await esbuild.build({
    entryPoints: ['scripts/shinobi.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: BUNDLE_FILE,
    external: [...Object.keys(JSON.parse(fs.readFileSync('package.json', 'utf8')).dependencies), 'playwright-core', 'chromium-bidi'],
    banner: {
      js: 'const { createRequire } = require("module"); const require_ = createRequire(__filename); const __importMetaUrl = require("url").pathToFileURL(__filename).href;'
    },
    define: {
      'import.meta.url': '__importMetaUrl'
    },
    loader: {
      '.ts': 'ts',
      '.json': 'json'
    },
    logLevel: 'info'
  });

  console.log('[build_sea] bundle generated:', BUNDLE_FILE);
  const size = fs.statSync(BUNDLE_FILE).size;
  console.log('[build_sea] bundle size:', (size / 1024 / 1024).toFixed(2), 'MB');
} catch (e) {
  console.error('[build_sea] esbuild failed');
  process.exit(1);
}
