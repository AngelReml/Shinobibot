# Documentación Técnica: Shinobibot v5
**Identidad:** Agente Soberano de Ingeniería de Confiabilidad de Sistemas (SRE)
**Inspiración Arquitectónica:** Claude Code (Anthropic)
**Entorno:** Windows Bare-Metal (Local)

---

## 1. Resumen Ejecutivo
Shinobibot es un agente de IA diseñado para operar directamente sobre el hardware del usuario. A diferencia de los bots convencionales que generan fragmentos de código para que el usuario los ejecute, Shinobibot es **autónomo y centrado en herramientas**. Utiliza el SDK de OpenAI (GPT-4o) para razonar y ejecutar acciones quirúrgicas en el sistema de archivos y la terminal de Windows.

---

## 2. Arquitectura del Sistema
El sistema sigue una arquitectura de **Bucle de Herramientas (Tool Loop)**. El flujo de una petición es el siguiente:
1. **Input:** El usuario introduce una orden en la CLI.
2. **Contextualización:** El `ContextBuilder` construye un prompt que incluye el System Prompt, el historial de mensajes (Memoria) y la orden actual.
3. **Razonamiento (LLM):** OpenAI recibe el contexto y una definición de herramientas (en formato JSON Schema).
4. **Decisión:** El LLM decide si puede responder directamente o si necesita ejecutar una o más herramientas.
5. **Ejecución:** El `ShinobiOrchestrator` intercepta las llamadas a herramientas, las ejecuta localmente y captura el resultado.
6. **Feedback:** Los resultados se inyectan de nuevo en el chat como roles de tipo `tool`.
7. **Resolución:** El ciclo se repite (máximo 10 iteraciones) hasta que el objetivo se cumple.

---

## 3. Directorio de Componentes (Estructura de Carpetas)

### `src/coordinator/orchestrator.ts` (El Cerebro)
Es el motor principal. Gestiona el bucle de eventos, la comunicación con OpenAI y la coordinación entre la memoria y las herramientas. No realiza "generación de scripts ad-hoc"; orquestra funciones predefinidas.

### `src/tools/` (Las Manos)
Capas de abstracción sobre el sistema operativo:
- **`read_file`**: Lectura segura con soporte para rangos de líneas.
- **`write_file`**: Creación y sobreescritura de archivos (con confirmación de seguridad).
- **`edit_file`**: Implementa edición parcial (search-and-replace) para evitar sobreescribir archivos grandes.
- **`run_command`**: Ejecución de comandos en CMD/PowerShell. Filtra patrones peligrosos (rm -rf, format, etc.).
- **`list_dir`**: Exploración de directorios con metadatos de archivos.
- **`search_files`**: Búsqueda global de texto (estilo grep) usando `findstr` de Windows.
- **`web_search`**: Integración con Playwright CDP para navegar por Bing o dominios específicos en tiempo real.

### `src/db/memory.ts` y `context_builder.ts` (La Memoria)
- **Persistencia**: Historial guardado en `memory.json`.
- **Límites**: Límite estricto de 30 mensajes para evitar el desbordamiento de la ventana de contexto.
- **Roles**: Soporta roles de `system`, `user`, `assistant` y `tool`, permitiendo que el bot "recuerde" los resultados de sus acciones previas.

### `src/bridge/` (El Puente al Kernel)
Módulo de conexión con el **OpenGravity Kernel** (vía HTTP). Permite al bot monitorizar el estado de misiones complejas que requieren un entorno de ejecución más pesado o aislado.

---

## 4. Filosofía de "Soberanía y Determinismo"
Shinobibot se rige por un **System Prompt** estricto que elimina la "paja" conversacional de las IAs estándar.
- **No es conversacional por defecto**: El bot prioriza la ejecución sobre la explicación.
- **Sin rastro de IA (Undercover)**: Las salidas están diseñadas para parecer acciones de un ingeniero senior, evitando frases tipo "Como IA, no puedo...".
- **Hardware-Aware**: Sabe que corre en Windows y utiliza herramientas nativas como `findstr` o rutas con backslashes (`\`).

---

## 5. Seguridad y Permisos (`src/utils/permissions.ts`)
Implementa una capa de validación antes de cada acción crítica:
- **Workspace Lock**: Intenta restringir las operaciones de archivo al `WORKSPACE_ROOT` definido en el `.env`.
- **Dangerous Command Filter**: Detecta y bloquea (o pide confirmación) ante comandos de borrado masivo o formateo.

---

## 6. Stack Tecnológico Principal
- **Runtime**: Node.js (con soporte ESM) / ts-node.
- **Modelo**: OpenAI GPT-4o.
- **Automatización Web**: Playwright (CDP mode).
- **Comunicaciones**: Axios / HTTP Nativo.
- **UI**: CLI interactiva basada en `readline` y `chalk`.

---
*Este documento sirve como "instrucciones de mantenimiento" para cualquier entidad de IA que interactúe con el código de Shinobibot.*
