// src/documents/word.ts
//
// Bloque 5 — generador Word (.docx) usando la librería `docx`.
//
// Toma `content_md` (markdown estructurado) y emite un .docx con:
//   - Header con el título
//   - Tabla de contenidos automática (Word la regenera al abrir; F9 manual)
//   - Headings H1/H2/H3 con tamaños escalonados
//   - Body Calibri 11pt
//   - Listas con bullets / numeradas
//   - Footer con paginación "Página X de Y"
//   - Margenes 2.5 cm

import * as fs from 'fs';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageNumber,
  Header,
  Footer,
  TableOfContents,
  PageBreak,
  LevelFormat,
  type ISectionOptions,
} from 'docx';

export interface WordInput {
  title: string;
  content_md: string;
  outputPath: string;
}

function tokensFromMarkdown(md: string): Paragraph[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: Paragraph[] = [];
  let buffer: string[] = [];

  const flushParagraph = () => {
    if (buffer.length === 0) return;
    const text = buffer.join(' ').trim();
    buffer = [];
    if (text) out.push(new Paragraph({ children: [new TextRun({ text, size: 22 /* 11pt */, font: 'Calibri' })] }));
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    // Blank line → paragraph separator
    if (!line.trim()) { flushParagraph(); continue; }

    // Headings
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushParagraph();
      const lvl = h[1].length;
      const text = h[2].trim();
      const size = lvl === 1 ? 32 : lvl === 2 ? 28 : 24; // 16pt / 14pt / 12pt
      const heading = lvl === 1 ? HeadingLevel.HEADING_1 : lvl === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      out.push(new Paragraph({
        heading,
        children: [new TextRun({ text, bold: true, size, font: 'Calibri' })],
        spacing: { before: 240, after: 120 },
      }));
      continue;
    }

    // Bullet list `- X` / `* X`
    const b = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (b) {
      flushParagraph();
      out.push(new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({ text: b[1].trim(), size: 22, font: 'Calibri' })],
      }));
      continue;
    }

    // Numbered list `1. X`
    const n = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (n) {
      flushParagraph();
      out.push(new Paragraph({
        numbering: { reference: 'doc-numbering', level: 0 },
        children: [new TextRun({ text: n[1].trim(), size: 22, font: 'Calibri' })],
      }));
      continue;
    }

    // Otherwise accumulate as paragraph body
    buffer.push(line.trim());
  }
  flushParagraph();
  return out;
}

export async function generateWord(input: WordInput): Promise<{ path: string; bytes: number }> {
  const bodyParagraphs = tokensFromMarkdown(input.content_md);

  const tocPara = new TableOfContents('Tabla de contenidos', {
    hyperlink: true,
    headingStyleRange: '1-3',
  });

  const section: ISectionOptions = {
    properties: {
      page: {
        margin: { top: 1418, right: 1418, bottom: 1418, left: 1418 }, // 2.5 cm en twentieths
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: input.title, italics: true, size: 18, font: 'Calibri', color: '777777' })],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], size: 18, font: 'Calibri', color: '777777' }),
            ],
          }),
        ],
      }),
    },
    children: [
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: input.title, bold: true, size: 44, font: 'Calibri' })],
        spacing: { after: 480 },
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: new Date().toLocaleDateString(), size: 20, font: 'Calibri', color: '777777' })],
        spacing: { after: 720 },
      }),
      new Paragraph({ children: [new TextRun({ text: 'Tabla de contenidos', bold: true, size: 28, font: 'Calibri' })], spacing: { after: 120 } }),
      tocPara,
      new Paragraph({ children: [new PageBreak()] }),
      ...bodyParagraphs,
    ],
  };

  const doc = new Document({
    creator: 'Shinobi',
    title: input.title,
    description: 'Generado por Shinobi (Bloque 5)',
    numbering: {
      config: [{
        reference: 'doc-numbering',
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
    sections: [section],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(input.outputPath, buffer);
  const stat = fs.statSync(input.outputPath);
  return { path: input.outputPath, bytes: stat.size };
}
