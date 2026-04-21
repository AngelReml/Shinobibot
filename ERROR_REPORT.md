# REPORTE DE ERRORES - SHINOBIBOT
**Fecha:** 2026-04-07  
**Analizado por:** Claude Code (claude-sonnet-4-6)

---

## RESUMEN EJECUTIVO

| Prioridad | Cantidad |
|-----------|----------|
| CRITICO   | 5        |
| ALTO      | 5        |
| MEDIO     | 12       |
| BAJO      | 8        |

---

## 1. ERRORES CRITICOS

### C1 — Claves API expuestas en `.env`
- **Archivo:** `.env`
- **Problema:** `GROQ_API_KEY` y `OPENAI_API_KEY` con valores reales en texto plano. Si este repositorio es compartido o subido a Git, las claves quedan expuestas.
- **Accion:** Rotar las claves de inmediato en los dashboards de Groq y OpenAI. Nunca commitear el `.env` con valores reales.

### C2 — Inyección de comandos en orchestrator.ts
- **Archivo:** `src/coordinator/orchestrator.ts` (líneas 364, 326-329)
- **Problema:** El input del usuario se interpola directamente en comandos shell sin sanitización:
  ```typescript
  exec(`...pip.exe install ${moduleName}`, ...)
  ```
  Un input como `lodash; rm -rf /` ejecutaría comandos arbitrarios.
- **Accion:** Usar `execFile()` con array de argumentos, o validar/escapar el input.

### C3 — Ejecución de código generado por LLM sin validación
- **Archivo:** `src/coordinator/orchestrator.ts` (líneas 242-267)
- **Problema:** Código generado por el LLM se escribe en disco y se ejecuta directamente sin análisis de seguridad. Prompt injection podría ejecutar código malicioso.
- **Accion:** Implementar sandbox o whitelist de operaciones permitidas antes de ejecutar código generado.

### C4 — Import a archivo inexistente en executor.ts y test_jwt.ts
- **Archivos:** `scripts/executor.ts` (línea 1), `scripts/test_jwt.ts` (línea 1)
- **Problema:**
  ```typescript
  import { ShinobiOrchestrator } from '../src/coordinator/ShinobiOrchestrator.ts';
  // El archivo real es: orchestrator.ts (no ShinobiOrchestrator.ts)
  ```
  Falla en runtime con `Module not found`.
- **Accion:** Corregir el path a `../src/coordinator/orchestrator.ts`.

### C5 — Método inexistente llamado en executor.ts y test_jwt.ts
- **Archivos:** `scripts/executor.ts` (línea 21), `scripts/test_jwt.ts` (línea 14)
- **Problema:**
  ```typescript
  await ShinobiOrchestrator.executeTask(task, {...});
  // El método no existe; los disponibles son: process(), setMode(), executeWithTerminal()
  ```
- **Accion:** Reemplazar `executeTask()` por el método correcto (`process()` o `executeWithTerminal()`).

---

## 2. ERRORES ALTOS

### A1 — Paths hardcodeados de Windows (no portable)
- **Archivos:** `src/coordinator/orchestrator.ts` (líneas 296-297), `src/bridge/opengravity.ts` (líneas 58-60)
- **Problema:**
  ```typescript
  const VENV_PIP = 'C:\\Users\\angel\\Desktop\\OpenGravity\\sandbox_venv\\Scripts\\pip.exe';
  ```
  Falla en cualquier máquina que no sea la de `angel`. Falla en Linux/macOS.
- **Accion:** Mover a variables de entorno: `process.env.VENV_PYTHON_PATH`.

### A2 — Archivo `.js` importando archivo `.ts`
- **Archivo:** `scripts/executor.js` (línea 1)
- **Problema:**
  ```javascript
  import { OpenGravityBridge } from '../src/bridge/opengravity.ts';
  ```
  Node.js no puede resolver imports `.ts` en runtime.
- **Accion:** Cambiar a extensión `.js` (la versión compilada).

### A3 — Sin null-check en objeto `page` de Playwright
- **Archivo:** `src/coordinator/orchestrator.ts` (líneas 143-168)
- **Problema:** `page` inicializado como `null` y asignado condicionalmente, pero usado sin verificar si es null en líneas posteriores. Crash garantizado si la condición no se cumple.
- **Accion:** Agregar `if (!page) throw new Error(...)` antes de usar `page`.

### A4 — Falta error handler en stream de respuesta HTTP
- **Archivo:** `src/bridge/kernel_client.ts` (líneas 79-98)
- **Problema:** `res.on('data')` y `res.on('end')` están, pero falta `res.on('error', ...)`. Errores en el stream se ignoran silenciosamente.
- **Accion:** Agregar `res.on('error', reject)`.

### A5 — Código solo funciona en Windows
- **Archivo:** `src/coordinator/orchestrator.ts` (líneas 296-297)
- **Problema:** Paths con `Scripts\pip.exe` y `Scripts\python.exe` son exclusivos de Windows venvs. No funciona en Linux/macOS donde la ruta es `bin/python`.
- **Accion:** Detectar plataforma con `process.platform` o usar variables de entorno.

---

## 3. ERRORES MEDIOS

### M1 — Race condition en clase Memory
- **Archivo:** `src/db/memory.ts` (líneas 25-33)
- **Problema:** `addMessage()` hace lectura → modificación → escritura sin bloqueo atómico. Llamadas concurrentes perderán datos.
- **Accion:** Implementar file locking (ej: `proper-lockfile`) o migrar a una DB real.

### M2 — `exit_code` recibe string en lugar de número
- **Archivo:** `src/coordinator/orchestrator.ts` (línea 310)
- **Problema:**
  ```typescript
  exit_code: error?.code ?? 0  // error.code es string (ej: 'ENOENT'), no número
  ```
- **Accion:** Usar `error?.status ?? 1` para código de salida numérico.

### M3 — Sin validación de variables de entorno al startup
- **Archivo:** `src/gateway/llm.ts` (líneas 18-20)
- **Problema:** Si `GROQ_API_KEY` o `OPENAI_API_KEY` no están en `.env`, los valores son `undefined` y las requests fallan silenciosamente.
- **Accion:**
  ```typescript
  if (!process.env.GROQ_API_KEY) throw new Error('Missing GROQ_API_KEY');
  ```

### M4 — Puerto CDP hardcodeado
- **Archivo:** `src/coordinator/orchestrator.ts` (línea 154)
- **Problema:** `http://localhost:9222` hardcodeado. Si el puerto cambia, hay que modificar el código.
- **Accion:** `process.env.CDP_PORT ?? '9222'`.

### M5 — URL de Kernel hardcodeada
- **Archivo:** `src/bridge/kernel_client.ts` (línea 7)
- **Problema:** `const KERNEL_URL = 'http://localhost:9900'` hardcodeado.
- **Accion:** Mover a `.env`: `KERNEL_URL=http://localhost:9900`.

### M6 — JSON.parse sin validación en Memory
- **Archivo:** `src/db/memory.ts` (línea 28)
- **Problema:**
  ```typescript
  const messages = JSON.parse(data) as ChatMessage[];
  ```
  Si el archivo está corrupto, lanza excepción no manejada.
- **Accion:** Envolver en try/catch y retornar `[]` si falla el parse.

### M7 — Sin validación del formato de respuesta del LLM
- **Archivo:** `src/coordinator/orchestrator.ts` (líneas 247-254)
- **Problema:** Solo verifica que `code` no sea falsy, pero no valida que sea código syntácticamente correcto.
- **Accion:** Parsear/validar el código generado antes de escribirlo a disco.

### M8 — Escritura síncrona bloqueando event loop
- **Archivo:** `src/db/memory.ts` (líneas 20-22, 33, 48)
- **Problema:** `fs.writeFileSync()` bloquea el event loop de Node.js en operaciones de disco.
- **Accion:** Migrar a `fs.promises.writeFile()` (async).

### M9 — Prompt injection en prompts del LLM
- **Archivo:** `src/coordinator/orchestrator.ts` (línea 242)
- **Problema:**
  ```typescript
  const prompt = `...que valida: ${input}.`
  ```
  Input malicioso puede manipular el comportamiento del LLM.
- **Accion:** Separar claramente la instrucción del sistema del input del usuario.

### M10 — Clase con solo métodos estáticos siendo instanciada
- **Archivo:** `scripts/executor.ts` (línea 8)
- **Problema:**
  ```typescript
  const shinobi = new ShinobiOrchestrator();
  // Todos los métodos son static
  ```
- **Accion:** Llamar métodos directamente: `ShinobiOrchestrator.process(...)`.

### M11 — Archivos temporales sin cleanup garantizado
- **Archivo:** `src/bridge/opengravity.ts` (líneas 49, 56, 68, 82)
- **Problema:** Scripts temporales creados en `./tmp` sin `finally` block que garantice borrado.
- **Accion:** Usar `try/finally` para asegurar `fs.unlinkSync(tmpFile)`.

### M12 — Exceso de tipo `any` (pérdida de type safety)
- **Archivos:** `src/coordinator/orchestrator.ts`, `src/gateway/llm.ts`, `src/bridge/opengravity.ts`
- **Problema:** Múltiples `Promise<any>`, `catch (err: any)`, parámetros `any[]`.
- **Accion:** Reemplazar con tipos específicos o `unknown` con type narrowing.

---

## 4. ERRORES BAJOS

### B1 — Import `execSync` sin uso
- **Archivo:** `src/bridge/opengravity.ts` (línea 1)
- **Problema:** `execSync` importado pero nunca usado.

### B2 — Módulo `runner.ts` nunca importado
- **Archivo:** `src/utils/runner.ts`
- **Problema:** Exporta `run_command()` pero nadie lo importa.

### B3 — Código muerto en `hack_shinobi.js`
- **Archivo:** `hack_shinobi.js` (línea 39)
- **Problema:** Regex replace que nunca tiene efecto por condición previa.

### B4 — `dotenv.config()` llamado múltiples veces
- **Archivos:** `llm.ts`, `shinobi.ts`, `executor.ts`, `block2_stress.mjs`
- **Problema:** Redundante (idempotente, no rompe nada, pero es ruido).

### B5 — Lookbehind regex (incompatible con Node < 12)
- **Archivo:** `src/coordinator/orchestrator.ts` (líneas 326-329)
- **Problema:** `(?<=\s)` requiere Node.js 12+. Bajo si ya usan versión moderna.

### B6 — Archivos `.bak` en el repo
- **Archivos:** `scripts/executor.ts.bak`, `scripts/test_jwt.ts.bak`
- **Problema:** Archivos de backup que deberían estar en `.gitignore`.

### B7 — Archivos compilados `.js` junto a fuentes `.ts`
- **Problema:** `executor.js`, `shinobi.js`, etc. mezclados con `.ts`. Confunde qué es fuente y qué es output.
- **Accion:** Mover output a directorio `dist/` y agregar `*.js` a `.gitignore` donde corresponda.

### B8 — `temp_file.txt`, `test_file.txt`, `tmp/` en el repo
- **Problema:** Archivos temporales/de prueba que no deberían estar trackeados.
- **Accion:** Agregar a `.gitignore`.

---

## ACCIONES INMEDIATAS REQUERIDAS

1. **Rotar las API keys** en Groq y OpenAI — las actuales en `.env` están comprometidas si el repo fue compartido.
2. **Corregir los imports** en `executor.ts` y `test_jwt.ts` (C4, C5) — el código no funciona en absoluto.
3. **Sanitizar comandos shell** contra inyección (C2) — riesgo de RCE.
4. **Eliminar paths hardcodeados** de usuario (A1) — el código no es portable.
5. **Agregar `.env` y archivos temp a `.gitignore`** si aún no están.

---

*Reporte generado por análisis estático automatizado. Revisar cada punto en contexto antes de aplicar cambios.*
