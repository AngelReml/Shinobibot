/**
 * One-shot test runner for the 3 validation fixes
 */
import { config } from 'dotenv';
import * as fs from 'fs';
config();

// Clean up fix_test folder so TEST C always creates fresh
const fixTestPath = 'C:\\Users\\angel\\Desktop\\fix_test';
if (fs.existsSync(fixTestPath)) fs.rmdirSync(fixTestPath, { recursive: true });

import { ShinobiOrchestrator } from '../src/coordinator/orchestrator.js';

const TESTS = [
  {
    label: 'TEST A — Fix 1: Python language detection',
    input: 'Escribe un script Python que liste todos los archivos .py del escritorio',
  },
  {
    label: 'TEST B — Fix 2: Web search via Playwright',
    input: "Busca en Google 'OpenGravity AI agent' y devuélveme los 3 primeros resultados",
  },
  {
    label: 'TEST C — Fix 3: Filesystem task → local execution',
    input: 'Crea una carpeta llamada fix_test en C:\\Users\\angel\\Desktop',
  },
];

ShinobiOrchestrator.setMode('local');

for (const t of TESTS) {
  console.log('\n' + '═'.repeat(60));
  console.log(t.label);
  console.log('═'.repeat(60));
  try {
    const result = await ShinobiOrchestrator.process(t.input);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('ERROR:', err.message);
  }
}
