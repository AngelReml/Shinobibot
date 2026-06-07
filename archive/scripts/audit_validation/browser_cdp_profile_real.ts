/**
 * Validación REAL — Shinobi lanza su navegador con un perfil DEDICADO.
 * Debe abrir su CDP en 9222 y navegar AUNQUE el Chrome/Comet del usuario
 * estén abiertos — sin pedir cerrar nada.
 *
 * Run: npx tsx scripts/audit_validation/browser_cdp_profile_real.ts
 */
import { connectOrLaunchCDP } from '../../src/tools/browser_cdp.js';

async function main() {
  console.log('Lanzando el navegador de Shinobi (perfil dedicado)...');
  const browser = await connectOrLaunchCDP();
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = await ctx.newPage();
  // Reintento: en arranque en frío la red de Chromium tarda un momento en
  // estar lista (ERR_CONNECTION_RESET en la primera nav inmediata).
  let title = '';
  for (let i = 1; i <= 4; i++) {
    try {
      await page.goto('https://www.upwork.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
      title = await page.title();
      break;
    } catch (e: any) {
      if (i === 4) throw e;
      console.log(`  intento ${i} falló (${String(e?.message ?? e).split('\n')[0]}), reintento...`);
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  console.log(`[OK] navegador propio + CDP 9222 + navegación REAL — título: "${title}"`);
  await page.close();
  // NO se cierra el browser: queda vivo en 9222 para que Shinobi lo use.
  process.exit(0);
}
main().catch((e) => { console.error('[FAIL]', e?.message ?? e); process.exit(1); });
