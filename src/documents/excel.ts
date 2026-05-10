// src/documents/excel.ts
//
// Bloque 5 — generador Excel (.xlsx) usando exceljs.
//
// Headers en row 1 (bold + bg azul + fg blanco), alternancia de filas par/impar
// para legibilidad, columnas auto-width, fórmulas opcionales (sum/avg/count)
// añadidas en la fila siguiente a la última fila de datos.

import * as fs from 'fs';

export interface ExcelFormula {
  /** 0-indexed column. */
  col: number;
  type: 'sum' | 'avg' | 'count';
  /** Optional label override; default `Σ` / `μ` / `n`. */
  label?: string;
}

export interface ExcelInput {
  title: string;
  content_table: {
    headers: string[];
    rows: (string | number)[][];
    formulas?: ExcelFormula[];
  };
  outputPath: string;
}

function colLetter(i0: number): string {
  // 0 → A, 1 → B, ..., 25 → Z, 26 → AA …
  let i = i0;
  let s = '';
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}

export async function generateExcel(input: ExcelInput): Promise<{ path: string; bytes: number }> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Shinobi';
  wb.created = new Date();
  const ws = wb.addWorksheet(input.title.slice(0, 30) || 'Sheet1');

  const { headers, rows, formulas } = input.content_table;

  // Headers
  ws.addRow(headers);
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 22;

  // Data rows with alternating fill
  for (let i = 0; i < rows.length; i++) {
    const r = ws.addRow(rows[i]);
    if (i % 2 === 1) {
      r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6FA' } };
    }
  }

  // Formula row (one row below the last data row)
  if (formulas && formulas.length) {
    const lastDataRowNum = 1 + rows.length;
    const formulaRowNum = lastDataRowNum + 1;
    const formulaRow = ws.getRow(formulaRowNum);
    formulaRow.font = { bold: true, color: { argb: 'FF1F4E78' } };
    for (const f of formulas) {
      const letter = colLetter(f.col);
      const range = `${letter}2:${letter}${lastDataRowNum}`;
      const fnName = f.type === 'avg' ? 'AVERAGE' : f.type.toUpperCase();
      const cell = ws.getCell(`${letter}${formulaRowNum}`);
      cell.value = { formula: `${fnName}(${range})`, date1904: false } as any;
    }
    // Optional label cell to the left if column 0 is empty.
    if (formulas.length > 0 && headers.length > 0 && !formulas.some(f => f.col === 0)) {
      ws.getCell(`A${formulaRowNum}`).value = 'Total';
      ws.getCell(`A${formulaRowNum}`).font = { bold: true, color: { argb: 'FF1F4E78' } };
    }
  }

  // Auto-width columns based on header + first 50 rows.
  ws.columns.forEach((col, idx) => {
    let maxLen = String(headers[idx] ?? '').length;
    for (let i = 0; i < Math.min(rows.length, 50); i++) {
      const v = rows[i]?.[idx];
      const s = v == null ? '' : String(v);
      if (s.length > maxLen) maxLen = s.length;
    }
    col.width = Math.min(60, Math.max(10, maxLen + 2));
  });

  await wb.xlsx.writeFile(input.outputPath);
  const stat = fs.statSync(input.outputPath);
  return { path: input.outputPath, bytes: stat.size };
}
