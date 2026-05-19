// src/runtime/trajectory_helpers.ts

export const _TOOL_CALL_ARGUMENTS_CORRUPTION_MARKER = 'repaired_by_sanitizer';

/**
 * Normaliza y convierte un array de mensajes a un formato texto estandarizado.
 * Útil para exportar trazas de entrenamiento (trajectories) y telemetría.
 */
export function convertToTrajectoryFormat(messages: any[]): string {
  let out = '';
  for (const m of messages) {
    out += `\n<${m.role}>\n`;
    
    // Si el asistente genera texto además de tools, suele ser razonamiento
    if (m.role === 'assistant' && m.content && typeof m.content === 'string' && m.content.trim().length > 0) {
      out += `<think>\n${m.content.trim()}\n</think>\n`;
    } else if (m.content) {
      if (typeof m.content === 'string') {
        out += `${m.content.trim()}\n`;
      } else {
        out += `${JSON.stringify(m.content)}\n`;
      }
    }
    
    if (m.tool_calls && Array.isArray(m.tool_calls)) {
      out += `<tool_calls>\n${JSON.stringify(m.tool_calls, null, 2)}\n</tool_calls>\n`;
    }
    
    out += `</${m.role}>\n`;
  }
  return out.trim();
}

/**
 * Detecta y repara JSON corrupto dentro de los tool_calls devueltos por el LLM.
 * @param llmOutputJson String devuelto por el LLM en formato JSON (OpenAI-compatible message)
 * @returns String JSON sanitizado o el original si no se pudo parsear
 */
export function sanitizeToolCallArguments(llmOutputJson: string): string {
  if (!llmOutputJson || typeof llmOutputJson !== 'string') return llmOutputJson;
  try {
    const msg = JSON.parse(llmOutputJson);
    if (!msg.tool_calls || !Array.isArray(msg.tool_calls)) return llmOutputJson;

    let repaired = false;
    for (const tc of msg.tool_calls) {
      if (tc.function && tc.function.arguments && typeof tc.function.arguments === 'string') {
        try {
          JSON.parse(tc.function.arguments);
        } catch (e) {
          // Intento heurístico de recuperación básica
          let args = tc.function.arguments.trim();
          if (!args.startsWith('{')) args = '{' + args;
          if (!args.endsWith('}')) args = args + '}';
          
          try {
            JSON.parse(args); // Validar si el fix básico funciona
            tc.function.arguments = args;
            tc._corruption_marker = _TOOL_CALL_ARGUMENTS_CORRUPTION_MARKER;
            repaired = true;
          } catch (e2) {
            // Falla la recuperación heurística; se deja original para que tool_loop maneje el error
          }
        }
      }
    }
    if (repaired) {
      return JSON.stringify(msg);
    }
    return llmOutputJson;
  } catch (e) {
    return llmOutputJson;
  }
}

/**
 * Fuerza invariantes en la alternancia de roles (ej: user-assistant) 
 * y limpia herramientas huérfanas, esencial para modelos estrictos como Anthropic.
 */
export function repairMessageSequence(messages: any[]): any[] {
  const repaired: any[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    
    if (m.role === 'system') {
      repaired.push(m);
      continue;
    }

    if (m.role === 'user') {
      // Merge mensajes consecutivos de usuario
      if (repaired.length > 0 && repaired[repaired.length - 1].role === 'user') {
        let prevContent = repaired[repaired.length - 1].content;
        let nextContent = m.content;
        if (typeof prevContent === 'string' && typeof nextContent === 'string') {
          repaired[repaired.length - 1].content = prevContent + '\n\n' + nextContent;
        } else {
          // Si alguno no es string, forzamos merge por stringify
          repaired[repaired.length - 1].content = 
            (typeof prevContent === 'string' ? prevContent : JSON.stringify(prevContent)) +
            '\n\n' + 
            (typeof nextContent === 'string' ? nextContent : JSON.stringify(nextContent));
        }
      } else {
        repaired.push({ ...m }); // clon superficial
      }
    } else if (m.role === 'assistant') {
      repaired.push({ ...m });
    } else if (m.role === 'tool') {
      // Un tool DEBE venir después de un assistant (con tool_calls) o después de otro tool
      if (repaired.length > 0) {
        const prev = repaired[repaired.length - 1];
        if ((prev.role === 'assistant' && Array.isArray(prev.tool_calls) && prev.tool_calls.length > 0) || prev.role === 'tool') {
          repaired.push({ ...m });
        } else {
          // Se ignora mensaje tool huérfano
          console.warn(`[Sanitizer] Tool message huérfano descartado: ${m.name || m.tool_call_id}`);
        }
      }
    }
  }

  return repaired;
}
