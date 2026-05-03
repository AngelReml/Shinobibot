/**
 * Vision LLM client (B9).
 * Primary: OpenRouter google/gemini-2.0-flash-001 (low cost).
 * Fallback: OpenAI gpt-4o-mini if OPENROUTER_API_KEY is missing.
 *
 * Returns a textual description of the screenshot, intended to include
 * UI element coordinates (the prompt instructs the model to enumerate them).
 */
import * as fs from 'fs';
import axios from 'axios';

export interface VisionRequest {
  imagePath: string;
  prompt: string;
}

export interface VisionResult {
  success: boolean;
  output: string;
  provider: 'openrouter' | 'openai' | 'none';
  model: string;
  error?: string;
}

function loadImageAsDataUrl(imagePath: string): string {
  const bytes = fs.readFileSync(imagePath);
  const ext = imagePath.toLowerCase().endsWith('.jpg') || imagePath.toLowerCase().endsWith('.jpeg')
    ? 'jpeg'
    : 'png';
  return `data:image/${ext};base64,${bytes.toString('base64')}`;
}

async function callOpenRouter(req: VisionRequest, apiKey: string): Promise<VisionResult> {
  const dataUrl = loadImageAsDataUrl(req.imagePath);
  const model = 'google/gemini-2.0-flash-001';
  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: req.prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  };
  const r = await axios.post('https://openrouter.ai/api/v1/chat/completions', body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://zapweave.com',
      'X-Title': 'Shinobi B9 screen_observe',
    },
    timeout: 60_000,
  });
  const text = r.data?.choices?.[0]?.message?.content || '';
  return { success: true, output: String(text), provider: 'openrouter', model };
}

async function callOpenAIVision(req: VisionRequest, apiKey: string): Promise<VisionResult> {
  const dataUrl = loadImageAsDataUrl(req.imagePath);
  const model = 'gpt-4o-mini';
  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: req.prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  };
  const r = await axios.post('https://api.openai.com/v1/chat/completions', body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 60_000,
  });
  const text = r.data?.choices?.[0]?.message?.content || '';
  return { success: true, output: String(text), provider: 'openai', model };
}

export async function describeScreenshot(req: VisionRequest): Promise<VisionResult> {
  const orKey = process.env.OPENROUTER_API_KEY;
  if (orKey) {
    try { return await callOpenRouter(req, orKey); }
    catch (e: any) {
      if (!process.env.OPENAI_API_KEY) {
        return { success: false, output: '', provider: 'openrouter', model: 'google/gemini-2.0-flash-001', error: `OpenRouter failed: ${e.message}` };
      }
    }
  }
  const oaKey = process.env.OPENAI_API_KEY;
  if (oaKey) {
    try { return await callOpenAIVision(req, oaKey); }
    catch (e: any) {
      return { success: false, output: '', provider: 'openai', model: 'gpt-4o-mini', error: `OpenAI vision failed: ${e.message}` };
    }
  }
  return {
    success: false,
    output: '',
    provider: 'none',
    model: '',
    error: 'No vision provider available. Set OPENROUTER_API_KEY (preferred) or OPENAI_API_KEY.',
  };
}

export const SCREEN_OBSERVE_SYSTEM_PROMPT =
  'You are a UI inspection assistant. Describe the visible desktop UI in the image. ' +
  'Enumerate clickable elements (buttons, menu items, text fields, links, tabs). ' +
  'For each element provide: a short label, an estimated bounding box in image pixel coordinates ' +
  'as (x_min, y_min, x_max, y_max), and a one-line purpose. Also list the active window title ' +
  'if visible. Be concise. Output as a numbered list. Do not invent elements that are not visible.';
