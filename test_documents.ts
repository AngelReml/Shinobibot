// test_documents.ts
//
// Bloque 5 — E2E del generador de documentos.
//
// Uso:
//   npx tsx test_documents.ts
//
// Sandbox tmp para que ./outputs/ del proyecto no se llene durante el test.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  generateDocument,
  detectType,
  shouldOfferDocument,
} from './src/documents/factory.js';

interface TestResult { name: string; pass: boolean; detail: string; ms: number; }
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail: string, t0: number): void {
  const ms = Date.now() - t0;
  results.push({ name, pass, detail, ms });
  const tag = pass ? '✅ PASS' : '❌ FAIL';
  console.log(`${tag} [${ms}ms] ${name} — ${detail}`);
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-doc-test-'));
process.env.SHINOBI_OUTPUT_DIR = sandbox;
console.log(`[test] sandbox: ${sandbox}`);

const SAMPLE_MD = `# Resumen ejecutivo

Análisis breve sobre **tendencias 2026**, basado en datos públicos.

## Hallazgos clave

- Crecimiento del 12% YoY en sector A
- Caída del 4% en sector B por presión regulatoria
- Estabilidad en sectores C, D, E

## Recomendaciones

1. Reasignar capital al sector A
2. Reducir exposición a B en Q2
3. Mantener en C/D/E

## Conclusión

Los datos sugieren un movimiento defensivo hacia A.
`;

async function main(): Promise<void> {
  // ─── A: Word con índice + headings ────────────────────────────────────────
  {
    const t0 = Date.now();
    try {
      const r = await generateDocument({ type: 'word', title: 'Tendencias 2026', content_md: SAMPLE_MD });
      const exists = fs.existsSync(r.path);
      const sizeOk = r.bytes > 8 * 1024; // .docx is a ZIP, even minimal docs are >8KB
      const ext = path.extname(r.path);
      // .docx is ZIP — magic bytes PK
      const buf = fs.readFileSync(r.path);
      const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
      // ZIP central directory must contain `word/document.xml`
      const containsDocXml = buf.includes(Buffer.from('word/document.xml'));
      // El contenido del docx va comprimido (DEFLATE), así que TOC/headings
      // no son buscables como bytes raw. Verificamos estructura: ZIP +
      // word/document.xml entry + tamaño realista. La presencia de TOC se
      // valida visualmente al abrir en Word (la lib `docx` la inserta como
      // field code TableOfContents en el sección builder).
      const ok = exists && sizeOk && ext === '.docx' && isZip && containsDocXml;
      record('A. Word con índice + headings (estructural)', ok,
        `path=${path.basename(r.path)}, bytes=${r.bytes}, zip=${isZip}, has_doc_xml=${containsDocXml}`,
        t0);
    } catch (e: any) {
      record('A. Word con índice + headings', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── B: PDF magic bytes %PDF y tamaño razonable ──────────────────────────
  {
    const t0 = Date.now();
    try {
      const r = await generateDocument({ type: 'pdf', title: 'Tendencias 2026', content_md: SAMPLE_MD });
      const buf = fs.readFileSync(r.path);
      const magic = buf.slice(0, 4).toString('utf-8');
      const ok = magic === '%PDF' && r.bytes > 2 * 1024;
      record('B. PDF magic %PDF + tamaño', ok,
        `path=${path.basename(r.path)}, bytes=${r.bytes}, magic="${magic}"`,
        t0);
    } catch (e: any) {
      record('B. PDF magic %PDF + tamaño', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── C: Excel headers en bold + datos accesibles via exceljs ─────────────
  {
    const t0 = Date.now();
    try {
      const r = await generateDocument({
        type: 'excel',
        title: 'Gastos Q1',
        content_table: {
          headers: ['Concepto', 'Mes', 'Importe'],
          rows: [
            ['Servidor', 'Enero', 120],
            ['Servidor', 'Febrero', 120],
            ['Servidor', 'Marzo', 130],
            ['Dominios', 'Enero', 45],
            ['Dominios', 'Marzo', 45],
          ],
          formulas: [{ col: 2, type: 'sum' }],
        },
      });
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(r.path);
      const ws = wb.worksheets[0];
      const headerCell = ws.getCell('A1');
      const headerBold = headerCell.font?.bold === true;
      const headerText = headerCell.value === 'Concepto';
      const rowCount = ws.rowCount;
      const formulaCell = ws.getCell('C7'); // header row + 5 data rows + 1 formula row
      const hasFormula = !!(formulaCell.value as any)?.formula;
      const ok = headerBold && headerText && rowCount >= 7 && hasFormula;
      record('C. Excel headers bold + fórmula SUM', ok,
        `header_bold=${headerBold}, header_text=${headerText}, rows=${rowCount}, has_formula=${hasFormula}`,
        t0);
    } catch (e: any) {
      record('C. Excel headers bold + fórmula SUM', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── D: Markdown round-trip simple ───────────────────────────────────────
  {
    const t0 = Date.now();
    try {
      const r = await generateDocument({ type: 'markdown', title: 'Notas', content_md: '# Hola\n\nbody here' });
      const text = fs.readFileSync(r.path, 'utf-8');
      const ok = path.extname(r.path) === '.md' && /# Hola/.test(text) && /body here/.test(text);
      record('D. Markdown round-trip', ok, `path=${path.basename(r.path)}, contains_title=${/# Hola/.test(text)}`, t0);
    } catch (e: any) {
      record('D. Markdown round-trip', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── E: Auto-detect heurístico (5 prompts) ───────────────────────────────
  {
    const t0 = Date.now();
    try {
      const cases: { prompt: string; expected: string }[] = [
        { prompt: 'genera un informe de 30 páginas sobre la guerra fría',           expected: 'word' },
        { prompt: 'crea una tabla con los gastos por mes',                          expected: 'excel' },
        { prompt: 'haz un PDF de la investigación final',                            expected: 'pdf' },
        { prompt: 'dame un readme en markdown con los pasos',                       expected: 'markdown' },
        { prompt: 'una hoja de cálculo con columnas A B C',                         expected: 'excel' },
      ];
      const out: string[] = [];
      let allOk = true;
      for (const c of cases) {
        const got = detectType(c.prompt);
        const ok = got === c.expected;
        if (!ok) allOk = false;
        out.push(`  ${ok ? '✓' : '✗'} "${c.prompt}" → ${got} (expected ${c.expected})`);
      }
      record('E. Auto-detect heurístico (5 prompts)', allOk, `${cases.length} sub-cases`, t0);
      for (const line of out) console.log(line);
    } catch (e: any) {
      record('E. Auto-detect heurístico (5 prompts)', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── F: shouldOfferDocument detector ─────────────────────────────────────
  {
    const t0 = Date.now();
    try {
      const longStructured = '# Section A\n\n' + 'lorem ipsum '.repeat(300) + '\n\n## Section B\n\nmore text '.repeat(50);
      const shortFlat = 'just a quick reply.';
      const longFlat = 'lorem '.repeat(800); // long but no structure
      const offerLong = shouldOfferDocument(longStructured);
      const offerShort = shouldOfferDocument(shortFlat);
      const offerLongFlat = shouldOfferDocument(longFlat);
      const ok = offerLong === true && offerShort === false && offerLongFlat === false;
      record('F. shouldOfferDocument heurístico', ok,
        `long_struct=${offerLong}, short=${offerShort}, long_flat=${offerLongFlat}`,
        t0);
    } catch (e: any) {
      record('F. shouldOfferDocument heurístico', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('═════════════════════════════════════════════════════');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`Summary: ${passed}/${total} tests passed`);
  for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.name} (${r.ms}ms)`);
  console.log('═════════════════════════════════════════════════════');

  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('[test] fatal:', err);
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(2);
});
