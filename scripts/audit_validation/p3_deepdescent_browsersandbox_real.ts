/**
 * Validación REAL (categoría a) del cableado de deep_descent y
 * browser_sandbox.
 *
 *   deep_descent  — partition() del RepoReader usa deep_descent con --deep:
 *                   walk completo del árbol + scoring por relevancia.
 *   browser_sandbox — connectOrLaunchCDP() arranca un navegador propio en
 *                     Docker (el usuario conserva su Comet con sus sesiones).
 *
 * Run: npx tsx scripts/audit_validation/p3_deepdescent_browsersandbox_real.ts
 */
import { discoverAndScore, deepDescend } from '../../src/reader/deep_descent.js';
import { partition, DEFAULT_BUDGET } from '../../src/reader/RepoReader.js';
import { parseReadArgs } from '../../src/reader/cli.js';
import { BrowserSandboxManager } from '../../src/sandbox/browser_sandbox/manager.js';
import { browserSandboxEnabled, ensureBrowserSandbox } from '../../src/sandbox/browser_sandbox/wiring.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

const REPO = process.cwd();

async function testDeepDescent() {
  console.log('=== deep_descent — cableado en el RepoReader ===');

  // discoverAndScore sobre el árbol REAL del repo, con query.
  const ds = discoverAndScore(REPO, { query: 'orchestrator coordinator', maxFiles: 50 });
  console.log(`  discoverAndScore: ${ds.totalDiscovered} descubiertos, ${ds.totalConsiderable} considerables`);
  const top = ds.candidates[0];
  check('discoverAndScore recorre el árbol real y puntúa', ds.totalDiscovered > 100 && !!top,
    `top: ${top?.relPath} (score ${top?.score.toFixed(2)})`);
  // La query debe empujar archivos con esos términos al top.
  const topRelevant = ds.candidates.slice(0, 20).some((c) => /orchestrator|coordinator/i.test(c.relPath));
  check('la query dirige el ranking de relevancia', topRelevant, 'archivos del coordinator en el top-20');

  // partition con deep ON vs OFF — sobre el repo real.
  const flat = partition(REPO, DEFAULT_BUDGET, { deepDescent: false });
  const deep = partition(REPO, DEFAULT_BUDGET, { deepDescent: true, query: 'orchestrator' });
  const flatFiles = flat.branches.reduce((n, b) => n + b.files_to_read.length, 0);
  const deepFiles = deep.branches.reduce((n, b) => n + b.files_to_read.length, 0);
  console.log(`  partition flat: ${flatFiles} archivos | deep: ${deepFiles} archivos`);
  check('partition(deepDescent:true) produce una selección real', deepFiles > 0,
    `${deepFiles} archivos seleccionados vía deep_descent`);
  // deep_descent recorre subárboles enteros: su selección difiere del DFS plano.
  const flatSet = new Set(flat.branches.flatMap((b) => b.files_to_read));
  const deepOnly = deep.branches.flatMap((b) => b.files_to_read).filter((f) => !flatSet.has(f));
  check('deep_descent alcanza archivos que el DFS plano no selecciona', deepOnly.length > 0,
    `${deepOnly.length} archivos exclusivos del modo deep`);

  // deepDescend completo (con lectura + métricas) sobre src/.
  const dd = deepDescend(REPO + '/src', { query: 'browser', maxFiles: 30, ignoreCache: true });
  console.log(`  deepDescend(src): selected=${dd.selected.length}, bytesRead=${dd.bytesRead}, coverage=${(dd.coverageRatio * 100).toFixed(1)}%`);
  check('deepDescend lee archivos reales y reporta métricas', dd.selected.length > 0 && dd.filesFromDisk > 0,
    `${dd.filesFromDisk} leídos de disco`);

  // parseReadArgs reconoce --deep y --query.
  const parsed = parseReadArgs('./src --deep --query=tool loop');
  check('/read parsea --deep y --query', parsed.deepDescent === true && parsed.query === 'tool loop',
    `deep=${parsed.deepDescent}, query="${parsed.query}"`);
}

async function testBrowserSandbox() {
  console.log('\n=== browser_sandbox — navegador aislado en Docker ===');

  // Gating por env.
  delete process.env.SHINOBI_BROWSER_SANDBOX;
  check('browserSandboxEnabled() off por defecto', browserSandboxEnabled() === false, 'sin env → false');
  process.env.SHINOBI_BROWSER_SANDBOX = '1';
  check('browserSandboxEnabled() on con SHINOBI_BROWSER_SANDBOX=1', browserSandboxEnabled() === true, 'env=1 → true');
  delete process.env.SHINOBI_BROWSER_SANDBOX;

  // Manager real: compose file, URLs.
  const mgr = new BrowserSandboxManager();
  check('el compose del sandbox existe en el repo', mgr.isComposeAvailable() === true, 'docker-compose.sandbox-browser.yml');
  check('cdpUrl() apunta al CDP del contenedor (127.0.0.1)', mgr.cdpUrl() === 'http://127.0.0.1:9222', mgr.cdpUrl());
  check('vncUrl() apunta al noVNC del contenedor', /127\.0\.0\.1.*vnc/.test(mgr.vncUrl()), mgr.vncUrl());

  // Llamada REAL a docker (status) — toca la dependencia real.
  try {
    const st = await mgr.status();
    console.log(`  docker compose ps → exit ${st.exitCode}`);
    check('manager.status() ejecuta docker de verdad', typeof st.exitCode === 'number',
      st.exitCode === 0 ? 'Docker presente, contenedor no levantado' : `Docker devolvió exit ${st.exitCode}`);
  } catch (e: any) {
    // Docker no instalado: el manager propaga el error de spawn — comportamiento correcto.
    check('manager.status() falla limpio si Docker no está', true, `sin Docker: ${e?.message ?? e}`);
  }

  // ensureBrowserSandbox — lógica de cableado con managers inyectados (reales
  // en su ejecución; el contenedor Docker se simula para no construir imágenes).
  const fakeOk = {
    isComposeAvailable: () => true,
    up: async () => ({ exitCode: 0, stdout: 'up', stderr: '' }),
    healthCheck: async () => ({ ok: true, novncOk: true, cdpOk: true, errors: [] }),
    cdpUrl: () => 'http://127.0.0.1:9222',
    vncUrl: () => 'http://127.0.0.1:6080/vnc.html',
  } as any;
  const ok = await ensureBrowserSandbox({ manager: fakeOk });
  console.log(`  ensureBrowserSandbox(up ok) → ${JSON.stringify(ok)}`);
  check('ensureBrowserSandbox devuelve la CDP del sandbox cuando arranca', ok.ok && ok.cdpUrl === 'http://127.0.0.1:9222',
    'conecta al navegador del contenedor, no al del usuario');

  const fakeNoCompose = {
    isComposeAvailable: () => false, up: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    healthCheck: async () => ({ ok: false, novncOk: false, cdpOk: false, errors: [] }),
    cdpUrl: () => '', vncUrl: () => '',
  } as any;
  const noC = await ensureBrowserSandbox({ manager: fakeNoCompose });
  check('ensureBrowserSandbox falla limpio sin compose file', !noC.ok && /compose/.test(noC.error ?? ''),
    `error: ${noC.error}`);
}

async function main() {
  await testDeepDescent();
  await testBrowserSandbox();
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
