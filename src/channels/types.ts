/**
 * Contrato común para todos los adaptadores de canal de Shinobi.
 *
 * Un adaptador encapsula el ciclo completo de un canal de mensajería:
 * arranque, escucha de mensajes entrantes, envío de respuestas y
 * apagado limpio. Esto unifica WebChat, Telegram, Discord, Slack,
 * Email, Signal, Matrix y los que se añadan después detrás de una
 * sola API.
 *
 * Diseño:
 *
 *  - El adaptador NO conoce al orchestrator. Recibe un `MessageHandler`
 *    al hacer `start()` y delega cada mensaje entrante a esa función.
 *    El handler devuelve `OutgoingMessage | null`. El adaptador es
 *    responsable de hacer el `send()` correspondiente.
 *
 *  - El adaptador es **opt-in**: si `isConfigured()` devuelve false
 *    (típicamente porque falta la variable de entorno con el token),
 *    no hace nada. Esto permite shippear el binario con todos los
 *    adaptadores compilados sin requerir credenciales para cada uno.
 *
 *  - Dependencias externas (discord.js, @slack/web-api, imapflow,
 *    nodemailer) se importan dinámicamente DENTRO de `start()`. Si la
 *    dep no está instalada, `start()` devuelve un error claro pidiendo
 *    `npm install <pkg>` y no rompe el binario base.
 *
 *  - Ninguna implementación se inicia sola al cargar el módulo. El
 *    `channel_registry` decide qué arrancar según la config del usuario.
 */

export type ChannelId =
  | 'webchat'
  | 'telegram'
  | 'http'
  | 'discord'
  | 'slack'
  | 'whatsapp'
  | 'signal'
  | 'matrix'
  | 'email'
  | 'teams'
  | 'webhook'
  | 'loopback';

/** Dirección concreta donde el adaptador debe enviar una respuesta. */
export interface ChannelTarget {
  /** id del canal que originó la conversación (e.g. 'discord'). */
  channelId: ChannelId;
  /** Identificador específico de la plataforma (chatId, channelId, threadId...). */
  conversationId: string;
  /** Identificador del usuario / cuenta en esa plataforma. */
  userId?: string;
  /** Datos extra para la plataforma (replyTo, parentId, etc.). */
  metadata?: Record<string, unknown>;
}

export interface IncomingMessage {
  /** Adaptador que recibe el mensaje. */
  channelId: ChannelId;
  /** Cuerpo del mensaje en texto. Si la plataforma trae rich text, lo */
  /** convertimos a texto plano antes de pasar al handler. */
  text: string;
  /** Sender + conversation context para que el handler pueda responder. */
  target: ChannelTarget;
  /** Adjuntos (URLs descargables) si los hay. */
  attachments?: Array<{ url: string; mimeType?: string; name?: string }>;
  /** Timestamp de recepción. */
  receivedAt: string; // ISO8601
}

export interface OutgoingMessage {
  /** Texto a enviar de vuelta. */
  text: string;
  /** Adjuntos opcionales. */
  attachments?: Array<{ url?: string; localPath?: string; name?: string }>;
  /** Metadata pasada al adaptador (e.g. reply_to_message_id). */
  metadata?: Record<string, unknown>;
}

/** Handler que el orchestrator implementa para procesar mensajes entrantes. */
export type MessageHandler = (msg: IncomingMessage) => Promise<OutgoingMessage | null>;

export interface ChannelAdapter {
  readonly id: ChannelId;
  readonly label: string;
  /** Devuelve true si el adaptador tiene todas las credenciales necesarias. */
  isConfigured(): boolean;
  /** Lista de env vars requeridas, útil para diagnóstico del operador. */
  requiredEnvVars(): string[];
  /** Arranca el adaptador y empieza a despachar mensajes al handler. */
  start(handler: MessageHandler): Promise<void>;
  /** Apagado limpio (cierra sockets, drains queues). */
  stop(): Promise<void>;
  /** Estado de runtime para diagnóstico. */
  status(): { running: boolean; receivedCount: number; sentCount: number; lastError?: string };
  /** Envío manual (cuando el orchestrator inicia la conversación). */
  send(target: ChannelTarget, msg: OutgoingMessage): Promise<void>;
}
