import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
process.env.SHINOBI_LSP = '1';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-lsp-smoke-'));
process.env.WORKSPACE_ROOT = dir;
import writeFile from '../../src/tools/write_file.js';
async function main() {
  const f = path.join(dir, 'buggy.ts');
  const r = await writeFile.execute({ path: f, content: 'function f(x: number) {\n  return x +\n}\nconst y: string = 123 as\n' });
  console.log('=== write_file output (SHINOBI_LSP=1, compilador TS real) ===');
  console.log(r.output);
  fs.rmSync(dir, { recursive: true, force: true });
}
main().catch(e=>{console.error(e); process.exit(1);});
