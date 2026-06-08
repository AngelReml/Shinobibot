// src/agents/agent_loop.ts
//
// CIMIENTO del subsistema multi-agente (motor E1/E2/E4 del plan competitivo).
//
// Un bucle de agente REUTILIZABLE y autocontenido: ejecuta una tarea acotada
// con una CAJA de tools de mínimo privilegio, heredando las tres capas del
// loop detector v3 y el audit JSONL unificado, y devuelve un resultado
// ESTRUCTURADO. Es la pieza de la que dependen:
//   - la orquestación multi-agente (spawn / Task / Team),
//   - la compuerta de auto-verificación (un verificador ES un agent_loop con
//     una caja read-only),
//   - la auto-mejora en paralelo (enjambres que construyen el propio shinobi).
//
// A diferencia del `executeToolLoop` del orchestrator (estático, monolítico,
// acoplado a memoria/persona/compactador/web), este bucle es PURO respecto al
// entorno: recibe su system prompt y su caja, no toca memoria global ni
// personas, y su LLM es inyectable. Eso lo hace testeable de forma
// determinista (sin red) y seguro para correr N en paralelo.
//
// Garantía de seguridad (mínimo privilegio): la caja `tools` es un allowlist.
// El LLM solo ve esas tools; pero si un modelo defectuoso/hostil emite una
// llamada a una tool fuera de la caja, se DENIEGA antes de ejecutar y el
// rechazo se le devuelve para que se adapte. Un subagente NUNCA puede salirse
// de su caja.

import { invokeLLM as routedInvokeLLM } from '../providers/provider_router.js';
import { getTool, toOpenAITools, type Tool } from '../tools/tool_registry.js';
import {
  LoopDetector,
  loopDetectorConfigFromEnv,
  type LoopVerdict,
} from '../coordinator/loop_detector.js';
import { logToolCall, logLoopAbort } from '../audit/audit_log.js';
import { capToolResultJson, TOOL_OUTPUT_MAX_CHARS } from '../context/tool_output_truncator.js';
import type { LLMChatPayload, CloudResponse } from '../cloud/types.js';
import type { ProviderName } from '../providers/types.js';

/** Veredicto final de un agent_loop. */
export type AgentLoopVerdict =
  | 'COMPLETED' // el agente terminó con una respuesta de texto (sin más tools)
  | 'MAX_ITERATIONS' // agotó su presupuesto de iteraciones sin cerrar
  | 'DEPTH_EXCEEDED' // se alcanzó el límite de profundidad de spawn
  | 'ERROR' // el LLM falló de forma no recuperable
  | LoopVerdict; // LOOP_DETECTED | LOOP_NO_PROGRESS | LOOP_SAME_FAILURE

/** Firma del invocador de LLM (inyectable para test). */
export type LLMInvoker = (
  payload: LLMChatPayload,
  opts?: { provider?: ProviderName },
) => Promise<CloudResponse>;

export interface AgentLoopOptions {
  /** Instrucción concreta para este agente (su "user message"). */
  task: string;
  /** System prompt / persona del agente. */
  systemPrompt: string;
  /**
   * Allowlist de nombres de tools (caja cerrada, mínimo privilegio). Nombres
   * que no existan en el registry se ignoran silenciosamente (no se exponen).
   * Una caja vacía ⇒ agente puramente conversacional (sin tools).
   */
  tools: string[];
  /** Contexto extra opcional inyectado tras el system prompt. */
  context?: string;
  /** Tope de iteraciones del bucle (default env SHINOBI_SUBAGENT_MAX_ITERATIONS o 8). */
  maxIterations?: number;
  /** Profundidad de spawn actual (default env SHINOBI_SPAWN_DEPTH o 0). */
  depth?: number;
  /** Profundidad máxima de spawn (default env SHINOBI_MAX_SPAWN_DEPTH o 3). */
  maxDepth?: number;
  /** Etiqueta/id del agente — se usa como sessionId en el audit y en logs. */
  label?: string;
  /** Modelo a usar (passthrough al provider router). */
  model?: string;
  /** Temperatura (default 0.2). */
  temperature?: number;
  /** Invocador de LLM; por defecto el provider router con failover. Inyectable en test. */
  invokeLLM?: LLMInvoker;
  /**
   * Gate de aprobación OPCIONAL. Antes de ejecutar una tool, se llama con
   * (nombre, args); si devuelve false, la tool NO se ejecuta y el rechazo vuelve
   * al LLM para que se adapte. Default: sin gate (subagentes sin cambio). El
   * harness lo usa para medir el gate selectivo completo de shinobi.
   */
  approvalGate?: (toolName: string, args: any) => Promise<boolean>;
}

export interface AgentLoopResult {
  /** true si el agente cerró limpio con respuesta (verdict COMPLETED). */
  ok: boolean;
  verdict: AgentLoopVerdict;
  /** Texto final del agente (su última respuesta sin tool_calls). */
  output: string;
  /** Nº de iteraciones del bucle consumidas. */
  iterations: number;
  /** Secuencia de tools efectivamente ejecutadas (en orden). */
  toolsUsed: string[];
  /** Mensaje de error cuando verdict ∈ {ERROR, *LOOP*, DEPTH_EXCEEDED}. */
  error?: string;
  /** Etiqueta del agente, ecoada para correlación. */
  label?: string;
}

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Resuelve los nombres del allowlist a Tools reales del registry (dedup, sin nulos). */
function resolveBox(toolNames: string[]): Tool[] {
  const seen = new Set<string>();
  const box: Tool[] = [];
  for (const name of toolNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const t = getTool(name);
    if (t) box.push(t);
  }
  return box;
}

/** Parseo defensivo del message del LLM (algunos providers devuelven texto plano). */
function parseAssistantMessage(output: unknown): { content: string; tool_calls?: any[] } {
  if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output);
      if (parsed && typeof parsed === 'object') {
        return {
          content: typeof parsed.content === 'string' ? parsed.content : (parsed.content == null ? '' : String(parsed.content)),
          tool_calls: Array.isArray(parsed.tool_calls) ? parsed.tool_calls : undefined,
        };
      }
    } catch {
      /* texto plano — cae abajo */
    }
    return { content: output };
  }
  return { content: output == null ? '' : String(output) };
}

/**
 * Ejecuta un agente acotado y devuelve un resultado estructurado.
 *
 * NUNCA lanza por errores de LLM/tool: los traduce a un `AgentLoopResult` con
 * el verdict correspondiente. Solo podría lanzar por un bug de programación
 * (p. ej. options inválidas), que es lo que queremos que reviente en test.
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const label = options.label ?? 'subagent';
  const depth = options.depth ?? envInt('SHINOBI_SPAWN_DEPTH', 0);
  const maxDepth = options.maxDepth ?? envInt('SHINOBI_MAX_SPAWN_DEPTH', 3);
  const toolsUsed: string[] = [];

  if (depth >= maxDepth) {
    return {
      ok: false,
      verdict: 'DEPTH_EXCEEDED',
      output: '',
      iterations: 0,
      toolsUsed,
      error: `Profundidad de spawn máxima alcanzada (${depth}/${maxDepth}); no se crea otro subagente.`,
      label,
    };
  }

  const invoke = options.invokeLLM ?? routedInvokeLLM;
  const maxIterations = options.maxIterations ?? envInt('SHINOBI_SUBAGENT_MAX_ITERATIONS', 8);
  const temperature = options.temperature ?? 0.2;
  const box = resolveBox(options.tools ?? []);
  const allowed = new Set(box.map((t) => t.name));
  const openAITools = toOpenAITools(box);

  const systemContent = options.context
    ? `${options.systemPrompt}\n\n${options.context}`
    : options.systemPrompt;

  const messages: any[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: options.task },
  ];

  const loop = new LoopDetector(loopDetectorConfigFromEnv());
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const payload: LLMChatPayload = {
      messages,
      model: options.model,
      tools: openAITools.length > 0 ? openAITools : undefined,
      tool_choice: openAITools.length > 0 ? 'auto' : 'none',
      temperature,
    };

    let res: CloudResponse;
    try {
      res = await invoke(payload);
    } catch (err: any) {
      return {
        ok: false, verdict: 'ERROR', output: '', iterations, toolsUsed,
        error: `LLM lanzó: ${err?.message ?? String(err)}`, label,
      };
    }
    if (!res.success) {
      return {
        ok: false, verdict: 'ERROR', output: '', iterations, toolsUsed,
        error: `LLM falló: ${res.error || 'sin mensaje'}`, label,
      };
    }

    const msg = parseAssistantMessage(res.output);

    // Sin tool_calls ⇒ el agente terminó con su respuesta de texto.
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { ok: true, verdict: 'COMPLETED', output: msg.content, iterations, toolsUsed, label };
    }

    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });

    for (const call of msg.tool_calls) {
      if (!call || call.type !== 'function' || !call.function) continue;
      const name: string = call.function.name;
      let args: any;
      try {
        args = JSON.parse(call.function.arguments ?? '{}');
      } catch {
        args = {};
      }

      // ── Mínimo privilegio: la caja es cerrada. Una llamada fuera de la caja
      // se DENIEGA antes de ejecutar; el rechazo vuelve al LLM para que se
      // adapte (no rompe el bucle). Esta es la garantía de aislamiento.
      if (!allowed.has(name)) {
        const denial = JSON.stringify({
          success: false,
          error:
            `Herramienta "${name}" fuera de la caja de este agente. ` +
            `Permitidas: ${[...allowed].join(', ') || '(ninguna)'}.`,
        });
        messages.push({ role: 'tool', tool_call_id: call.id, name, content: denial });
        continue;
      }

      // Capa 1 del loop detector (args) — antes de ejecutar.
      const attempt = loop.recordCallAttempt(name, args);
      if (attempt.abort) {
        logLoopAbort({ tool: name, verdict: (attempt.verdict as LoopVerdict) ?? 'LOOP_DETECTED', args, sessionId: label });
        return {
          ok: false, verdict: attempt.verdict ?? 'LOOP_DETECTED', output: msg.content || '',
          iterations, toolsUsed, error: `Bucle detectado (capa args) en ${name}.`, label,
        };
      }

      // Gate de aprobación opcional: una acción no aprobada NO se ejecuta; el
      // rechazo vuelve al LLM. Mide el gate selectivo completo de shinobi.
      if (options.approvalGate) {
        let allowedToRun = false;
        try { allowedToRun = await options.approvalGate(name, args); } catch { allowedToRun = false; }
        if (!allowedToRun) {
          const denial = JSON.stringify({ success: false, error: `Acción "${name}" no aprobada (gate). No se ejecutó.` });
          logToolCall({ tool: name, args, success: false, durationMs: 0, error: 'approval_denied', sessionId: label });
          messages.push({ role: 'tool', tool_call_id: call.id, name, content: denial });
          continue;
        }
      }

      const tool = getTool(name);
      let resultStr: string;
      if (!tool) {
        resultStr = JSON.stringify({ success: false, error: `Tool ${name} no encontrada en el registry.` });
        logToolCall({ tool: name, args, success: false, durationMs: 0, error: 'tool_not_found', sessionId: label });
      } else {
        toolsUsed.push(name);
        const t0 = Date.now();
        let result: { success: boolean; output: string; error?: string };
        try {
          result = await tool.execute(args);
        } catch (err: any) {
          result = { success: false, output: '', error: err?.message ?? String(err) };
        }
        const durationMs = Date.now() - t0;
        resultStr = JSON.stringify(result);
        logToolCall({
          tool: name, args, success: !!result.success, durationMs,
          error: result.success ? undefined : (result.error || 'unknown'), sessionId: label,
        });

        // Capa 2 (output) y capa 3 (modo de fallo de entorno).
        const r2 = loop.recordCallResult(name, resultStr);
        if (r2.abort) {
          logLoopAbort({ tool: name, verdict: (r2.verdict as LoopVerdict) ?? 'LOOP_NO_PROGRESS', args, sessionId: label });
          return {
            ok: false, verdict: r2.verdict ?? 'LOOP_NO_PROGRESS', output: msg.content || '',
            iterations, toolsUsed, error: `Bucle detectado (sin progreso) en ${name}.`, label,
          };
        }
        const r3 = loop.recordOutcome(name, !!result.success, result.error);
        if (r3.abort) {
          logLoopAbort({ tool: name, verdict: (r3.verdict as LoopVerdict) ?? 'LOOP_SAME_FAILURE', args, sessionId: label });
          return {
            ok: false, verdict: r3.verdict ?? 'LOOP_SAME_FAILURE', output: msg.content || '',
            iterations, toolsUsed, error: `Bucle detectado (fallo de entorno repetido) en ${name}: ${r3.reason ?? ''}.`, label,
          };
        }
      }

      // Cap de tamaño del tool output antes de devolverlo al contexto.
      const { result: capped } = capToolResultJson(resultStr, TOOL_OUTPUT_MAX_CHARS);
      messages.push({ role: 'tool', tool_call_id: call.id, name, content: capped });
    }
  }

  return {
    ok: false, verdict: 'MAX_ITERATIONS', output: '', iterations, toolsUsed,
    error: `Agente "${label}" agotó ${maxIterations} iteraciones sin cerrar.`, label,
  };
}
