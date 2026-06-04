// src/dispatch/intent_router.ts
import { validatePayload, ProtocolViolation } from '../coordinator/contracts.js';
import { ALCAYNA_AGENT_IDS, getAlcaynaAgentByKeyword } from '../agents/agent_registry.js';

export interface IntentRouteResult {
  matched: boolean;
  type: 'command' | 'regex_intent' | 'agent_activation' | 'none';
  intentName?: string;
  agentId?: string;
  response?: string;
}

export interface IntentRule {
  name: string;
  pattern: RegExp;
  handler: (input: string) => string | Promise<string>;
}

export class IntentRouter {
  private static rules: IntentRule[] = [
    {
      name: 'ping',
      pattern: /^(ping|hola|hi|hello|buenos\s+dias|buenas\s+noches|saludos)(\s+shinobi)?$/i,
      handler: () => '¡Hola! Soy ShinobiBot, tu asistente de orquestación de agentes. ¿En qué puedo ayudarte hoy?'
    },
    {
      name: 'help',
      pattern: /^(ayuda|help|qu[eé]\s+puedes\s+hacer|comandos)(\??)$/i,
      handler: () => 
        'Puedes interactuar conmigo usando lenguaje natural para tareas de código, búsqueda o documentos.\n' +
        'También tienes comandos directos disponibles:\n' +
        '  - `/status` para verificar el estado del OpenGravity Kernel.\n' +
        '  - `/swarm` para ver el estado de la cola Kanban y sub-agentes.\n' +
        '  - `/model <nombre>` para fijar el modelo de IA.\n' +
        '  - `/approval [on|smart|off]` para configurar la confirmación de herramientas.'
    },
    {
      name: 'status',
      pattern: /^(status|estado|c[oó]mo\s+est[aá]s)(\??)$/i,
      handler: () => 'Sistema ShinobiBot activo. Todos los módulos e hilos están listos para procesar.'
    },
    {
      name: 'version',
      pattern: /^(versi[oó]n|version)(\??)$/i,
      handler: () => 'ShinobiBot Enterprise Edition - Versión 4.5.1'
    }
  ];

  public static isValidAgentNode(id: string): boolean {
    return ALCAYNA_AGENT_IDS.has(id);
  }

  /**
   * Routes the input string to find a match.
   * Resolves in <2ms for deterministic commands or cached regex intents.
   */
  public static async route(input: string): Promise<IntentRouteResult> {
    try {
      validatePayload('user_input', { content: input });
    } catch (err) {
      if (err instanceof ProtocolViolation) {
        console.warn(`[IntentRouter] ProtocolViolation — discarding message: ${err.message}`);
        return { matched: false, type: 'none' };
      }
      throw err;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      return { matched: false, type: 'none' };
    }

    // 1. Comando determinista explícito (empieza con / o !)
    if (trimmed.startsWith('/') || trimmed.startsWith('!')) {
      if (trimmed.startsWith('!')) {
        const cmd = trimmed.substring(1).toLowerCase().split(/\s+/)[0];
        if (cmd === 'ping') {
          return { matched: true, type: 'command', intentName: 'ping', response: 'pong' };
        }
        if (cmd === 'version') {
          return { matched: true, type: 'command', intentName: 'version', response: 'ShinobiBot v4.5.1' };
        }
        if (cmd === 'help' || cmd === 'ayuda') {
          return {
            matched: true,
            type: 'command',
            intentName: 'help',
            response: 'Comandos disponibles:\n  !ping - Prueba de latencia\n  !version - Versión del bot\n  !status - Estado del sistema'
          };
        }
        if (cmd === 'status') {
          return { matched: true, type: 'command', intentName: 'status', response: 'OK - Todos los servicios operativos' };
        }
      }
      return { matched: false, type: 'none' };
    }

    // 2. Activación de departamentos Alcayna (palabras clave exactas)
    const alcaynaAgent = getAlcaynaAgentByKeyword(trimmed);
    if (alcaynaAgent) {
      return {
        matched: true,
        type: 'agent_activation',
        agentId: alcaynaAgent.id,
        response: `Departamento ${alcaynaAgent.name} activado. ${alcaynaAgent.activationKeyword}.`,
      };
    }

    // 3. Intent Matching ligero síncrono para lenguaje natural
    for (const rule of this.rules) {
      if (rule.pattern.test(trimmed)) {
        const response = await rule.handler(trimmed);
        return {
          matched: true,
          type: 'regex_intent',
          intentName: rule.name,
          response
        };
      }
    }

    return { matched: false, type: 'none' };
  }
}
