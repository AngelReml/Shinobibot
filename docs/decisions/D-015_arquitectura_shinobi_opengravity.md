# D-015 — Arquitectura definitiva Shinobi ↔ OpenGravity: SEPARAR

**Fecha:** 2026-05-02
**Estado:** Aceptada
**Decisor:** Iván Carbonell
**Sustituye:** D-003 (parcialmente — D-003 decía "no fusionar" pero no formalizaba la separación cliente/servicio)

## Resumen ejecutivo

Shinobi y OpenGravity se separan formalmente. Shinobi pasa a ser el **producto cliente** distribuido como `.exe` al usuario final. OpenGravity pasa a ser la **infraestructura cloud** que vive detrás de zapweave.com con autenticación por API keys. La frontera entre ambos se formaliza con un contrato HTTP (ver Bloque 0 del roadmap v2).

## Contexto

Hasta hoy el proyecto trataba a Shinobi y OpenGravity como dos partes del mismo sistema sin frontera clara. La pregunta abierta era: ¿unirlos en monorepo, mantenerlos separados con dependencia técnica, o separarlos definitivamente como cliente/servicio?

La decisión depende de los datos. La inspección de SOLO LECTURA del 2026-05-02 los aporta.

## Datos crudos (inspección 2026-05-02)

### Imports cruzados entre repos

| Dirección | Coincidencias |
|-----------|---------------|
| Shinobi → OpenGravity | 0 |
| OpenGravity → Shinobi | 0 |

### Tools de Shinobi vs llamadas al kernel

De 14 archivos en `src/tools/` de Shinobi, solo 1 (`kernel_mission.ts`) llama al kernel HTTP. El resto son tools locales independientes.

| Tool | LlamaKernel |
|------|-------------|
| browser_click.ts | False |
| browser_click_position.ts | False |
| browser_scroll.ts | False |
| edit_file.ts | False |
| index.ts | True (solo importa kernel_mission) |
| kernel_mission.ts | True |
| list_dir.ts | False |
| read_file.ts | False |
| run_command.ts | False |
| search_files.ts | False |
| tool_registry.ts | False |
| web_search.ts | False |
| web_search_with_warmup.ts | False |
| write_file.ts | False |

### Dependencias

`package.json` de Shinobi contiene 4 dependencies: `axios`, `dotenv`, `openai`, `playwright`. **Cero referencias a OpenGravity.**

### Referencias a módulos de OpenGravity en código de Shinobi

| Módulo buscado | Coincidencias en Shinobi |
|----------------|--------------------------|
| SkillsAgent | 0 |
| MutationEngine | 0 |
| n8nClient | 0 |
| run_mutation | 0 |

### Modos de ejecución de Shinobi

`src/coordinator/orchestrator.ts` define tres modos:

- `local`: filtra `start_kernel_mission` de las tools disponibles. Shinobi opera 100% sin OpenGravity.
- `kernel`: incluye `start_kernel_mission`. Shinobi puede delegar misiones complejas al kernel HTTP.
- `auto`: decisión automática según heurística.

**Modo por defecto actual:** `kernel` (línea 16 del orchestrator).

### Bridge HTTP

`src/bridge/kernel_client.ts` (Shinobi) provee `KernelClient` con métodos `isOnline()`, `startMission()`, `waitForMission()`. URL leída de `.env` (variable `KERNEL_URL`). Comunicación HTTP pura.

## Opciones consideradas

### Opción A — INTEGRAR (monorepo único)

Mover todo a un solo repositorio.

- **Por:** simplifica gestión de versiones.
- **Contra:** crea acoplamiento donde hoy hay independencia. OpenGravity (7.4 GB con datos generados, venvs Python, 54.000+ archivos en tmp_run) NO se puede empaquetar como .exe distribuible. Mezcla código de cliente con código de servicio. Dificulta evolución independiente. **Mal movimiento técnico.**
- **Descartada.**

### Opción B — SEPARAR formalmente (cliente/servicio)

Reconocer que ya están separados de facto y formalizar la frontera con un contrato HTTP.

- **Por:** los datos confirman que el acoplamiento real es del 3% (1 tool de 14, una variable de entorno, una clase bridge). Permite empaquetar Shinobi como .exe distribuible. Permite que OpenGravity viva en cloud (zapweave.com) y dé servicio a múltiples Shinobi simultáneamente. Habilita network effect: una mejora en cloud beneficia a todos los clientes al instante. Permite control central de costes LLM, biblioteca de workflows monetizable, skills compartidas.
- **Contra:** requiere construir contrato HTTP formal con auth, versionado, manejo de errores. Trabajo concreto del Bloque 0 del roadmap v2.
- **ELEGIDA.**

### Opción C — Status quo (separados sin contrato formal)

Dejar las cosas como están: técnicamente separados pero sin formalizar.

- **Por:** cero trabajo inmediato.
- **Contra:** bloquea distribución como .exe. Bloquea cloud. Bloquea visión cumbre. **No es una opción real, solo postergación.**
- **Descartada.**

## Decisión

**SEPARAR formalmente como cliente/servicio.**

- **Shinobi** = producto cliente, distribuido como .exe Windows. Vive en el PC del usuario. Contiene browser automation, sesiones humanas, memoria local, tools simples, CLI, setup wizard.
- **OpenGravity** = infraestructura cloud, detrás de https://kernel.zapweave.com (o subdominio similar) con autenticación por API key. Contiene LLMs vía OpenRouter, swarms jerárquicos, n8n, mutación / auto-mejora, biblioteca de skills compartidas, dashboard de operación.
- **Frontera** = contrato HTTP versionado (v1, v2, ...) definido en el Bloque 0 del roadmap v2.

## Implicaciones

### Para Shinobi

1. La tool `kernel_mission.ts` se renombra a `cloud_mission.ts` y apunta a la URL de OpenGravity en cloud (no localhost).
2. Variable `.env`: `KERNEL_URL` se renombra a `OPENGRAVITY_URL` para reflejar la realidad.
3. Nueva variable: `SHINOBI_API_KEY` (clave única por instancia distribuida).
4. Cliente HTTP refactorizado para incluir auth + manejo de errores + fallback gracioso si OpenGravity no responde.
5. Modo `local` mantiene su utilidad: Shinobi puede operar sin OpenGravity para misiones simples.

### Para OpenGravity

1. Endpoints públicos versionados: `/v1/missions/swarm`, `/v1/llm/chat`, `/v1/n8n/workflow/{id}`, `/v1/skills/*`, `/v1/health`.
2. Tabla `shinobi_keys` en SQLite del kernel para gestionar claves de clientes.
3. Despliegue en VPS Contabo con dominio kernel.zapweave.com, HTTPS, Cloudflare delante.
4. Tracking de uso por API key (tokens, peticiones, costes).

### Para el roadmap

- Bloque 0 del roadmap v2: definir y documentar el contrato API.
- Bloque 1 del roadmap v2: este documento (D-015).
- Bloques posteriores: cada uno está etiquetado [SHINOBI], [OPENGRAVITY] o [CONTRATO] para que quede claro dónde se ejecuta cada trabajo.

## Plan de implementación

Definido en el Roadmap Definitivo v2 (Bloque 0 al Bloque 12). Resumen:

1. **Bloque 0** (CONTRATO): definir contrato API v1.
2. **Bloque 1** (META): este documento.
3. **Bloque 2** (OPENGRAVITY): switch OpenAI → OpenRouter centralizado.
4. **Bloque 3** (SHINOBI): integrar memoria de OpenClaw.
5. **Bloque 4** (OPENGRAVITY): bridge n8n + biblioteca de workflows.
6. **Bloque 5** (OPENGRAVITY): validar pipeline de mutación.
7. **Bloque 6** (SHINOBI): modo agente residente.
8. **Bloque 7** (OPENGRAVITY): swarms jerárquicos como servicio cloud.
9. **Bloque 8** (SHINOBI): setup wizard + OAuth simplificado.
10. **Bloque 9** (SHINOBI): aprender a usar programas.
11. **Bloque 10** (META): despliegue zapweave.com producción.
12. **Bloque 11** (OPENGRAVITY): limpieza y consolidación.
13. **Bloque 12** (SHINOBI): empaquetado .exe distribuible.
14. **Bloque 13** (META): empresa sintética (a definir al cierre del Bloque 12).

## Referencias

- Roadmap Definitivo v2 (documento Word entregado 2026-05-02)
- Inspección de dependencia 2026-05-02 (datos crudos en sesión)
- D-003 (decisión previa, parcialmente sustituida)
