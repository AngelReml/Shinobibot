// desktop-photoshop-resize-export — Node entry. Generates jsx, runs Photoshop with -r.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import { registerTool } from '../../../../src/tools/tool_registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(__dirname, 'resize.jsx');

function findPhotoshopExe() {
  const candidates = [
    'C:/Program Files/Adobe/Adobe Photoshop 2023/Photoshop.exe',
    'C:/Program Files/Adobe/Adobe Photoshop 2024/Photoshop.exe',
    'C:/Program Files/Adobe/Adobe Photoshop 2025/Photoshop.exe',
    'C:/Program Files/Adobe/Adobe Photoshop 2026/Photoshop.exe',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

const tool = {
  name: 'desktop_photoshop_resize_export',
  description: 'Resize an image in Photoshop and export as JPEG. Windows only.',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string' },
      output: { type: 'string' },
      width: { type: 'number' },
      height: { type: 'number' },
      quality: { type: 'number', minimum: 1, maximum: 12, default: 10 },
      keep_aspect: { type: 'boolean', default: true },
    },
    required: ['input', 'output', 'width'],
  },
  async execute(args) {
    if (!args?.input || !args?.output || !args?.width) return { success: false, output: '', error: 'input, output, width required' };
    if (process.platform !== 'win32') return { success: false, output: '', error: 'Windows-only skill' };
    if (!existsSync(args.input)) return { success: false, output: '', error: `input not found: ${args.input}` };
    const exe = findPhotoshopExe();
    if (!exe) return { success: false, output: '', error: 'Photoshop executable not found' };
    if (!existsSync(TEMPLATE)) return { success: false, output: '', error: `template missing: ${TEMPLATE}` };

    const tmp = mkdtempSync(join(os.tmpdir(), 'shinobi-photoshop-'));
    const resultPath = join(tmp, 'result.json');
    const jsxPath = join(tmp, 'resize.jsx');
    const tpl = readFileSync(TEMPLATE, 'utf-8')
      .replace(/__INPUT__/g, args.input.replace(/\\/g, '/'))
      .replace(/__OUTPUT__/g, args.output.replace(/\\/g, '/'))
      .replace(/__WIDTH__/g, String(args.width))
      .replace(/__HEIGHT__/g, args.height ? String(args.height) : '0')
      .replace(/__QUALITY__/g, String(args.quality ?? 10))
      .replace(/__KEEP_ASPECT__/g, (args.keep_aspect ?? true) ? '1' : '0')
      .replace(/__RESULT_PATH__/g, resultPath.replace(/\\/g, '/'));
    writeFileSync(jsxPath, tpl, 'utf-8');

    const r = spawnSync(exe, ['-r', jsxPath], { encoding: 'utf-8', timeout: 5 * 60 * 1000 });
    if (r.error) {
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
      return { success: false, output: '', error: `photoshop spawn error: ${r.error.message}` };
    }
    if (!existsSync(resultPath)) {
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
      return { success: false, output: '', error: `no result file (Photoshop exit=${r.status})` };
    }
    const parsed = JSON.parse(readFileSync(resultPath, 'utf-8'));
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    if (!parsed.success) return { success: false, output: '', error: parsed.error ?? 'resize failed' };
    return { success: true, output: JSON.stringify(parsed), error: '' };
  },
};

registerTool(tool);
export default tool;
