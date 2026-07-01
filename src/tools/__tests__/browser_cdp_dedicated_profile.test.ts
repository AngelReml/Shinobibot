// F1.4 (auditoría 2026-07-01, RANK #5) — CDP sin autenticación en el
// navegador PERSONAL del usuario. Remedio aplicado (opción 1 del plan,
// preferida sobre loopback+token): Shinobi lanza su propio Chromium con un
// --user-data-dir DEDICADO (shinobiBrowserProfileDir), separado del
// perfil de Chrome/Comet del usuario. El CDP en :9222 sigue sin token,
// pero ya no expone una sesión logueada real del usuario — es una
// instancia vacía propia de Shinobi. Este test verifica que ese remedio
// sigue en el código y que nadie reintroduce un bind no-loopback.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_FILE = join(__dirname, '..', 'browser_cdp.ts');

describe('F1.4 — CDP usa perfil de navegador dedicado, no el del usuario', () => {
  it('shinobiBrowserProfileDir() vive bajo una carpeta "Shinobi/browser-profile" propia', async () => {
    const mod = await import('../browser_cdp.js');
    const dir = mod.shinobiBrowserProfileDir();
    expect(dir).toMatch(/Shinobi[\\/]browser-profile$/);
  });

  it('shinobiBrowserProfileDir() NO apunta al perfil por defecto de Chrome/Comet del usuario', async () => {
    const mod = await import('../browser_cdp.js');
    const dir = mod.shinobiBrowserProfileDir();
    expect(dir).not.toMatch(/Google[\\/]Chrome[\\/]User Data/i);
    expect(dir).not.toMatch(/Perplexity[\\/]Comet/i);
  });

  it('el lanzamiento usa --user-data-dir con el perfil dedicado de Shinobi', () => {
    const content = readFileSync(SRC_FILE, 'utf-8');
    expect(content).toMatch(/--user-data-dir=\$\{shinobiBrowserProfileDir\(\)\}/);
  });

  it('el CDP escucha en loopback (localhost), no en 0.0.0.0 ni en una interfaz pública', () => {
    const content = readFileSync(SRC_FILE, 'utf-8');
    expect(content).toMatch(/http:\/\/localhost:\$\{CDP_PORT\}/);
    expect(content).not.toMatch(/0\.0\.0\.0/);
    expect(content).not.toMatch(/--remote-debugging-address/);
  });

  it('ya no aborta el lanzamiento por encontrar un Chrome/Comet del usuario corriendo (comentario de intención se mantiene)', () => {
    const content = readFileSync(SRC_FILE, 'utf-8');
    expect(content).toMatch(/instancia independiente/i);
  });
});
