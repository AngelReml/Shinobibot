#!/usr/bin/env node
// Builds the 8 synthetic PDFs the killer demo expects. Each PDF is a
// hand-rolled minimal PDF with a /Info dictionary whose /Title differs from
// the filename. Pure stdlib — no pdfkit, no LaTeX. Filename example:
// doc_0001.pdf, internal title: "Quarterly Report Q3 2025".
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'pdfs');
mkdirSync(OUT, { recursive: true });

const DOCS = [
  { file: 'doc_0001.pdf', title: 'Quarterly Report Q3 2025' },
  { file: 'doc_0002.pdf', title: 'Acquisition Memo 2026' },
  { file: 'doc_0003.pdf', title: 'Annual Compliance Audit' },
  { file: 'doc_0004.pdf', title: 'Engineering RFC 18 — Hash chain v2' },
  { file: 'doc_0005.pdf', title: 'HR Policy Update — Remote work' },
  { file: 'doc_0006.pdf', title: 'Customer Onboarding Brief' },
  { file: 'doc_0007.pdf', title: 'Strategic Roadmap 2026 H1' },
  { file: 'doc_0008.pdf', title: 'GDPR Compliance Review' },
];

function escapePdf(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdf(title) {
  const objs = [];
  // 1. Catalog
  objs.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  // 2. Pages
  objs.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  // 3. Page
  objs.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n');
  // 4. Contents
  const stream = `BT /F1 12 Tf 50 720 Td (${escapePdf(title)}) Tj ET`;
  objs.push(`4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`);
  // 5. Font
  objs.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  // 6. Info — this is what the killer task is supposed to extract.
  objs.push(`6 0 obj\n<< /Title (${escapePdf(title)}) /Producer (shinobi-killer-demo) >>\nendobj\n`);

  let body = '%PDF-1.4\n';
  const offsets = [];
  for (const obj of objs) {
    offsets.push(body.length);
    body += obj;
  }
  const xrefStart = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    body += String(off).padStart(10, '0') + ' 00000 n \n';
  }
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

for (const d of DOCS) {
  writeFileSync(join(OUT, d.file), buildPdf(d.title));
  console.log(`[gen-pdfs] ${d.file} -> "${d.title}"`);
}

writeFileSync(join(__dirname, 'manifest.json'), JSON.stringify({ documents: DOCS }, null, 2), 'utf-8');
console.log(`[gen-pdfs] wrote ${DOCS.length} pdfs + manifest.json`);
