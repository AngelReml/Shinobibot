// src/tools/index.ts
// Este archivo fuerza la carga y registro de todas las herramientas nativas.
import './read_file.js';
import './write_file.js';
import './edit_file.js';
import './run_command.js';
import './list_dir.js';
import './search_files.js';
import './web_search.js';
import './browser_click.js';
import './browser_scroll.js';
import './browser_click_position.js';
// Subsistema de navegador "Kage" (observe → act → verify). Ver
// docs/BROWSER_SUBSYSTEM.md. Mapa de elementos con ref estable, acción anclada
// con verificación, screencast e input-lock, consentimiento propio.
import './browser_observe.js';
import './browser_act.js';
import './browser_session.js';
import './cloud_mission.js'; // EXTIRPADO — stub vacío
import './web_search_with_warmup.js';
import './clean_extract.js';
import './generate_document.js';
import './n8n_invoke.js';
import './n8n_list_catalog.js';
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

import { getAllTools, getTool, toOpenAITools } from './tool_registry.js';

export { getAllTools, getTool, toOpenAITools };
