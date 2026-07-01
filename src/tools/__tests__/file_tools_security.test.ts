// src/tools/__tests__/file_tools_security.test.ts
//
// Regresión de la auditoría de seguridad 2026-06-30 (AUDIT_SEGURIDAD_2026-06-30.md)
// sobre read_file / write_file / edit_file:
//   - ALTA-03: edit_file interpretaba patrones `$` de JS en el replacement.
//   - ALTA-04: symlinks dentro del workspace escapaban validatePath.
//   - MEDIA-02: write_file sin límite de tamaño.
//   - MEDIA-03: `startsWith` en scratch path colaba directorios hermanos
//     ("scratch-evil") como si fueran el propio scratch.
//   - BAJA-02: race condition en edit_file por read-modify-write sin lock.
//
// Cada escenario reproduce el ataque EXACTO descrito en la auditoría, no una
// versión idealizada. Todos los tests corren con workspaceRoot apuntando al
// directorio temporal de cada test (vía runInContext), porque validatePath
// confina las operaciones al workspace — sin esto, cualquier ruta en
// os.tmpdir() sería rechazada por estar "fuera del workspace", enmascarando
// el comportamiento que queremos probar.

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runInContext } from '../../agents/exec_context.js';
import { validatePath } from '../../utils/permissions.js';
import editFileTool from '../edit_file.js';
import writeFileTool from '../write_file.js';
import readFileTool from '../read_file.js';

function mkWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-filetools-'));
}

/** Ejecuta `fn` con el workspace root fijado a `dir` (límite de validatePath). */
function withWs<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  return runInContext({ cwd: dir, workspaceRoot: dir }, fn);
}

describe('ALTA-03 · edit_file no interpreta patrones $ de JS en el replacement', () => {
  let dir: string;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('replacement con "$\'" no duplica/corrompe el resto del archivo', async () => {
    dir = mkWorkspace();
    const file = path.join(dir, 'config.txt');
    // Contenido con cola reconocible DESPUÉS del target: si `$'` (que en
    // String.prototype.replace significa "todo lo que va DESPUÉS del match")
    // se interpreta, la cola "SECRET_TAIL" se duplicaría dentro del propio
    // reemplazo, corrompiendo el archivo silenciosamente.
    const before = 'PREFIX\nTARGET_LINE\nSECRET_TAIL\n';
    fs.writeFileSync(file, before, 'utf-8');

    const result = await withWs(dir, () => editFileTool.execute({
      path: file,
      target: 'TARGET_LINE',
      // Replacement controlado por el LLM con un patrón especial de JS.
      replacement: 'REPLACED_$\'_END',
    }));

    expect(result.success).toBe(true);
    const after = fs.readFileSync(file, 'utf-8');
    // El reemplazo debe ser literal: el `$'` no debe expandirse a "SECRET_TAIL\n".
    expect(after).toBe('PREFIX\nREPLACED_$\'_END\nSECRET_TAIL\n');
    expect(after).not.toContain('REPLACED_SECRET_TAIL');
  });

  it('replacement con "$&" no duplica el propio target', async () => {
    dir = mkWorkspace();
    const file = path.join(dir, 'config2.txt');
    fs.writeFileSync(file, 'hello TARGET world', 'utf-8');

    const result = await withWs(dir, () => editFileTool.execute({
      path: file,
      target: 'TARGET',
      replacement: '[$&-$&]',
    }));

    expect(result.success).toBe(true);
    const after = fs.readFileSync(file, 'utf-8');
    // Literal: "$&" no debe expandirse al texto matcheado ("TARGET").
    expect(after).toBe('hello [$&-$&] world');
  });
});

describe('ALTA-04 · symlinks dentro del workspace no escapan validatePath', () => {
  let workspace: string;
  let secretDir: string;
  afterEach(() => {
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
    if (secretDir) fs.rmSync(secretDir, { recursive: true, force: true });
  });

  it('un symlink/junction DENTRO del workspace que apunta fuera es rechazado', async () => {
    workspace = mkWorkspace();
    secretDir = mkWorkspace(); // simula un directorio fuera del workspace
    fs.writeFileSync(path.join(secretDir, 'secret.txt'), 'top-secret', 'utf-8');

    const linkPath = path.join(workspace, 'link');
    try {
      // 'junction' no requiere privilegios elevados en Windows (a diferencia
      // de un symlink de archivo). En POSIX, un symlink normal sirve igual.
      fs.symlinkSync(secretDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
      // Si el entorno no permite crear symlinks (permisos), no podemos
      // ejercitar el escenario — no fallamos el suite por una limitación
      // del entorno, pero sí avisamos.
      console.warn('No se pudo crear symlink/junction en este entorno, test omitido:', err);
      return;
    }

    await withWs(workspace, async () => {
      // Léxicamente, "workspace/link/secret.txt" está DENTRO del workspace.
      // Solo `fs.realpathSync` revela que en realidad apunta a `secretDir`,
      // fuera del workspace.
      const targetViaSymlink = path.join(linkPath, 'secret.txt');
      const check = validatePath(targetViaSymlink, 'read');
      expect(check.allowed).toBe(false);
    });
  });

  it('write_file rechaza escribir en un archivo NUEVO detrás de un symlink que escapa', async () => {
    workspace = mkWorkspace();
    secretDir = mkWorkspace();

    const linkPath = path.join(workspace, 'link2');
    try {
      fs.symlinkSync(secretDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
      console.warn('No se pudo crear symlink/junction en este entorno, test omitido:', err);
      return;
    }

    await withWs(workspace, async () => {
      // El archivo "nuevo.txt" no existe aún — ejercita la rama de
      // resolveRealPath que resuelve el directorio PADRE (el symlink).
      const newFileViaSymlink = path.join(linkPath, 'nuevo.txt');
      const result = await writeFileTool.execute({ path: newFileViaSymlink, content: 'x' });
      expect(result.success).toBe(false);
      expect(fs.existsSync(path.join(secretDir, 'nuevo.txt'))).toBe(false);
    });
  });
});

describe('MEDIA-02 · write_file rechaza contenido excesivo', () => {
  let dir: string;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('rechaza un write de más de 10MB con error claro, sin tocar disco', async () => {
    dir = mkWorkspace();
    const file = path.join(dir, 'huge.txt');
    const huge = 'a'.repeat(11_000_000); // 11MB > límite de 10MB

    const result = await withWs(dir, () => writeFileTool.execute({ path: file, content: huge }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too large/i);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('un write normal (pocos KB) sigue funcionando', async () => {
    dir = mkWorkspace();
    const file = path.join(dir, 'normal.txt');
    const result = await withWs(dir, () => writeFileTool.execute({ path: file, content: 'contenido normal' }));
    expect(result.success).toBe(true);
    expect(fs.readFileSync(file, 'utf-8')).toBe('contenido normal');
  });
});

describe('MEDIA-03 · scratch path usa límite de segmento, no startsWith pelado', () => {
  let workspace: string;
  afterEach(() => { if (workspace) fs.rmSync(workspace, { recursive: true, force: true }); });

  it('un directorio hermano "scratch-evil" SÍ exige confirmación al sobreescribir', async () => {
    workspace = mkWorkspace();
    const evilDir = path.join(workspace, 'scratch-evil');
    fs.mkdirSync(evilDir, { recursive: true });
    const evilFile = path.join(evilDir, 'x.txt');
    fs.writeFileSync(evilFile, 'old', 'utf-8'); // ya existe → overwrite

    await withWs(workspace, async () => {
      const needsConfirmation = writeFileTool.requiresConfirmation!({ path: evilFile });
      // "scratch-evil" NO es "scratch": sobreescribir un archivo existente
      // ahí debe seguir pidiendo confirmación.
      expect(needsConfirmation).toBe(true);
    });
  });

  it('el propio directorio "scratch" sigue exento de confirmación', async () => {
    workspace = mkWorkspace();
    const scratchDir = path.join(workspace, 'scratch');
    fs.mkdirSync(scratchDir, { recursive: true });
    const scratchFile = path.join(scratchDir, 'x.txt');
    fs.writeFileSync(scratchFile, 'old', 'utf-8');

    await withWs(workspace, async () => {
      const needsConfirmation = writeFileTool.requiresConfirmation!({ path: scratchFile });
      expect(needsConfirmation).toBe(false);
    });
  });
});

describe('BAJA-02 · edit_file serializa ediciones concurrentes sobre el mismo archivo', () => {
  let dir: string;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('dos edit_file concurrentes sobre el mismo archivo no se pisan (ambos cambios sobreviven)', async () => {
    dir = mkWorkspace();
    const file = path.join(dir, 'shared.txt');
    fs.writeFileSync(file, 'LINE_A\nLINE_B\n', 'utf-8');

    // Disparamos ambas ediciones "a la vez" (mismo proceso Node, sin await
    // intermedio) — sin el mutex por ruta, ambas leen el contenido viejo y
    // la segunda en escribir pisa el cambio de la primera.
    const [r1, r2] = await withWs(dir, () => Promise.all([
      editFileTool.execute({ path: file, target: 'LINE_A', replacement: 'LINE_A_EDITED' }),
      editFileTool.execute({ path: file, target: 'LINE_B', replacement: 'LINE_B_EDITED' }),
    ]));

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    const final = fs.readFileSync(file, 'utf-8');
    expect(final).toContain('LINE_A_EDITED');
    expect(final).toContain('LINE_B_EDITED');
  });
});

describe('read_file sigue funcionando dentro del workspace (sanity check)', () => {
  let dir: string;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('lee un archivo normal dentro del workspace', async () => {
    dir = mkWorkspace();
    const file = path.join(dir, 'ok.txt');
    fs.writeFileSync(file, 'linea1\nlinea2\n', 'utf-8');
    const result = await withWs(dir, () => readFileTool.execute({ path: file }));
    expect(result.success).toBe(true);
    expect(result.output).toContain('linea1');
  });
});
