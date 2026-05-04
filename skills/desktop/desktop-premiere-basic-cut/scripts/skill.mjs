// desktop-premiere-basic-cut — Node entry. Generates a temp .jsx and runs Premiere with -script.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import { registerTool } from '../../../../src/tools/tool_registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(__dirname, 'cut.jsx');

// `HH:MM:SS.mmm` or `MM:SS.mmm` or `SSS.mmm`.
function parseTimecodeMs(t) {
  if (typeof t !== 'string') return null;
  const m = t.match(/^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const h = m[2] ? Number(m[1] ?? 0) : 0;
  const mm = m[2] ? Number(m[2]) : Number(m[1] ?? 0);
  const ss = Number(m[3]);
  return h * 3600 + mm * 60 + ss;
}

function findPremiereExe() {
  const candidates = [
    'C:/Program Files/Adobe/Adobe Premiere Pro 2024/Adobe Premiere Pro.exe',
    'C:/Program Files/Adobe/Adobe Premiere Pro 2025/Adobe Premiere Pro.exe',
    'C:/Program Files/Adobe/Adobe Premiere Pro 2026/Adobe Premiere Pro.exe',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

const tool = {
  name: 'desktop_premiere_basic_cut',
  description: 'Trim a video to [start,end] in Adobe Premiere Pro and export MP4. Windows only. Long-running (renders).',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string' },
      output: { type: 'string' },
      start: { type: 'string', description: 'HH:MM:SS.mmm' },
      end: { type: 'string', description: 'HH:MM:SS.mmm' },
      preset: { type: 'string' },
    },
    required: ['input', 'output', 'start', 'end'],
  },
  async execute(args) {
    if (!args?.input || !args?.output || !args?.start || !args?.end) {
      return { success: false, output: '', error: 'input, output, start, end required' };
    }
    if (process.platform !== 'win32') return { success: false, output: '', error: 'Windows-only skill' };
    if (!existsSync(args.input)) return { success: false, output: '', error: `input not found: ${args.input}` };
    const startSec = parseTimecodeMs(args.start);
    const endSec = parseTimecodeMs(args.end);
    if (startSec == null || endSec == null) return { success: false, output: '', error: 'invalid timecode (expected HH:MM:SS.mmm)' };
    if (endSec <= startSec) return { success: false, output: '', error: 'end must be > start' };

    const exe = findPremiereExe();
    if (!exe) return { success: false, output: '', error: 'Premiere Pro executable not found in default Adobe install path' };
    if (!existsSync(TEMPLATE)) return { success: false, output: '', error: `template missing: ${TEMPLATE}` };

    const tmp = mkdtempSync(join(os.tmpdir(), 'shinobi-premiere-'));
    const resultPath = join(tmp, 'result.json');
    const jsxPath = join(tmp, 'cut.jsx');
    const tpl = readFileSync(TEMPLATE, 'utf-8')
      .replace(/__INPUT__/g, args.input.replace(/\\/g, '/'))
      .replace(/__OUTPUT__/g, args.output.replace(/\\/g, '/'))
      .replace(/__START_SEC__/g, String(startSec))
      .replace(/__END_SEC__/g, String(endSec))
      .replace(/__PRESET__/g, (args.preset ?? '').replace(/'/g, "\\'"))
      .replace(/__RESULT_PATH__/g, resultPath.replace(/\\/g, '/'));
    writeFileSync(jsxPath, tpl, 'utf-8');

    const r = spawnSync(exe, ['-script', jsxPath], { encoding: 'utf-8', timeout: 30 * 60 * 1000 });
    if (r.error) {
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
      return { success: false, output: '', error: `premiere spawn error: ${r.error.message}` };
    }
    if (!existsSync(resultPath)) {
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
      return { success: false, output: '', error: `no result file (Premiere exit=${r.status})` };
    }
    const parsed = JSON.parse(readFileSync(resultPath, 'utf-8'));
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    if (!parsed.success) return { success: false, output: '', error: parsed.error ?? 'render failed' };
    return { success: true, output: JSON.stringify(parsed), error: '' };
  },
};

registerTool(tool);
export default tool;
