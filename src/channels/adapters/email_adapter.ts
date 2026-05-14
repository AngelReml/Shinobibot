/**
 * Email Adapter — IMAP (inbound) + SMTP (outbound) usando `imapflow` y
 * `nodemailer`. Hace polling por IDLE/exists del INBOX y manda
 * respuestas vía SMTP con threading correcto (In-Reply-To + References).
 *
 * Requisitos del operador:
 *   IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS, IMAP_TLS (default true)
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_TLS (default true)
 *   EMAIL_ALLOWED_SENDERS (opcional, CSV) — limita quién puede dialogar.
 *
 * Dependencias dinámicas: `imapflow`, `nodemailer`, `mailparser`. Si
 * faltan, fail-fast con instrucción `npm install`.
 *
 * Nota sobre threading: cuando respondemos, copiamos el `Message-ID` del
 * email entrante a `In-Reply-To` y añadimos a `References` para que
 * Gmail/Outlook agrupen la conversación correctamente.
 */

import type { ChannelAdapter, IncomingMessage, MessageHandler, OutgoingMessage, ChannelTarget } from '../types.js';

export class EmailAdapter implements ChannelAdapter {
  readonly id = 'email' as const;
  readonly label = 'Email (IMAP/SMTP)';

  private imap: any = null;
  private smtp: any = null;
  private handler: MessageHandler | null = null;
  private receivedCount = 0;
  private sentCount = 0;
  private lastError: string | undefined;
  private running = false;
  private pollTimer: any = null;

  isConfigured(): boolean {
    return !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS
           && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  requiredEnvVars(): string[] {
    return [
      'IMAP_HOST', 'IMAP_PORT', 'IMAP_USER', 'IMAP_PASS',
      'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS',
    ];
  }

  status() {
    return { running: this.running, receivedCount: this.receivedCount, sentCount: this.sentCount, lastError: this.lastError };
  }

  async start(handler: MessageHandler): Promise<void> {
    if (!this.isConfigured()) throw new Error('Email IMAP/SMTP env vars no configurados');
    let imapflowMod: any;
    let nodemailerMod: any;
    let mailparserMod: any;
    // Imports indirectos: las deps son opcionales. Variables intermedias
    // evitan que tsc falle con TS2307 cuando no están instaladas.
    const pkgImap = 'imapflow';
    const pkgMail = 'nodemailer';
    const pkgParse = 'mailparser';
    try {
      imapflowMod = await import(pkgImap);
      nodemailerMod = await import(pkgMail);
      mailparserMod = await import(pkgParse);
    } catch {
      throw new Error('Faltan dependencias. Ejecuta: npm install imapflow nodemailer mailparser');
    }
    const { ImapFlow } = imapflowMod;
    const allowedSenders = new Set(
      (process.env.EMAIL_ALLOWED_SENDERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    );

    this.imap = new ImapFlow({
      host: process.env.IMAP_HOST!,
      port: Number(process.env.IMAP_PORT) || 993,
      secure: process.env.IMAP_TLS !== 'false',
      auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASS! },
      logger: false,
    });

    this.smtp = nodemailerMod.createTransport({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_TLS === 'true',
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    });

    this.handler = handler;
    await this.imap.connect();
    const lock = await this.imap.getMailboxLock('INBOX');
    lock.release();
    this.running = true;

    // Listener de eventos nuevos: cada vez que entra un email, lo procesamos.
    this.imap.on('exists', async () => {
      try {
        const lock2 = await this.imap.getMailboxLock('INBOX');
        try {
          for await (const m of this.imap.fetch({ seen: false }, { source: true, envelope: true, uid: true })) {
            const parsed = await mailparserMod.simpleParser(m.source);
            const fromAddr = (parsed.from?.value?.[0]?.address || '').toLowerCase();
            if (allowedSenders.size > 0 && !allowedSenders.has(fromAddr)) {
              await this.imap.messageFlagsAdd(m.uid, ['\\Seen'], { uid: true });
              continue;
            }
            const incoming: IncomingMessage = {
              channelId: this.id,
              text: parsed.text || (parsed.html as string) || '',
              target: {
                channelId: this.id,
                conversationId: parsed.subject || '(sin asunto)',
                userId: fromAddr,
                metadata: {
                  messageId: parsed.messageId,
                  references: parsed.references,
                  inReplyTo: parsed.inReplyTo,
                },
              },
              receivedAt: new Date().toISOString(),
            };
            this.receivedCount++;
            const reply = await this.handler!(incoming);
            await this.imap.messageFlagsAdd(m.uid, ['\\Seen'], { uid: true });
            if (reply) await this.send(incoming.target, reply);
          }
        } finally {
          lock2.release();
        }
      } catch (e: any) {
        this.lastError = e?.message ?? String(e);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.imap) {
      try { await this.imap.logout(); } catch { /* swallow */ }
    }
    if (this.smtp) {
      try { this.smtp.close(); } catch { /* swallow */ }
    }
    this.imap = null;
    this.smtp = null;
    this.handler = null;
    this.running = false;
  }

  async send(target: ChannelTarget, msg: OutgoingMessage): Promise<void> {
    if (!this.smtp) throw new Error('Email adapter no está running');
    const meta = (target.metadata ?? {}) as any;
    const subject = target.conversationId.startsWith('Re:') ? target.conversationId : `Re: ${target.conversationId}`;
    const ref = [meta.references, meta.messageId].filter(Boolean).join(' ');
    await this.smtp.sendMail({
      from: process.env.SMTP_USER,
      to: target.userId,
      subject,
      text: msg.text,
      headers: {
        ...(meta.messageId ? { 'In-Reply-To': meta.messageId } : {}),
        ...(ref ? { References: ref } : {}),
      },
    });
    this.sentCount++;
  }
}
