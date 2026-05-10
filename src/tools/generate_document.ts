// src/tools/generate_document.ts
//
// Bloque 5 — tool registrada para que el LLM genere documentos
// autónomamente cuando el usuario pide un informe / tabla / PDF / etc.
//
// El LLM provee el contenido (markdown estructurado o tabla) y este wrapper
// dispatcha al factory. Devuelve la ruta del archivo generado para que el
// LLM la incluya en su respuesta final.

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { generateDocument, type DocumentRequest } from '../documents/factory.js';

const generateDocumentTool: Tool = {
  name: 'generate_document',
  description:
    'Generate a professional document file (Word .docx, PDF, Excel .xlsx, or Markdown .md) from structured content. ' +
    'Use this when the user asks for a "report", "table", "spreadsheet", "PDF", or any deliverable file. ' +
    'For word/pdf/markdown pass `content_md` (markdown with #/##/### headings, lists, paragraphs). ' +
    'For excel pass `content_table` with `headers` array and `rows` 2D array. ' +
    'Use type:"auto" to let Shinobi pick based on the instruction (recommended unless the user is explicit).',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['word', 'pdf', 'excel', 'markdown', 'auto'],
        description: "Document type. 'auto' uses heuristic detection from `instruction`.",
      },
      title: { type: 'string', description: 'Document title (used as filename slug, header, sheet name).' },
      content_md: {
        type: 'string',
        description: 'Markdown body for word/pdf/markdown. Supports # ## ### headings, - * bullets, 1. ordered lists, **bold**, *italic*, `code`, ```fenced``` blocks.',
      },
      content_table: {
        type: 'object',
        description: 'Tabular content for excel. Required if type is excel.',
        properties: {
          headers: { type: 'array', items: { type: 'string' } },
          rows: { type: 'array', items: { type: 'array' } },
          formulas: {
            type: 'array',
            description: 'Optional aggregate row at the bottom.',
            items: {
              type: 'object',
              properties: {
                col: { type: 'number', description: '0-indexed column to aggregate.' },
                type: { type: 'string', enum: ['sum', 'avg', 'count'] },
              },
              required: ['col', 'type'],
            },
          },
        },
        required: ['headers', 'rows'],
      },
      instruction: {
        type: 'string',
        description: "Natural-language description of the document, used by 'auto' to detect type. Optional.",
      },
    },
    required: ['type', 'title'],
  },

  async execute(args: any): Promise<ToolResult> {
    try {
      const req: DocumentRequest = {
        type: args.type,
        title: args.title,
        content_md: args.content_md,
        content_table: args.content_table,
        instruction: args.instruction,
      };
      const r = await generateDocument(req);
      return {
        success: true,
        output: JSON.stringify({
          type: r.type,
          path: r.path,
          bytes: r.bytes,
          title: r.title,
          message: `Documento ${r.type} generado: ${r.path} (${r.bytes.toLocaleString()} bytes)`,
        }, null, 2),
      };
    } catch (err: any) {
      return { success: false, output: '', error: `generate_document error: ${err.message}` };
    }
  },
};

registerTool(generateDocumentTool);
export default generateDocumentTool;
