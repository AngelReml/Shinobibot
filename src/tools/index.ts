// src/tools/index.ts
// Este archivo fuerza la carga y registro de todas las herramientas nativas.
import './read_file.js';
import './write_file.js';
import './edit_file.js';
import './run_command.js';
import './list_dir.js';
import './search_files.js';
import './web_search.js';
// F0.5 (auditoría 2026-07): browser_click.ts / browser_click_position.ts /
// browser_scroll.ts se importaban aquí (ejecutaban su top-level al
// arrancar) pero NUNCA llamaban registerTool() — ~350 LOC de código muerto
// activo. Su funcionalidad de click/scroll está cubierta por browser_act.ts
// (subsistema Kage, ver abajo) — confirmado por grep antes de eliminar.
// Los tres archivos se borraron del árbol junto con este import.
//
// Subsistema de navegador "Kage" (observe → act → verify). Ver
// docs/BROWSER_SUBSYSTEM.md. Mapa de elementos con ref estable, acción anclada
// con verificación, screencast e input-lock, consentimiento propio.
import './browser_observe.js';
import './browser_act.js';
import './browser_session.js';
// F0.5: cloud_mission.js / n8n_invoke.js / n8n_list_catalog.js eran stubs
// 'export {}' de tools EXTIRPADAS (Fase 2, 2026-06-12) que se seguían
// importando sin necesidad — eliminados junto con los stubs.
import './web_search_with_warmup.js';
import './clean_extract.js';
import './generate_document.js';
import './skill_list.js';
import './skill_request_generation.js';
import './memory_tool.js';
import './committee_review.js';
import './list_specialist_agents.js';
import './generate_chart.js';
import './prompt_refactor.js';
import './specialist_agents.js';
// Delegación multi-agente: crea subagentes acotados (caja de mínimo privilegio,
// tools destructivas filtradas, profundidad acotada). Ver src/agents/agent_loop.ts.
import './spawn_agent.js';
// E2/E4 sobre el cimiento: fábrica de skills verificadas+firmadas y enjambre.
import './synthesize_skill.js';
import './run_swarm.js';
// Team: subagentes que mutan ficheros EN PARALELO, aislados por worktree+contexto.
import './run_team.js';
// Enjambre orquestado por DAG (cerebro de swarm-ide portado sobre el team de Shinobi).
import './run_swarm_orchestrated.js';
// E3: audit como sustrato — trust-scores por herramienta desde audit.jsonl.
import './trust_report.js';
// MCP: conecta servidores externos y registra sus tools como nativas.
import './mcp_connect.js';
// ToolSearch sobre E3: descubrimiento de tools por relevancia + fiabilidad.
import './tool_search.js';
// LSP-flavored: diagnósticos de código (TS/JS/JSON/Python).
import './lint_file.js';
import './screen_observe.js';
import './screen_act.js';

// Windows-elite tool pack (Tier S #5): expone capacidades nativas que
// agentes cross-platform (Hermes, OpenClaw) no pueden cubrir bien.
import './clipboard_read.js';
import './clipboard_write.js';
import './process_list.js';
import './system_info.js';
import './disk_usage.js';
import './env_list.js';
import './network_info.js';
import './registry_read.js';
import './task_scheduler_create.js';
import './windows_notification.js';
import './voice_speak.js';
import './audio_transcribe.js';

// F5 (P5-Nivel 1): Kagemusha — misión nocturna de investigación bajo demanda.
// La "one-line follow-up" anotada en src/kagemusha/trigger.ts (F4.1). Doble
// gate: KAGEMUSHA_ENABLED (default off) + requiresConfirmation (D-017).
import './kagemusha_run.js';

import { getAllTools, getTool, toOpenAITools } from './tool_registry.js';
// FIX 1.7 — Activación del sistema de plugins ESM (manifiestos explícitos).
// HotPlugRegistry (hot_plug_registry.ts) es el sandbox isolated-vm para
// plugins NO confiables; plugin_loader es el cargador principal de plugins
// del operador con manifiestos validados.
//
// F1.2 (auditoría 2026-07, RANK #2): antes esta línea invocaba
// `loadAllPlugins()` INCONDICIONALMENTE como side-effect del propio import
// de este barrel — cualquier arranque del orquestador (web, CLI, gateway,
// canales, TESTS) cargaba y ejecutaba sin sandbox cualquier plugin presente
// en `<cwd>/plugins/`, sin el gate `SHINOBI_PLUGINS_ENABLED` que sí protege
// la otra vía de entrada en `scripts/shinobi.ts`. Ahora ambas vías exigen el
// mismo gate explícito (default OFF) — importar este barrel nunca ejecuta
// plugins por sí solo.
//
// ALTA-02 (F1.2) cerrado 2026-07-03: `importPlugin` (plugin_loader.ts) ya no
// usa `import()` nativo — el entry pasa por el guard AST `scanForbidden`
// (confine/ast_guard.ts) y corre confinado en isolated-vm vía
// `buildSandboxedTool` (mismo mecanismo que `hot_plug_registry.ts`). Un
// plugin habilitado con SHINOBI_PLUGINS_ENABLED=1 ya no corre con
// privilegios completos del proceso. Ver DECISIONES.md.
import { loadAllPlugins } from '../plugins/plugin_loader.js';
import { join } from 'path';

/**
 * Carga los plugins de `<cwd>/plugins/` — SOLO si el operador lo activó
 * explícitamente (`SHINOBI_PLUGINS_ENABLED=1`), igual que en
 * `scripts/shinobi.ts`. Se expone como función (no side-effect de import)
 * para que llamar a este módulo desde un test, un worker, o cualquier
 * consumidor que solo necesite el registro de tools NUNCA dispare la carga
 * de plugins como efecto colateral inesperado.
 */
export function maybeLoadPlugins(): void {
  if (process.env.SHINOBI_PLUGINS_ENABLED !== '1') return;
  loadAllPlugins(join(process.cwd(), 'plugins')).then(({ loaded, errors }) => {
    if (loaded.length > 0) console.log(`[plugins] ${loaded.length} plugin(s) cargados (SIN sandbox isolated-vm — ver ALTA-02 en plugin_loader.ts).`);
    for (const e of errors) console.warn(`[plugins] Error cargando ${e.manifestPath}: ${e.errors.join('; ')}`);
  }).catch((err: Error) => console.warn('[plugins] loadAllPlugins falló:', err.message));
}

// Se invoca aquí (en vez de dejarlo como responsabilidad exclusiva de cada
// entry point) para que CUALQUIER consumidor de este barrel que active el
// flag reciba sus plugins — pero el gate de dentro de `maybeLoadPlugins()`
// es lo que de verdad decide si algo se ejecuta, no el import.
maybeLoadPlugins();

export { getAllTools, getTool, toOpenAITools };
