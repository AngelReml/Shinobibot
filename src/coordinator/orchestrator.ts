import OpenAI from 'openai';
import { invokeLLM as routedInvokeLLM, currentProvider } from '../providers/provider_router.js';
import { route } from './model_router.js';
import { getAllTools, getTool, toOpenAITools } from '../tools/index.js';
import { sharedMemory } from '../db/memory.js';
import { ContextBuilder } from '../db/context_builder.js';
import { MemoryStore, sharedMemoryStore } from '../memory/memory_store.js';
import { skillManager } from '../skills/skill_manager.js';
import { compactMessages, type CompactionResult } from '../context/compactor.js';
import { shouldUseLLM, compactWithLLM } from '../context/llm_compactor.js';
import { tokenBudget } from '../context/token_budget.js';
import { LoopDetector, loopDetectorConfigFromEnv, failureModeAdvice } from './loop_detector.js';
import { toolEvents } from './tool_events.js';
import { logToolCall, logLoopAbort } from '../audit/audit_log.js';
import { isDestructive, requestApproval, registerApprovedPath } from '../security/approval.js';
import { shadowDispatchEnabled, shadowClassifyAndRecord } from '../dispatch/shadow_recorder.js';
import { refinerShadowEnabled, refineShadowForTask } from '../refiner/refiner_shadow.js';
import { diagnoseError } from '../selfdebug/self_debug.js';
import { recordToolPattern } from '../skills/pattern_wiring.js';
import { IterationBudget } from './iteration_budget.js';
import { ProgressTracker, progressDetectionEnabled } from './progress_judge.js';
import { MemoryReflector, reflectionEnabled } from '../context/memory_reflector.js';
import { runBackgroundReview, backgroundReviewEnabled, reviewInProgress } from '../learning/background_review.js';
import { loadSoul, personaSystemMessage, builtinSoul } from '../soul/soul.js';
import { sanitizeToolCallArguments, repairMessageSequence } from '../runtime/trajectory_helpers.js';
import { capToolResultJson, TOOL_OUTPUT_MAX_CHARS } from '../context/tool_output_truncator.js';
import { metrics } from '../observability/metrics.js';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env'), override: true });

export type ExecutionMode = 'local' | 'kernel' | 'auto';

export class ShinobiOrchestrator {
  private static mode: ExecutionMode = 'kernel';
  private static memory = sharedMemory();
  private static contextBuilder = new ContextBuilder();
  private static _openai: OpenAI | null = null;
  // Lazy: the OpenAI SDK throws in its constructor when no key is present, so
  // building the client eagerly made the whole module un-importable (and the
  // safety/swarm test suites un-loadable) in any environment without a key.
  // The key is only needed at call time, so defer construction until first use.
  private static get openai(): OpenAI {
    if (!this._openai) {
      this._openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return this._openai;
  }
  private static activeModel: string | undefined = undefined;

  /**
   * Índice de recall semántico (SQLite). Es un derivado de memory/MEMORY.md
   * — semantic_index.ts lo reconstruye en boot. Se usa el singleton
   * compartido para no abrir dos conexiones sobre el mismo memory.db.
   */
  static getMemory(): MemoryStore { return sharedMemoryStore(); }

  static setModel(model: string | undefined) { this.activeModel = model; }
  static getModel(): string { return this.activeModel || 'default'; }

  static setMode(mode: ExecutionMode) {
    this.mode = mode;
    console.log(`[Shinobi] Mode set to: ${mode}`);
  }

  private static buildModeHint(): string | null {
    if (this.mode === 'local') {
      return 'You are operating in LOCAL mode. The OpenGravity Kernel is unavailable. Use only local tools to accomplish the task.';
    }
    if (this.mode === 'kernel') {
      return 'You are operating in KERNEL mode. When a task is complex, research-heavy, or requires isolated execution, prefer delegating to the OpenGravity Kernel using start_kernel_mission. For simple file reads or listings, local tools are still fine.';
    }
    return null;
  }

  /**
   * FASE 2 cabo C / FASE 1 cierre — directiva de delegación a SpecialistAgents.
   *
   * Devuelve la regla general de delegación y, cuando heurísticas de keywords
   * baratas detectan que la petición es claramente de investigación /
   * documento / datos, AÑADE una directiva DIRIGIDA y enfática que nombra la
   * tool exacta. NO es un router rígido: el LLM sigue eligiendo y ejecutando
   * la tool libremente (puede ignorar la directiva); las keywords solo hacen
   * el system message más certero. No usa el clasificador del Bloque 3
   * (parada (a) — congelado en shadow).
   */
  private static buildDelegationHint(input: string): string {
    const base =
      'DELEGACIÓN A AGENTES ESPECIALISTAS — regla de despacho:\n' +
      '- Si el usuario pide INVESTIGAR o BUSCAR información en la web, llama a la tool `research_agent_run`.\n' +
      '- Si pide generar un DOCUMENTO o INFORME (PDF, Markdown, Word), llama a `docs_agent_run`.\n' +
      '- Si pide un GRÁFICO o VISUALIZACIÓN de datos, llama a `data_agent_run`.\n' +
      'Estos agentes especialistas son la vía dedicada y obligatoria: úsalos en vez de resolver esas ' +
      'tareas con tools sueltas (web_search, generate_document, generate_chart) directamente.';
    const t = (input || '').toLowerCase();
    const target = (tool: string, kind: string, forbidden: string) =>
      base + `\n\n⚠️ ESTA PETICIÓN es una tarea de ${kind}. Es OBLIGATORIO que tu PRIMERA acción ` +
      `(y única vía para esta tarea) sea llamar a la tool \`${tool}\`. Tienes ESTRICTAMENTE PROHIBIDO ` +
      `llamar a \`${forbidden}\` para esta petición — esa tool es interna y NO debe usarse aquí. ` +
      `Delega en \`${tool}\`.`;
    if (/\b(investiga|investigar|investígame|busca informaci|búscame informaci|averigua|averíguame|qué es el |que es el |qué es la |que es la )\b/.test(t)) {
      return target('research_agent_run', 'INVESTIGACIÓN', 'web_search');
    }
    if (/\b(informe|documento|redacta|redáctame|gen[eé]rame un informe|gen[eé]rame un documento|en pdf|en markdown|en word|\.pdf|\.docx|\.md)\b/.test(t)) {
      return target('docs_agent_run', 'DOCUMENTO', 'generate_document');
    }
    if (/\b(gr[aá]fico|chart|graf[ií]came|grafica|graficar|graf[ií]ca|diagrama|visualiza|visualízame|analiza estas cifras|analiza estos datos|analiza estas ventas)\b/.test(t)) {
      return target('data_agent_run', 'DATOS / GRÁFICO', 'generate_chart');
    }
    return base;
  }

  // Fase 1 del bucle de aprendizaje — contadores de nudge. Estáticos: el
  // proceso es de larga vida (REPL/web/gateway), así que persisten entre
  // misiones sin rehidratación. _turnsSinceMemory ++ por misión de usuario;
  // _itersSinceSkill ++ por iteración del tool-loop.
  private static _turnsSinceMemory = 0;
  private static _itersSinceSkill = 0;

  static async process(input: string): Promise<any> {
    const currentDepth = Number(process.env.SHINOBI_SPAWN_DEPTH || '0');
    const maxDepth = Number(process.env.SHINOBI_MAX_SPAWN_DEPTH || '3');
    if (currentDepth >= maxDepth) {
      console.warn(`[Shinobi] Max spawn depth reached (${currentDepth}/${maxDepth}). Aborting recursive execution.`);
      return {
        verdict: 'ERROR',
        error: `Max spawn depth reached (${currentDepth}/${maxDepth}). Aborting recursive execution.`
      };
    }

    console.log(`[Shinobi] Processing: ${input.slice(0, 50)}...`);
    this._turnsSinceMemory++;

    // Add user input to memory
    await this.memory.addMessage({ role: 'user', content: input });

    // Bloque 3: track tool sequence for SkillManager.observeRun
    const toolSequence: string[] = [];
    let success = false;
    let error: string | undefined;

    try {
      const result = await this.executeToolLoop(input, toolSequence);
      success = result?.verdict === 'VALID_AGENT';
      if (result?.verdict === 'ERROR' && result?.error) error = String(result.error);

      // Bloque 5.3 — el hook de auto-offer se MOVIÓ a server.ts (punto único
      // de convergencia tras `ws.send(final)`). Aquí solo retornamos el
      // resultado para que server.ts lo procese.
      return result;
    } finally {
      // Fire-and-forget post-task observation. SkillManager may schedule a
      // proposal asynchronously without blocking the user's response.
      try {
        skillManager().observeRun({ input, toolSequence, success, error });
      } catch (e: any) {
        console.log(`[Shinobi] observeRun failed: ${e?.message ?? e}`);
      }
      // P2 — memory_reflector: cada N misiones (opt-in con
      // SHINOBI_REFLECTION_ENABLED=1) analiza la historia y emite un reporte
      // markdown auditable con contradicciones / preferencias del usuario.
      try {
        if (reflectionEnabled()) {
          const reflector = ShinobiOrchestrator.memoryReflector();
          reflector.noteMessage();
          if (reflector.shouldReflect()) {
            const history = await this.memory.getMessages();
            const report = reflector.analyze(history as any);
            console.log(`[Shinobi] memory_reflector: ${report.contradictions.length} contradicciones, ` +
              `${report.preferences.length} preferencias${report.filePath ? ` → ${report.filePath}` : ''}`);
          }
        }
      } catch (e: any) {
        console.log(`[Shinobi] memory_reflector failed: ${e?.message ?? e}`);
      }

      // Fase 1 del bucle de aprendizaje — Background Review (Motor 1).
      // Tras entregar la respuesta, si saltó un nudge, una revisión LLM
      // decide qué guardar en memoria / capturar como skill. Opt-in con
      // SHINOBI_REVIEW_ENABLED=1. Fire-and-forget: no bloquea la respuesta.
      try {
        if (backgroundReviewEnabled() && !reviewInProgress()) {
          const memNudge = Number(process.env.SHINOBI_MEMORY_NUDGE_INTERVAL) || 5;
          const skillNudge = Number(process.env.SHINOBI_SKILL_NUDGE_INTERVAL) || 5;
          // Si el agente ya tocó skills en vivo, no se vuelve a nudgear.
          if (toolSequence.includes('request_new_skill')) this._itersSinceSkill = 0;
          const reviewMemory = this._turnsSinceMemory >= memNudge;
          const reviewSkills = this._itersSinceSkill >= skillNudge;
          if (reviewMemory || reviewSkills) {
            const history = await this.memory.getMessages();
            // El reset va ADYACENTE al dispatch (sin await entre medias) —
            // así no hay ventana en la que otra misión vea el contador ya a
            // cero pero el review aún sin lanzar (perdería el nudge).
            if (reviewMemory) this._turnsSinceMemory = 0;
            if (reviewSkills) this._itersSinceSkill = 0;
            void runBackgroundReview({
              history: history as any,
              reviewMemory,
              reviewSkills,
            }).catch((e) => console.log(`[Shinobi] background_review failed: ${e?.message ?? e}`));
          }
        }
      } catch (e: any) {
        console.log(`[Shinobi] background_review wiring failed: ${e?.message ?? e}`);
      }

      // Bloque 3 — clasificador de despacho por afinidad en SHADOW MODE.
      // Registra a qué especialista HABRÍA enrutado esta orden, SIN tocar el
      // despacho real (que la maneja el orchestrator general). Opt-in con
      // SHINOBI_SHADOW_DISPATCH=1; fire-and-forget: jamás afecta la respuesta.
      try {
        if (shadowDispatchEnabled()) {
          void shadowClassifyAndRecord(input).catch((e) =>
            console.log(`[Shinobi] shadow_dispatch failed: ${e?.message ?? e}`));
        }
      } catch (e: any) {
        console.log(`[Shinobi] shadow_dispatch wiring failed: ${e?.message ?? e}`);
      }

      // FASE 1 — refinador de prompts en camino caliente en SHADOW MODE.
      // Para una tarea que iría a un SpecialistAgent, registra qué nivel le
      // pondría y si la reescribiría, SIN controlar lo que recibe el
      // subordinado. Opt-in con SHINOBI_REFINER_SHADOW=1; fire-and-forget.
      // La promoción de shadow a camino real es la parada R — no se cruza.
      try {
        if (refinerShadowEnabled()) {
          void refineShadowForTask(input).catch((e) =>
            console.log(`[Shinobi] refiner_shadow failed: ${e?.message ?? e}`));
        }
      } catch (e: any) {
        console.log(`[Shinobi] refiner_shadow wiring failed: ${e?.message ?? e}`);
      }
    }
  }

  private static _memoryReflector: MemoryReflector | null = null;
  /** Singleton del reflector de memoria (persiste el contador entre misiones). */
  static memoryReflector(): MemoryReflector {
    if (!this._memoryReflector) {
      this._memoryReflector = new MemoryReflector({
        intervalMessages: Number(process.env.SHINOBI_REFLECTION_INTERVAL) || 10,
      });
    }
    return this._memoryReflector;
  }

  private static async executeToolLoop(input: string, toolSequence: string[] = []): Promise<any> {
    let currentMessages = await this.contextBuilder.buildMessages(input);

    const userQuery = currentMessages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
    if (userQuery && typeof userQuery === 'string') {
      try {
        const memSection = await ShinobiOrchestrator.getMemory().buildContextSection(userQuery, 1500);
        if (memSection) {
          currentMessages = [{ role: 'system', content: memSection } as any, ...currentMessages];
        }
      } catch (e) { console.error('[memory] context build failed:', (e as Error).message); }
    }

    // Bloque 3: inject matching skill instructions when any approved skill's
    // trigger_keywords match the input.
    try {
      const skillSection = skillManager().getContextSection(input);
      if (skillSection) {
        currentMessages = [{ role: 'system', content: skillSection } as any, ...currentMessages];
      }
    } catch (e) { console.error('[skill-manager] context build failed:', (e as Error).message); }

    const modeHint = this.buildModeHint();
    if (modeHint) {
      currentMessages = [{ role: 'system', content: modeHint }, ...currentMessages];
    }

    // FASE 2 cabo C / FASE 1 — directiva de delegación a SpecialistAgents,
    // dirigida por keywords. Sin esto el orchestrator resolvía investigación /
    // documentos / gráficos con tools sueltas en vez de delegar al especialista.
    currentMessages = [{ role: 'system', content: this.buildDelegationHint(input) }, ...currentMessages];

    // Ghost feature cableada (soul/persona): si SHINOBI_PERSONA está definida,
    // se inyecta el system message de esa persona. soul.ts existía con 10
    // personas built-in pero ningún path lo invocaba. Opt-in: sin la env no
    // hay inyección y el comportamiento no cambia.
    try {
      const personaName = process.env.SHINOBI_PERSONA;
      if (personaName) {
        const soul = builtinSoul(personaName) ?? loadSoul();
        const personaMsg = personaSystemMessage(soul);
        if (personaMsg) {
          currentMessages = [{ role: 'system', content: personaMsg } as any, ...currentMessages];
        }
      }
    } catch (e) { console.error('[soul] persona inject failed:', (e as Error).message); }
    const allTools = getAllTools();
    const availableTools = this.mode === 'local'
      ? allTools.filter(t => t.name !== 'start_kernel_mission')
      : allTools;
    const openAITools = toOpenAITools(availableTools);

    // P2 — iteration_budget: el cap de turnos del loop ahora es un
    // IterationBudget (consumible, con snapshot), configurable por env, en
    // vez de un `maxIterations = 10` hardcodeado.
    const budget = new IterationBudget(Number(process.env.SHINOBI_MAX_ITERATIONS) || 10);
    let iteration = 0;

    // P2 — progress_judge: capa 3 semántica del loop detector (opt-in con
    // SHINOBI_PROGRESS_DETECTION=1). Default OFF = sin coste de tokens.
    const progressTracker = progressDetectionEnabled() ? new ProgressTracker() : null;

    // P2 — model_router: clasifica la complejidad del input y, si está
    // activado (SHINOBI_MODEL_ROUTER=1), enruta a un modelo/provider acorde.
    // Default OFF = passthrough. Se decide una vez por misión.
    const routeDecision = route({
      input,
      currentModel: { provider: currentProvider(), model: this.activeModel ?? '' },
    });
    if (routeDecision.enabled) {
      console.log(
        `[Shinobi] model_router: tier=${routeDecision.tier} → ` +
        `${routeDecision.choice.provider}/${routeDecision.choice.model} ` +
        `(~$${routeDecision.estimatedCostUsd.toFixed(5)})`,
      );
    }

    // Loop detector v3: tres capas.
    //   - Capa de args (v1): SHA256(toolName+args). Aborta con LOOP_DETECTED
    //     en el 2º intento idéntico (default).
    //   - Capa semántica (v2): fingerprint reducido del output. Aborta con
    //     LOOP_NO_PROGRESS si la misma tool produce 3 outputs indistinguibles
    //     (default) aunque los args sean distintos.
    //   - Capa de modo de fallo (v3): clasifica cada fallo en un modo de
    //     entorno (browser caído, API key inválida, fichero inexistente, red)
    //     y aborta con LOOP_SAME_FAILURE tras 3 fallos consecutivos del mismo
    //     modo — aunque sean tools distintas. Cubre el incidente 2026-05-16.
    // Esto cubre el caso en que el LLM rota un parámetro irrelevante en cada
    // intento pero el resultado observable no cambia.
    const loopDetector = new LoopDetector(loopDetectorConfigFromEnv());

    while (budget.consume()) {
      iteration++;
      this._itersSinceSkill++; // Fase 1 — nudge de skills por iteración.
      console.log(`[Shinobi] Let the LLM decide (Iter ${iteration}/${budget.snapshot().total})...`);

      try {
        // [B2-DEPRECATED]
        /*
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o',
          messages: currentMessages,
          tools: openAITools.length > 0 ? openAITools : undefined,
          tool_choice: 'auto',
          temperature: 0.2,
        });
        const responseMessage = response.choices[0].message;
        */

        // Context compactor: si el budget del proveedor se acerca, truncamos
        // tool outputs antiguos y/o colapsamos turnos viejos para que el
        // último user input y los últimos turnos sigan intactos. Sin esto,
        // las sesiones >20 turnos rebotan por overflow en Anthropic/OpenAI.
        const budgetTokens = Number(process.env.SHINOBI_CONTEXT_BUDGET) || 32_000;
        // P2 — llm_compactor: si SHINOBI_COMPACTOR_MODE=llm|auto y procede,
        // se usa compactación semántica vía LLM; si no (o si falla), se cae
        // al compactor heurístico de siempre. Default heuristic = sin cambio.
        let compaction: CompactionResult = { messages: currentMessages, compacted: false, beforeTokens: 0, afterTokens: 0, truncatedCount: 0, droppedCount: 0 };
        const llmDecision = shouldUseLLM(currentMessages, { budgetTokens });
        if (llmDecision.useLLM) {
          const llmResult = await compactWithLLM(currentMessages, {
            budgetTokens,
            llmFn: async (prompt: string) => {
              const r = await routedInvokeLLM({ messages: [{ role: 'user', content: prompt }], temperature: 0 } as any);
              if (!r.success) throw new Error(r.error || 'llm compaction call failed');
              try { return String(JSON.parse(r.output)?.content ?? r.output); } catch { return String(r.output ?? ''); }
            },
          });
          if (llmResult.compacted) {
            compaction = llmResult;
            console.log(`[Shinobi] Context compacted (LLM, mode=${llmDecision.mode}): ${llmResult.droppedCount} mensajes resumidos`);
          } else {
            // LLM no comprimió (skip / error) → fallback al heurístico.
            compaction = compactMessages(currentMessages, { budgetTokens });
          }
        } else {
          compaction = compactMessages(currentMessages, { budgetTokens });
        }
        if (compaction.compacted) {
          console.log(
            `[Shinobi] Context compacted: ${compaction.beforeTokens} → ` +
            `${compaction.afterTokens} tokens (truncated=${compaction.truncatedCount}, ` +
            `dropped=${compaction.droppedCount})`
          );
          currentMessages = compaction.messages;
        }

        // Token budget snapshot: actualizamos la sesión 'default' con el
        // tamaño final del payload que enviamos. El WebChat / TUI lo
        // consumen para mostrar "X.Xk / Yk tokens" en cabecera.
        try {
          const snap = tokenBudget().recordTurn('default', currentMessages);
          if (snap.ratio >= 0.85) {
            console.log(`[Shinobi] Token budget ${Math.round(snap.ratio * 100)}% (${snap.usedTokens}/${snap.budgetTokens})`);
          }
        } catch (e: any) {
          console.warn(`[Shinobi] token budget tracker error (ignorado): ${e?.message ?? e}`);
        }

        const llmPayload = {
          messages: repairMessageSequence(currentMessages),
          model: this.activeModel,
          tools: openAITools.length > 0 ? openAITools : undefined,
          tool_choice: openAITools.length > 0 ? 'auto' : 'none',
          temperature: 0.2,
        };
        // Bloque 7 — provider_router decide qué client llama según
        // SHINOBI_PROVIDER. Si el model_router está activo, fija el modelo y
        // el provider de esta llamada según el tier de complejidad.
        if (routeDecision.enabled) {
          llmPayload.model = routeDecision.choice.model;
        }
        const t0 = Date.now();
        console.log(`[DEBUG-ORCHESTRATOR] [${new Date().toISOString()}] BEFORE LLM CALL. Model: ${llmPayload.model}, Provider: ${routeDecision.enabled ? routeDecision.choice.provider : 'default'}`);
        const result = await routedInvokeLLM(
          llmPayload,
          routeDecision.enabled ? { provider: routeDecision.choice.provider as any } : undefined,
        );
        const durationMs = Date.now() - t0;
        console.log(`[DEBUG-ORCHESTRATOR] [${new Date().toISOString()}] AFTER LLM CALL. Success: ${result.success}, output length: ${result.output?.length ?? 0}, error: ${result.error || 'none'}`);
        if (!result.success) {
          throw new Error(`LLM Error: ${result.error}`);
        }

        // --- Record Metrics ---
        const resolvedProvider = result.resolvedProvider || 'default';
        const resolvedModel = llmPayload.model || 'default';
        const callDurationSec = durationMs / 1000;

        const registry = metrics();
        registry.counterInc('shinobi_llm_calls_total', 1, { provider: resolvedProvider, model: resolvedModel });

        try {
          registry.histogramObserve('shinobi_llm_duration_seconds', callDurationSec, { provider: resolvedProvider, model: resolvedModel });
        } catch {
          registry.describeHistogram('shinobi_llm_duration_seconds', { buckets: [0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0] }, 'LLM call duration in seconds');
          registry.histogramObserve('shinobi_llm_duration_seconds', callDurationSec, { provider: resolvedProvider, model: resolvedModel });
        }

        if (result.usage) {
          registry.counterInc('shinobi_llm_tokens_total', result.usage.prompt_tokens, { provider: resolvedProvider, model: resolvedModel, type: 'prompt' });
          registry.counterInc('shinobi_llm_tokens_total', result.usage.completion_tokens, { provider: resolvedProvider, model: resolvedModel, type: 'completion' });

          const cost = calculateCost(resolvedProvider, resolvedModel, result.usage);
          registry.counterInc('shinobi_llm_cost_usd_total', cost, { provider: resolvedProvider, model: resolvedModel });
        }

        // Apply helper from Hermes (sanitization)
        result.output = sanitizeToolCallArguments(result.output);

        // C1 — parseo defensivo. Si un provider devuelve texto plano en vez
        // del JSON del message, NO se aborta la misión: se trata como una
        // respuesta de texto normal del asistente.
        let responseMessage: any;
        try {
          responseMessage = JSON.parse(result.output);
        } catch {
          responseMessage = {
            content: typeof result.output === 'string' ? result.output : String(result.output ?? ''),
          };
        }

        // If the LLM just responds with text, we are done
        if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
          await this.memory.addMessage({ role: 'assistant', content: responseMessage.content || '' });
          // P2 — usage_pattern_detector: registra la secuencia de tools de
          // esta misión exitosa; si un patrón se repite 3×, propone una skill.
          try { recordToolPattern(toolSequence); } catch { /* best-effort */ }
          return {
            verdict: 'VALID_AGENT',
            mode: this.mode,
            response: responseMessage.content,
          };
        }

        // Add the LLM's message indicating tool calls to history
        currentMessages.push(responseMessage);
        await this.memory.addMessage({
          role: 'assistant',
          content: responseMessage.content || '',
          tool_calls: responseMessage.tool_calls as any,
        });

        // P2 — progress_judge: acumula el output de esta iteración para que
        // el juez de progreso semántico (capa 3, opt-in) lo evalúe.
        let iterationOutput = String(responseMessage.content || '');

        // Execute all requested tool calls
        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.type !== 'function') continue;
          const functionName = toolCall.function.name;
          // Parseo defensivo: si el LLM emite argumentos JSON malformados,
          // se ejecuta la tool con {} (la propia tool devolverá su error de
          // validación) en vez de abortar todo el turno.
          let functionArgs: any;
          try {
            functionArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            functionArgs = {};
            console.log(`  [⚠] Argumentos JSON inválidos para ${functionName}; se ejecuta con {}.`);
          }
          toolSequence.push(functionName);  // Bloque 3 — observed by SkillManager
          console.log(`  [🔨] Tool called: ${functionName}`);

          // Capa 1 (args) — antes de ejecutar la tool.
          const attemptCheck = loopDetector.recordCallAttempt(functionName, functionArgs);
          if (attemptCheck.abort) {
            const argsSummary = JSON.stringify(functionArgs).substring(0, 120);
            const message =
              `He detectado que estoy repitiendo la misma acción sin progreso. ` +
              `Necesito tu ayuda: la tool "${functionName}" ya falló o no avanzó ` +
              `con estos mismos argumentos. Acción que estaba intentando: ` +
              `${functionName} con ${argsSummary}.`;
            console.log(`  [⛔] ${attemptCheck.verdict} on ${functionName} (hash=${(attemptCheck.hash ?? '').slice(0, 12)})`);
            await this.memory.addMessage({ role: 'assistant', content: message });
            logLoopAbort({
              tool: functionName,
              verdict: (attemptCheck.verdict as 'LOOP_DETECTED' | 'LOOP_NO_PROGRESS') ?? 'LOOP_DETECTED',
              args: functionArgs,
            });
            return {
              verdict: attemptCheck.verdict ?? 'LOOP_DETECTED',
              mode: this.mode,
              response: message,
              tool: functionName,
              args: functionArgs,
            };
          }

          const tool = getTool(functionName);
          let toolResultStr = '';

          if (!tool) {
            toolResultStr = JSON.stringify({ error: `Tool ${functionName} not found` });
            logToolCall({
              tool: functionName,
              args: functionArgs,
              success: false,
              durationMs: 0,
              error: 'tool_not_found',
            });
          } else {
            console.log(`       Args: ${JSON.stringify(functionArgs).substring(0, 100)}...`);

            // D-017 — gate de aprobación. Consulta el modo (off/smart/on) antes
            // de ejecutar. 'smart' (default) solo frena operaciones destructivas;
            // 'on' toda escritura/exec; 'off' nada. Si se deniega, el rechazo se
            // devuelve como resultado de la tool para que el LLM lo vea y se
            // adapte — el loop NO se rompe.
            const approvalVerdict = isDestructive(functionName, functionArgs);
            const approvalTimeoutMs = Number(process.env.SHINOBI_APPROVAL_TIMEOUT_MS) || 120_000;
            let approved = false;
            let isTimeout = false;
            let timer: NodeJS.Timeout | undefined;

            const timeoutPromise = new Promise<boolean>((resolve) => {
              timer = setTimeout(() => {
                isTimeout = true;
                resolve(true); // implicit approval on timeout
              }, approvalTimeoutMs);
            });

            try {
              approved = await Promise.race([
                requestApproval({
                  toolName: functionName,
                  args: functionArgs,
                  destructive: approvalVerdict.destructive,
                  reason: approvalVerdict.reason,
                }),
                timeoutPromise
              ]);
            } catch (err: any) {
              // Si fue por otro error, approved queda false y se maneja
            } finally {
              if (timer) clearTimeout(timer);
            }

            if (!approved && !isTimeout) {
              const denyReason = approvalVerdict.reason || 'requiere confirmación del usuario';
              toolResultStr = JSON.stringify({
                success: false,
                error: `Acción no aprobada: "${functionName}" (${denyReason}). No se ejecutó. ` +
                  `El usuario puede ajustar el modo con /approval [on|smart|off].`,
              });
              console.log(`  [⛔] Aprobación denegada: ${functionName}`);
              logToolCall({ tool: functionName, args: functionArgs, success: false, durationMs: 0, error: 'approval_denied' });
            } else {
              if (isTimeout) {
                console.log(`  [✓] Aprobación por timeout (${approvalTimeoutMs / 1000}s): tool ejecutada`);
              }
            // Aprobación concedida. Si era una escritura/edición fuera del
            // workspace, registramos ese path para que validatePath lo
            // desbloquee en esta operación concreta (permisos absolutos bajo
            // aprobación manual explícita en el chat).
            registerApprovedPath(functionName, functionArgs);
            const t0 = Date.now();
            toolEvents().emitToolStarted({ tool: functionName, args: functionArgs });
            const result = await tool.execute(functionArgs);
            const durationMs = Date.now() - t0;
            toolResultStr = JSON.stringify(result);
            if (result.success) {
              console.log(`       ✅ Success`);
            } else {
              console.log(`       ❌ Failed: ${result.error}`);
              // P2 — self_debug: cada fallo de tool se autodiagnostica. El
              // diagnóstico (hipótesis de causa raíz + fix sugerido) se
              // adjunta al resultado para que el LLM lo vea y se adapte.
              try {
                const report = diagnoseError({
                  tool: functionName,
                  args: functionArgs,
                  error: String(result.error ?? 'unknown'),
                });
                const top = report.rootCauseHypotheses[0];
                const fix = report.fixSuggestions[0];
                toolResultStr = JSON.stringify({
                  ...result,
                  self_debug: {
                    hypothesis: top ? `(${Math.round(top.confidence * 100)}%) ${top.cause}` : undefined,
                    suggested_fix: fix ? `${fix.action} — ${fix.detail}` : undefined,
                  },
                });
                console.log(`       🩺 self-debug: ${top?.cause ?? '(sin hipótesis)'}`);
              } catch { /* self_debug es best-effort, nunca rompe el loop */ }
            }
            toolEvents().emitToolCompleted({
              tool: functionName,
              success: !!result.success,
              durationMs,
              error: result.success ? undefined : (result.error || 'unknown'),
            });
            logToolCall({
              tool: functionName,
              args: functionArgs,
              success: !!result.success,
              durationMs,
              error: result.success ? undefined : (result.error || 'unknown'),
            });

            // Capa 2 (output) — tras ejecutar. Detecta no-progress aunque los
            // args sean distintos en cada intento.
            const resultCheck = loopDetector.recordCallResult(functionName, toolResultStr);
            if (resultCheck.abort) {
              const message =
                `He detectado que estoy repitiendo acciones sin que el resultado ` +
                `cambie. La tool "${functionName}" sigue devolviendo el mismo ` +
                `output observable tras varios intentos. Necesito tu ayuda para ` +
                `cambiar de enfoque.`;
              console.log(`  [⛔] ${resultCheck.verdict} on ${functionName}`);
              await this.memory.addMessage({ role: 'assistant', content: message });
              logLoopAbort({
                tool: functionName,
                verdict: (resultCheck.verdict as 'LOOP_DETECTED' | 'LOOP_NO_PROGRESS') ?? 'LOOP_NO_PROGRESS',
                args: functionArgs,
              });
              return {
                verdict: resultCheck.verdict ?? 'LOOP_NO_PROGRESS',
                mode: this.mode,
                response: message,
                tool: functionName,
                args: functionArgs,
              };
            }

            // Capa 3 (modo de fallo) — tras ejecutar. Detecta fallos
            // repetidos que comparten el mismo modo de fallo de ENTORNO
            // (browser caído, API key inválida, fichero inexistente, red),
            // aunque NO sean consecutivos: cuenta acumulativo + ventana
            // deslizante, ignorando éxitos y otras tools intercaladas.
            // Cuando el bloqueo es del entorno, cambiar de táctica no progresa
            // (incidente 2026-05-16: el agente probó 12 keywords y luego
            // intentó cerrar ventanas con Alt+F4). Hay que parar y pedir
            // intervención humana — Shinobi NO intenta arreglar el entorno.
            const failCheck = loopDetector.recordOutcome(functionName, !!result.success, result.error);
            if (failCheck.abort) {
              const mode = (failCheck.reason ?? '').replace(/^env_failure:/, '');
              const message =
                `He detectado que varias herramientas fallan repetidamente por ` +
                `el mismo motivo de entorno y cambiar de táctica no avanza. ` +
                `Paro aquí en lugar de seguir intentándolo o de tocar el ` +
                `entorno por mi cuenta. Necesito que ${failureModeAdvice(mode)}`;
              console.log(`  [⛔] ${failCheck.verdict} on ${functionName} (mode=${mode}, trigger=${failCheck.hash ?? '?'})`);
              await this.memory.addMessage({ role: 'assistant', content: message });
              logLoopAbort({
                tool: functionName,
                verdict: (failCheck.verdict as 'LOOP_DETECTED' | 'LOOP_NO_PROGRESS' | 'LOOP_SAME_FAILURE') ?? 'LOOP_SAME_FAILURE',
                args: functionArgs,
              });
              return {
                verdict: failCheck.verdict ?? 'LOOP_SAME_FAILURE',
                mode: this.mode,
                response: message,
                tool: functionName,
                args: functionArgs,
              };
            }
            } // fin del bloque `if (approved)`
          }

          // Cap: limita el tamaño del tool output ANTES de añadirlo al historial.
          // El compactor reduce el historial acumulado en iteraciones siguientes,
          // pero no puede acotar lo que entra en la iteración actual. Sin este
          // cap, un read_file de archivo extenso puede inyectar decenas de miles
          // de tokens en un solo turno y reventar el límite del proveedor.
          const { result: cappedResult, truncated: wasTruncated } =
            capToolResultJson(toolResultStr, TOOL_OUTPUT_MAX_CHARS);
          if (wasTruncated) {
            console.log(
              `  [✂] Tool output truncated: ${functionName} ` +
              `(${toolResultStr.length} → ${cappedResult.length} chars, ` +
              `cap=${TOOL_OUTPUT_MAX_CHARS})`,
            );
            toolResultStr = cappedResult;
          }

          // Append tool response to messages
          const toolMessage = {
            role: 'tool' as const,
            tool_call_id: toolCall.id,
            name: functionName,
            content: toolResultStr,
          };
          currentMessages.push(toolMessage);

          await this.memory.addMessage({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: functionName,
            content: toolResultStr
          });
          iterationOutput += '\n' + toolResultStr;
        }

        // P2 — progress_judge (capa 3 semántica del loop detector, opt-in
        // con SHINOBI_PROGRESS_DETECTION=1). Un juez LLM independiente puntúa
        // el avance hacia el objetivo; si la ventana no progresa, aborta.
        if (progressTracker) {
          const pr = await progressTracker.recordIteration(input, iterationOutput);
          if (pr.abort) {
            const message =
              `He detectado que no estoy avanzando hacia el objetivo (juez de ` +
              `progreso: ${pr.reason}). Paro y pido tu ayuda para cambiar de enfoque.`;
            console.log(`  [⛔] ${pr.verdict} (judge=${progressTracker.judgeId()}, score=${pr.latestScore.toFixed(2)})`);
            await this.memory.addMessage({ role: 'assistant', content: message });
            return { verdict: pr.verdict ?? 'NO_SEMANTIC_PROGRESS', mode: this.mode, response: message };
          }
        }

        // Loop continues, feeding tool results back to LLM...

      } catch (error: any) {
        console.error(`[Shinobi] LLM or Tool Error: ${error.message}`);
        return {
          verdict: 'ERROR',
          error: error.message
        }
      }
    }

    return {
      verdict: 'MAX_ITERATIONS',
      error: 'Tool loop hit max iterations without generating a final response.'
    };
  }
}

export function calculateCost(provider: string, model: string, usage: { prompt_tokens: number; completion_tokens: number }): number {
  const p = provider.toLowerCase();
  const m = model.toLowerCase();
  let inputRate = 0; // per 1M tokens
  let outputRate = 0; // per 1M tokens

  if (p === 'openai') {
    if (m.includes('mini')) {
      inputRate = 0.15;
      outputRate = 0.60;
    } else {
      inputRate = 2.50;
      outputRate = 10.00;
    }
  } else if (p === 'anthropic') {
    if (m.includes('haiku')) {
      inputRate = 0.80;
      outputRate = 4.00;
    } else if (m.includes('opus')) {
      inputRate = 15.00;
      outputRate = 75.00;
    } else {
      inputRate = 3.00;
      outputRate = 15.00; // sonnet default
    }
  } else if (p === 'groq') {
    inputRate = 0.59;
    outputRate = 0.79;
  } else if (p === 'openrouter') {
    // Blended rate
    inputRate = 2.00;
    outputRate = 8.00;
  } else {
    // default/opengravity
    inputRate = 1.00;
    outputRate = 4.00;
  }

  const inputCost = (usage.prompt_tokens * inputRate) / 1_000_000;
  const outputCost = (usage.completion_tokens * outputRate) / 1_000_000;
  return inputCost + outputCost;
}
