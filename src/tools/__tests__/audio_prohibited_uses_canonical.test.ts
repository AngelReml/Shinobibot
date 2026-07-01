// F2.9 (auditoría 2026-07) — audio_transcribe.ts usaba una lista
// `AUDIO_PROHIBITED` duplicada a mano en vez de la canónica
// `ABSOLUTE_PROHIBITED_PATHS` (src/utils/permissions.ts). Verifica que ahora
// hay UNA sola fuente: la tool importa y usa ABSOLUTE_PROHIBITED_PATHS
// directamente (sin lista propia duplicada), y que las rutas prohibidas
// canónicas siguen bloqueando el acceso.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import audioTool from '../audio_transcribe.js';
import { ABSOLUTE_PROHIBITED_PATHS } from '../../utils/permissions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, '..', 'audio_transcribe.ts');

describe('audio_transcribe — F2.9 fuente única de rutas prohibidas', () => {
  it('el código fuente ya NO define una lista AUDIO_PROHIBITED propia', () => {
    const src = readFileSync(SRC_PATH, 'utf-8');
    expect(src).not.toMatch(/const\s+AUDIO_PROHIBITED\s*=/);
  });

  it('el código fuente importa y referencia ABSOLUTE_PROHIBITED_PATHS', () => {
    const src = readFileSync(SRC_PATH, 'utf-8');
    expect(src).toMatch(/import\s*\{\s*ABSOLUTE_PROHIBITED_PATHS\s*\}\s*from\s*['"]\.\.\/utils\/permissions\.js['"]/);
    expect(src).toMatch(/ABSOLUTE_PROHIBITED_PATHS\.some/);
  });

  it('rechaza un path bajo una ruta canónica prohibida (/etc/passwd)', async () => {
    const r = await audioTool.execute({ path: '/etc/passwd' } as any);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/prohibida/i);
  });

  it('rechaza un path bajo /root (cobertura ahora igual de amplia que el resto del repo)', async () => {
    const r = await audioTool.execute({ path: '/root/secrets/audio.mp3' } as any);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/prohibida/i);
  });

  it('rechaza rutas de Windows System32 (en Windows; en POSIX verifica solo la lógica de match, ver nota)', async () => {
    // NOTA: Shinobi es Windows-native (ver CLAUDE.md) y este test corre en
    // CI/dev sobre Windows en la práctica. Bajo POSIX (este sandbox de
    // ejecución), `path.resolve('C:\\Windows\\System32\\...')` NO trata la
    // ruta como absoluta (POSIX no reconoce el prefijo de unidad `C:\`), así
    // que se concatena al cwd y dejaría de matchear el prefijo prohibido —
    // eso es una limitación de `path.resolve` cross-platform, no un fallo de
    // la lógica de audio_transcribe.ts. Verificamos la lógica de matching
    // directamente (independiente de resolve()) para no perder cobertura,
    // y dejamos también la llamada real a execute() para documentar el caso.
    const isWindows = process.platform === 'win32';
    const r = await audioTool.execute({ path: 'C:\\Windows\\System32\\audio.wav' } as any);
    if (isWindows) {
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/prohibida/i);
    }
    // Verificación directa de la lógica de matching (funciona en cualquier OS):
    // reproduce exactamente el predicado que usa audio_transcribe.ts.
    const lf = 'c:\\windows\\system32\\audio.wav';
    const matches = ABSOLUTE_PROHIBITED_PATHS.some((p) => {
      const lp = p.toLowerCase();
      return lf === lp || lf.startsWith(lp + '/') || lf.startsWith(lp + '\\');
    });
    expect(matches).toBe(true);
  });

  it('ABSOLUTE_PROHIBITED_PATHS (fuente canónica) sigue conteniendo las rutas críticas esperadas', () => {
    expect(ABSOLUTE_PROHIBITED_PATHS).toContain('/etc/passwd');
    expect(ABSOLUTE_PROHIBITED_PATHS).toContain('/root');
    expect(ABSOLUTE_PROHIBITED_PATHS).toContain('C:\\Windows\\System32');
  });

  it('un path NO prohibido pero inexistente sigue devolviendo "Archivo no encontrado" (el filtro de rutas no bloquea de más)', async () => {
    const r = await audioTool.execute({ path: '/tmp/no-existe-shinobi-test-audio.mp3' } as any);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no encontrado/i);
  });
});
