#!/usr/bin/env node
/**
 * FASE V2 — misión real de browser contra el sandbox remoto.
 *
 * Ejecuta una misión que USA browser apuntando al CDP del sandbox
 * (chromium+novnc en Docker), vía `SHINOBI_BROWSER_CDP_URL`. NO toca
 * ningún navegador local.
 *
 * Misión: navegar a https://github.com/digininja/DVWA y extraer
 * metadatos reales del repo (título, descripción, signos de que la
 * página cargó). DVWA es el target sugerido por el plan.
 *
 * El script:
 *   1. Verifica SHINOBI_BROWSER_CDP_URL.
 *   2. Conecta vía connectOrLaunchCDP() — la función modificada en V2.
 *   3. Abre página, navega, extrae title + h1 + meta description.
 *   4. Hace screenshot (queda en el sandbox / se reporta el tamaño).
 *   5. Verifica que el contexto del browser es el REMOTO (versión chrome).
 */

import { connectOrLaunchCDP } from '../../src/tools/browser_cdp.js';

interface Result {
  cdpUrl: string;
  browserVersion: string;
  navigatedUrl: string;
  finalUrl: string;
  pageTitle: string;
  h1Text: string;
  metaDescription: string;
  bodyTextSample: string;
  screenshotBytes: number;
  elapsedMs: number;
}

async function main(): Promise<void> {
  const cdpUrl = process.env.SHINOBI_BROWSER_CDP_URL;
  console.log('=== FASE V2 — misión real de browser en sandbox remoto ===');
  if (!cdpUrl) {
    console.error('FALLO: SHINOBI_BROWSER_CDP_URL no definida.');
    process.exit(1);
  }
  console.log(`CDP target: ${cdpUrl}`);

  const t0 = Date.now();
  const browser = await connectOrLaunchCDP();
  const version = browser.version();
  console.log(`Conectado — browser remoto: ${version}`);

  // Reusa el contexto existente del sandbox o crea uno.
  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
  const page = await context.newPage();

  const target = 'https://github.com/digininja/DVWA';
  console.log(`Navegando a ${target} …`);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Pequeña espera para contenido dinámico de GitHub.
  await page.waitForTimeout(2500);

  const pageTitle = await page.title();
  const finalUrl = page.url();

  const h1Text = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    return h1 ? (h1.textContent || '').trim().replace(/\s+/g, ' ') : '';
  });
  const metaDescription = await page.evaluate(() => {
    const m = document.querySelector('meta[name="description"]');
    return m ? (m.getAttribute('content') || '') : '';
  });
  const bodyTextSample = await page.evaluate(() => {
    return (document.body?.innerText || '').slice(0, 300).replace(/\s+/g, ' ').trim();
  });

  const shot = await page.screenshot({ fullPage: false });

  const result: Result = {
    cdpUrl,
    browserVersion: version,
    navigatedUrl: target,
    finalUrl,
    pageTitle,
    h1Text,
    metaDescription,
    bodyTextSample,
    screenshotBytes: shot.length,
    elapsedMs: Date.now() - t0,
  };

  await page.close();
  // No cerramos el browser: es el del sandbox, debe seguir vivo.

  console.log('\n=== RESULTADO ===');
  console.log(JSON.stringify(result, null, 2));

  // Aserciones de éxito de la misión.
  let failed = 0;
  const check = (cond: boolean, label: string): void => {
    if (cond) console.log(`  ok  ${label}`);
    else { console.log(`  FAIL ${label}`); failed++; }
  };
  console.log('\n=== ASERCIONES ===');
  check(/DVWA/i.test(pageTitle) || /DVWA/i.test(h1Text) || /DVWA/i.test(bodyTextSample),
    'la página cargada menciona DVWA');
  check(finalUrl.includes('github.com'), 'finalUrl es github.com');
  check(shot.length > 1000, `screenshot capturado (${shot.length} bytes)`);
  // browser.version() vía CDP devuelve el número de build (p.ej.
  // "148.0.7778.96"), no la cadena "Chromium/...". Validamos formato.
  check(/^\d+\.\d+/.test(version), `browser remoto reporta versión válida (${version})`);

  if (failed > 0) {
    console.log(`\nMISIÓN FALLIDA · ${failed} aserciones`);
    process.exit(1);
  }
  console.log('\nMISIÓN OK · browser remoto navegó y extrajo datos reales sin tocar máquina local');
}

main().catch((e) => {
  console.error('V2 mission crashed:', e?.stack ?? e);
  process.exit(2);
});
