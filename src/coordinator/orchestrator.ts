import OpenAI from 'openai';
import { invokeLLM as routedInvokeLLM } from '../providers/provider_router.js';
import { getAllTools, getTool, toOpenAITools } from '../tools/index.js';
import { Memory } from '../db/memory.js';
import { ContextBuilder } from '../db/context_builder.js';
import { MemoryStore } from '../memory/memory_store.js';
import { skillManager } from '../skills/skill_manager.js';
import { compactMessages } from '../context/compactor.js';
import { tokenBudget } from '../context/token_budget.js';
import { LoopDetector, loopDetectorConfigFromEnv, failureModeAdvice } from './loop_detector.js';
import { toolEvents } from './tool_events.js';
import { logToolCall, logLoopAbort } from '../audit/audit_log.js';
import { isDestructive, requestApproval } from '../security/approval.js';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env'), override: true });

export type ExecutionMode = 'local' | 'kernel' | 'auto';

export class ShinobiOrchestrator {
  private static mode: ExecutionMode = 'kernel';
  private static memory = new Memory();
  private static contextBuilder = new ContextBuilder();
  private static memoryStore: MemoryStore | null = null;
  private static openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  private static activeModel: string | undefined = undefined;

  static getMemory(): MemoryStore { if (!this.memoryStore) this.memoryStore = new MemoryStore(); return this.memoryStore; }

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

  static async process(input: string): Promise<any> {
    console.log(`[Shinobi] Processing: ${input.slice(0, 50)}...`);

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
    }
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
    const allTools = getAllTools();
    const availableTools = this.mode === 'local'
      ? allTools.filter(t => t.name !== 'start_kernel_mission')
      : allTools;
    const openAITools = toOpenAITools(availableTools);

    let iteration = 0;
    const maxIterations = 10;

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

    while (iteration < maxIterations) {
      iteration++;
      console.log(`[Shinobi] Let the LLM decide (Iter ${iteration})...`);

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
        const compaction = compactMessages(currentMessages, {
          budgetTokens: Number(process.env.SHINOBI_CONTEXT_BUDGET) || 32_000,
        });
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
        } catch { /* tracker es opcional */ }

        const llmPayload = {
          messages: currentMessages,
          model: this.activeModel,
          tools: openAITools.length > 0 ? openAITools : undefined,
          tool_choice: openAITools.length > 0 ? 'auto' : 'none',
          temperature: 0.2,
        };
        // Bloque 7 — provider_router decide qué client llama según
        // SHINOBI_PROVIDER. Para 'opengravity' (default legacy) preserva el
        // fallback a OpenRouter del Bloque 1.1. Para groq/openai/anthropic/
        // openrouter va directo al provider elegido (sin fallback — el user
        // eligió, respetamos).
        const result = await routedInvokeLLM(llmPayload);
        if (!result.success) {
          throw new Error(`LLM Error: ${result.error}`);
        }

        const responseMessage = JSON.parse(result.output);

        // If the LLM just responds with text, we are done
        if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
          await this.memory.addMessage({ role: 'assistant', content: responseMessage.content || '' });
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

        // Execute all requested tool calls
        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.type !== 'function') continue;
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);
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
            const approved = await requestApproval({
              toolName: functionName,
              args: functionArgs,
              destructive: approvalVerdict.destructive,
              reason: approvalVerdict.reason,
            });
            if (!approved) {
              const denyReason = approvalVerdict.reason || 'requiere confirmación del usuario';
              toolResultStr = JSON.stringify({
                success: false,
                error: `Acción no aprobada: "${functionName}" (${denyReason}). No se ejecutó. ` +
                  `El usuario puede ajustar el modo con /approval [on|smart|off].`,
              });
              console.log(`  [⛔] Aprobación denegada: ${functionName}`);
              logToolCall({ tool: functionName, args: functionArgs, success: false, durationMs: 0, error: 'approval_denied' });
            } else {
            const t0 = Date.now();
            toolEvents().emitToolStarted({ tool: functionName, args: functionArgs });
            const result = await tool.execute(functionArgs);
            const durationMs = Date.now() - t0;
            toolResultStr = JSON.stringify(result);
            if (result.success) {
              console.log(`       ✅ Success`);
            } else {
              console.log(`       ❌ Failed: ${result.error}`);
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
