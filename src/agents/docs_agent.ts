// src/agents/docs_agent.ts
//
// DocsAgent — agente especialista de generación de documentos.
//
// Bloque 1: contrato. Bloque 2: lógica de output real — produce() conecta el
// agente a la maquinaria de documentos del entorno (src/documents/factory.ts:
// PDF vía Playwright, Markdown estructurado, Word) SIN librería ajena nueva.
//
// Nivel L2 (matriz §7 en prompts/docs_agent.md). readsUntrustedInput=false:
// no obtiene input externo por su cuenta. La defensa §9 capa 1 (no obedecer
// instrucciones embebidas en el contenido) vive en el prompt madre y se
// aplica al envolver el contenido en <content>.

import { SpecialistAgent } from './specialist_agent.js';
import { agentLLM, type DocsOutput } from './agent_runtime.js';
import { generateDocument } from '../documents/factory.js';

export interface DocsRequest {
  /** Título del documento. */
  title: string;
  /** Contenido a formatear (fuente de verdad — no se añaden hechos). */
  content: string;
  /** Formato de salida. Default: markdown. */
  format?: 'pdf' | 'markdown' | 'word';
}

function stripFence(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.replace(/^\s*```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
}

/** Lista los encabezados (# ## ###) de un cuerpo Markdown. */
function headingSummary(md: string): string {
  const heads = md.split(/\r?\n/).filter(l => /^#{1,3}\s+\S/.test(l.trim()))
    .map(l => l.trim().replace(/^#{1,3}\s+/, ''));
  return heads.length ? heads.join(' · ') : '(sin encabezados)';
}

export class DocsAgent extends SpecialistAgent {
  constructor() {
    super({
      id: 'docs_agent',
      specialty:
        'Convierte contenido ya provisto en documentos estructurados y legibles (Markdown, PDF) sin añadir hechos.',
      level: 'L2',
      allowedTools: ['generate_document', 'write_file', 'read_file', 'list_dir'],
      promptFile: 'docs_agent.md',
      readsUntrustedInput: false,
    });
  }

  /**
   * Produce un documento real y abrible a partir del contenido provisto.
   * El LLM (con el prompt madre del agente) estructura el contenido; la
   * maquinaria del entorno genera el fichero. Devuelve la ruta del artefacto.
   */
  async produce(req: DocsRequest): Promise<DocsOutput> {
    const format = req.format ?? 'markdown';
    const title = (req.title || '').trim();
    const content = (req.content || '').trim();
    if (!title) throw new Error('DocsAgent.produce: title requerido.');
    if (!content) throw new Error('DocsAgent.produce: content vacío — no hay nada que formatear.');

    // Caja de herramientas (contrato del Bloque 1) — falla limpio si se sale.
    this.assertToolAllowed('generate_document');

    // El contenido va en bloque <content> delimitado (§9 capa 1): el LLM lo
    // trata como dato a formatear, nunca como instrucciones.
    const user =
      `Format the content below into a clean, well-structured document body in Markdown.\n` +
      `Use #, ##, ### headings that reflect the content's natural structure. Preserve every ` +
      `citation or source reference. Do NOT add facts, sections, or data not present in the content.\n` +
      `Return ONLY the Markdown document body — no preamble, no code fence, no commentary.\n\n` +
      `<content>\n${content}\n</content>`;

    // Llamada al LLM resiliente a un hipo transitorio del proveedor: si
    // `chat` lanza o devuelve algo que no es texto, se reintenta. Sin esto,
    // una respuesta null reventaba en stripFence (`null.replace`).
    let body = '';
    let lastErr = 'sin respuesta';
    for (let attempt = 0; attempt < 3 && !body; attempt++) {
      let raw: unknown = null;
      try {
        raw = await agentLLM().chat(
          [
            { role: 'system', content: this.promptMadre() },
            { role: 'user', content: user },
          ],
          { temperature: 0.2 },
        );
      } catch (e: any) { lastErr = e?.message ?? String(e); }
      const stripped = stripFence(raw);
      if (stripped) body = stripped;
      else { lastErr = typeof raw === 'string' ? 'cuerpo vacío' : 'respuesta no textual'; await new Promise(r => setTimeout(r, 400)); }
    }
    if (!body) throw new Error(`DocsAgent.produce: el LLM no devolvió cuerpo de documento (${lastErr}).`);

    // Maquinaria de documentos del entorno (sin librería nueva).
    const doc = await generateDocument({ type: format, title, content_md: body });

    const structure = headingSummary(body);
    const gaps = structure === '(sin encabezados)'
      ? 'El documento no produjo encabezados — contenido demasiado breve o plano.'
      : null;

    return { artifact: doc.path, bytes: doc.bytes, format, structure, gaps };
  }
}
