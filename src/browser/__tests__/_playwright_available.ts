// Chequeo único y explícito: ¿está instalado el navegador de Playwright en esta
// máquina? Los E2E de navegador (kage_e2e, kage_g4) lo necesitan. Si NO está,
// se SALTAN con un motivo visible en la salida — nunca un skip mudo, nunca un
// fallo rojo por una dependencia de entorno.
//
// Para habilitarlos:  npx playwright install chromium
//
// (top-level await: este módulo se resuelve una vez y ambos ficheros de test
//  importan el resultado ya calculado.)
import { chromium } from 'playwright';

let available = false;
let detail = '';
try {
  const b = await chromium.launch({ headless: true });
  await b.close();
  available = true;
} catch (e) {
  detail = (e as Error).message.split('\n')[0];
}

export const chromiumAvailable: boolean = available;

export const chromiumSkipReason: string =
  `Chromium de Playwright no disponible${detail ? ` (${detail})` : ''}. ` +
  'Ejecuta `npx playwright install chromium` para correr los E2E de navegador.';
