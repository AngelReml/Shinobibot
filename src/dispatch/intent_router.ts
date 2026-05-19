// src/dispatch/intent_router.ts

export interface IntentRouteResult {
  matched: boolean;
  type: 'command' | 'regex_intent' | 'none';
  intentName?: string;
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

  /**
   * Routes the input string to find a match.
   * Resolves in <2ms for deterministic commands or cached regex intents.
   */
  public static async route(input: string): Promise<IntentRouteResult> {
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

    // 2. Intent Matching ligero síncrono para lenguaje natural
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
