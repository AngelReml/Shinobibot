#!/usr/bin/env node
// G1.1 — Classify a GitHub issue into bug | feature | question | docs | other.
//
// Strategy:
//   1. If TRIAGE_LLM_KEY is set, ask an LLM (OpenRouter-compatible) to classify.
//      The prompt is intentionally tiny so this stays under a fraction of a cent.
//   2. Otherwise, fall back to a deterministic keyword heuristic.
//
// Stdin: a JSON object { title, body }.
// Stdout: a JSON object { category, label, suggested_reply }.
// Stderr: diagnostics only — never block the action on classifier failures.
import { stdin } from 'node:process';

const CATS = {
  bug: { label: 'type:bug', keywords: ['error', 'crash', 'fail', 'fails', 'failed', 'bug', 'broken', 'doesn\'t work', 'does not work', 'no funciona', 'no anda', 'regresion', 'regression'] },
  feature: { label: 'type:feature', keywords: ['feature', 'request', 'add', 'support', 'would like', 'me gustaría', 'sería genial', 'wishlist'] },
  question: { label: 'type:question', keywords: ['how', 'how do', '?', 'cómo', 'puedo', 'is it possible', 'help', 'duda'] },
  docs: { label: 'type:docs', keywords: ['doc', 'docs', 'documentation', 'readme', 'typo', 'unclear', 'documenta'] },
  other: { label: 'type:triage', keywords: [] },
};

function heuristic(title, body) {
  const text = `${title}\n${body}`.toLowerCase();
  let best = { cat: 'other', score: 0 };
  for (const [cat, def] of Object.entries(CATS)) {
    const score = def.keywords.reduce((s, kw) => s + (text.includes(kw) ? 1 : 0), 0);
    if (score > best.score) best = { cat, score };
  }
  return best.cat;
}

async function llmClassify(title, body) {
  const key = process.env.TRIAGE_LLM_KEY;
  if (!key) return null;
  const baseUrl = process.env.TRIAGE_LLM_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const model = process.env.TRIAGE_LLM_MODEL ?? 'openai/gpt-4o-mini';
  const prompt = [
    'Classify the following GitHub issue into exactly one category: bug, feature, question, docs, other.',
    'Reply with one lowercase word and nothing else.',
    '',
    `Title: ${title}`,
    'Body:',
    (body ?? '').slice(0, 2000),
  ].join('\n');
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 8,
      }),
    });
    if (!res.ok) {
      console.error(`[triage] LLM HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const out = (data?.choices?.[0]?.message?.content ?? '').trim().toLowerCase();
    const word = out.split(/[^a-z]+/).filter(Boolean)[0] ?? '';
    return CATS[word] ? word : null;
  } catch (e) {
    console.error('[triage] LLM error:', e?.message ?? e);
    return null;
  }
}

function suggestedReply(category, lang) {
  const isEs = lang === 'es';
  const intro = isEs ? '¡Gracias por abrir esta issue!' : 'Thanks for opening this issue!';
  const triage = isEs ? 'Le he asignado el label automáticamente.' : 'A label has been auto-assigned.';
  const timeline = isEs
    ? 'Un humano la revisará en los próximos **2 días hábiles** y responderá con próximos pasos.'
    : 'A human will review it within the next **2 business days** and respond with next steps.';
  const cat = {
    bug: isEs ? 'Suena a **bug**. Si puedes, comparte versión de Shinobi (`shinobi --version`), pasos para reproducir y el log relevante.' : 'Looks like a **bug**. If you can, share Shinobi version (`shinobi --version`), repro steps, and the relevant log lines.',
    feature: isEs ? 'Suena a **feature request**. Cuanto más concreto el caso de uso (qué intentas conseguir, no cómo), más fácil priorizarlo.' : 'Looks like a **feature request**. The more concrete the use case (what you\'re trying to achieve, not how), the easier to prioritize.',
    question: isEs ? 'Suena a **pregunta**. Si crees que la docs falta, dilo y abrimos otro issue tipo `docs`.' : 'Looks like a **question**. If you think the docs are missing this, say so and we\'ll open a `docs` issue.',
    docs: isEs ? 'Suena a problema de **documentación**. ¿Tienes el enlace de la página confusa?' : 'Looks like a **docs** issue. Do you have the link to the confusing page?',
    other: isEs ? 'No tengo claro la categoría — un humano la revisará y reasignará si hace falta.' : 'I am not sure of the category — a human will review and re-tag if needed.',
  }[category] ?? '';
  return [intro, '', cat, '', triage, timeline].join('\n');
}

function detectLang(text) {
  // Cheap heuristic: presence of common Spanish stop words tilts to ES.
  const t = text.toLowerCase();
  const es = ['cómo', 'qué', 'porqué', 'por qué', 'gracias', 'hola', 'función', 'archivo', 'no funciona', 'instalar', 'configuración'].filter((w) => t.includes(w)).length;
  return es >= 2 ? 'es' : 'en';
}

async function main() {
  let input = '';
  for await (const chunk of stdin) input += chunk;
  let payload;
  try { payload = JSON.parse(input); } catch { payload = {}; }
  const title = String(payload.title ?? '');
  const body = String(payload.body ?? '');

  const cat = (await llmClassify(title, body)) ?? heuristic(title, body);
  const lang = detectLang(`${title}\n${body}`);
  const out = {
    category: cat,
    label: CATS[cat]?.label ?? CATS.other.label,
    suggested_reply: suggestedReply(cat, lang),
    classifier: process.env.TRIAGE_LLM_KEY ? 'llm-with-heuristic-fallback' : 'heuristic',
    detected_language: lang,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

main().catch((e) => { console.error('[triage] FATAL', e); process.exit(1); });
