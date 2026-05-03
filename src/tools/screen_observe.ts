/**
 * screen_observe (B9): screenshot + Vision LLM description with coordinates.
 *
 * - Captures the primary screen with @nut-tree-fork/nut-js
 * - Sends the PNG to OpenRouter (gemini-2.0-flash) or OpenAI (gpt-4o-mini fallback)
 * - Returns the model's enumeration of UI elements with bounding boxes
 *
 * The screenshot is also saved on disk under ./tmp/ so the orchestrator can reuse it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { describeScreenshot, SCREEN_OBSERVE_SYSTEM_PROMPT } from '../utils/vision_client.js';

async function captureScreenshot(outPath: string): Promise<{ width: number; height: number }> {
  const nut: any = await import('@nut-tree-fork/nut-js');
  const screen = nut.screen;
  const width = await screen.width();
  const height = await screen.height();
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const baseName = path.basename(outPath, path.extname(outPath));
  // nut-js capture expects (fileName, fileFormat, filePath, fileNamePrefix, fileNamePostfix)
  await screen.capture(baseName, nut.FileType.PNG, dir, '', '');
  return { width, height };
}

const screenObserveTool: Tool = {
  name: 'screen_observe',
  description:
    'Take a screenshot of the primary monitor and ask a vision LLM to describe the visible desktop UI, ' +
    'enumerating clickable elements with estimated bounding boxes (x_min,y_min,x_max,y_max) in pixels. ' +
    'Use this BEFORE every screen_act call so the action loop is grounded in the real on-screen state.',
  parameters: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description:
          'What you are trying to find or do on screen (e.g. "locate the Notepad text area" or "find the Save button"). ' +
          'The vision model will focus on this goal.',
      },
      save_path: {
        type: 'string',
        description: 'Optional: where to save the screenshot. Defaults to ./tmp/screen_<timestamp>.png',
      },
    },
    required: ['goal'],
  },

  async execute(args: { goal: string; save_path?: string }): Promise<ToolResult> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = args.save_path
      ? path.resolve(args.save_path)
      : path.resolve(process.cwd(), 'tmp', `screen_${ts}.png`);

    let dims: { width: number; height: number };
    try {
      dims = await captureScreenshot(outPath);
    } catch (e: any) {
      return { success: false, output: '', error: `Screenshot capture failed (nut.js): ${e.message}` };
    }

    if (!fs.existsSync(outPath)) {
      return { success: false, output: '', error: `Screenshot file was not created at ${outPath}` };
    }

    const prompt = `${SCREEN_OBSERVE_SYSTEM_PROMPT}\n\nUser goal: ${args.goal}\nScreen size: ${dims.width}x${dims.height} pixels.`;
    const vision = await describeScreenshot({ imagePath: outPath, prompt });

    if (!vision.success) {
      return {
        success: false,
        output: `Screenshot saved at ${outPath} but vision description failed: ${vision.error}`,
        error: vision.error,
      };
    }

    const out = [
      `Screenshot: ${outPath}`,
      `Size: ${dims.width}x${dims.height}`,
      `Vision provider: ${vision.provider} (${vision.model})`,
      '--- description ---',
      vision.output,
    ].join('\n');

    return { success: true, output: out };
  },
};

registerTool(screenObserveTool);
export default screenObserveTool;
