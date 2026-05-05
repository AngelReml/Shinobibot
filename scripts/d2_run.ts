// D.2 runner — ejecuta HierarchicalReader depth=2 contra el repo execa real,
// renderiza el arbol de telemetria y persiste a missions/.
import * as fs from 'fs';
import * as path from 'path';
import { HierarchicalReader, renderTelemetryTree } from '../src/reader/HierarchicalReader.js';
import { makeLLMClient } from '../src/reader/llm_adapter.js';

async function main() {
  const target = 'C:\\Users\\angel\\Desktop\\test_repos\\execa';
  if (!fs.existsSync(target)) {
    console.error(`[d2_run] target missing: ${target}`);
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`D.2 — HierarchicalReader depth=2 over ${target}`);
  console.log('═══════════════════════════════════════════════════════════════');

  const reader = new HierarchicalReader({
    llm: makeLLMClient(),
    depth: 2,
    onProgress: (ev) => {
      if (ev.node) console.log(`[d2] ${ev.phase} — ${ev.node.label}`);
      else console.log(`[d2] ${ev.phase}`);
    },
  });

  const t0 = Date.now();
  const r = await reader.read(target);
  const dur = Date.now() - t0;

  console.log('');
  console.log('───── TELEMETRY TREE ─────');
  console.log(renderTelemetryTree(r.telemetry));
  console.log('───── END TREE ─────');
  console.log('');
  console.log(`ok=${r.ok}  duration=${(dur / 1000).toFixed(1)}s  subreports=${r.subreports.length}`);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(process.cwd(), 'missions', `${ts}_d2`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telemetry.json'), JSON.stringify(r.telemetry, null, 2));
  fs.writeFileSync(path.join(dir, 'subreports.json'), JSON.stringify(r.subreports, null, 2));
  if (r.ok && r.report) fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(r.report, null, 2));
  fs.writeFileSync(path.join(dir, 'tree.txt'), renderTelemetryTree(r.telemetry));
  console.log(`[d2_run] artifacts: ${dir}`);

  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => { console.error('[d2_run] FATAL:', e); process.exit(2); });
