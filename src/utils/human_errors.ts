// src/utils/human_errors.ts
//
// G3 — Errores traducidos al humano, en voz baja (manual §6).
// Convierte mensajes técnicos en frases comprensibles sin jerga.
// Heurística pura — sin LLM. Gated por SHINOBI_HUMAN_ERRORS≠'0' (activo por defecto).

interface ErrorRule {
  pattern: RegExp;
  human: string;
  hint?: string;
}

const RULES: ErrorRule[] = [
  // Red
  { pattern: /ECONNREFUSED|connection refused/i,      human: 'No pudo conectar con el servicio.', hint: 'Comprueba que el servicio esté activo.' },
  { pattern: /ETIMEDOUT|timed? out|timeout/i,         human: 'La operación tardó demasiado y se canceló.', hint: 'Inténtalo de nuevo o comprueba tu conexión.' },
  { pattern: /ENOTFOUND|getaddrinfo|dns/i,            human: 'No se encontró el servidor.', hint: 'Comprueba el nombre del servidor o tu conexión a internet.' },
  { pattern: /fetch failed|network error/i,           human: 'Error de red al contactar el servicio.', hint: 'Comprueba tu conexión.' },
  { pattern: /rate.?limit|429|too many requests/i,   human: 'El servicio está saturado ahora mismo.', hint: 'Espera unos segundos e inténtalo de nuevo.' },
  { pattern: /401|unauthorized|invalid.*api.?key/i,  human: 'Clave de API incorrecta o caducada.', hint: 'Revisa tu clave en Ajustes → Proveedor.' },
  { pattern: /403|forbidden/i,                        human: 'Sin permiso para realizar esta acción.', hint: 'Comprueba que tu cuenta tenga acceso.' },

  // Sistema de ficheros
  { pattern: /ENOENT|no such file|file not found/i,  human: 'El fichero o directorio no existe.', hint: 'Comprueba la ruta.' },
  { pattern: /EACCES|EPERM|permission denied/i,      human: 'Sin permiso para acceder al fichero.', hint: 'Comprueba los permisos del fichero.' },
  { pattern: /ENOSPC|no space left/i,                human: 'Sin espacio en disco.', hint: 'Libera espacio y vuelve a intentarlo.' },
  { pattern: /EEXIST|file already exists/i,          human: 'El fichero ya existe.' },

  // LLM / API
  { pattern: /context.?length|too many tokens|token.*limit/i, human: 'La conversación es demasiado larga para el modelo.', hint: 'Empieza una conversación nueva o compacta el historial.' },
  { pattern: /model.*not.*found|no such model/i,     human: 'El modelo seleccionado no está disponible.', hint: 'Cambia el modelo en Ajustes.' },
  { pattern: /overloaded|503|service unavailable/i,  human: 'El servicio no está disponible ahora mismo.', hint: 'Inténtalo en unos minutos.' },

  // Seguridad / candado
  { pattern: /approval.?denied|candado|no aprobad|gate.*deni/i, human: 'Acción bloqueada por el candado de seguridad.', hint: 'Si es una acción legítima, apruébala cuando el sistema te lo pida.' },
  { pattern: /requires.*approval|requiere.*aprobaci/i,          human: 'Esta acción necesita tu aprobación.', hint: 'Responde sí o no cuando el sistema te lo pregunte.' },

  // Instalación / entorno
  { pattern: /cannot find module|module not found/i, human: 'Falta un componente del programa.', hint: 'Reinstala Shinobi o ejecuta npm install.' },
  { pattern: /EADDRINUSE|address already in use/i,   human: 'El puerto ya está en uso.', hint: 'Cierra la otra instancia de Shinobi o cambia el puerto.' },

  // Chrome / CDP
  { pattern: /websocket.*cdp|cdp.*connect|chrome.*debug|port.?922[0-9]/i, human: 'No se pudo conectar al navegador.', hint: 'Abre Comet/Chrome con el puerto CDP activo (usa el acceso directo "Comet CDP 9222").' },

  // Genérico
  { pattern: /out of memory|heap.*out/i,             human: 'Sin memoria suficiente.', hint: 'Cierra otras aplicaciones y vuelve a intentarlo.' },
  { pattern: /json.*parse|unexpected token|invalid json/i, human: 'Respuesta con formato incorrecto.', hint: 'El servicio devolvió datos inesperados. Inténtalo de nuevo.' },
];

export interface HumanError {
  /** Mensaje amable para mostrar al usuario. */
  message: string;
  /** Pista opcional para resolver el problema. */
  hint?: string;
  /** Mensaje técnico original (para log interno). */
  raw: string;
}

/** true cuando el traductor está activo (default: sí). */
export function humanErrorsEnabled(): boolean {
  return process.env.SHINOBI_HUMAN_ERRORS !== '0';
}

/**
 * Traduce un mensaje de error técnico a lenguaje humano.
 * Si no hay patrón que coincida, devuelve el mensaje original
 * con una introducción genérica amable.
 */
export function humanizeError(raw: string): HumanError {
  if (!humanErrorsEnabled()) return { message: raw, raw };

  const test = raw.slice(0, 500);
  for (const rule of RULES) {
    if (rule.pattern.test(test)) {
      return { message: rule.human, hint: rule.hint, raw };
    }
  }

  // Sin match: versión genérica limpia (sin stack trace).
  const firstLine = raw.split('\n')[0].replace(/^Error:\s*/i, '').trim();
  const short = firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine;
  return {
    message: short || 'Ocurrió un error inesperado.',
    hint: 'Puedes intentarlo de nuevo o consultar el log para más detalles.',
    raw,
  };
}

/**
 * Formatea un HumanError para mostrar al usuario.
 * Devuelve una cadena lista para el chat.
 */
export function formatHumanError(e: HumanError): string {
  return e.hint ? `${e.message} ${e.hint}` : e.message;
}
