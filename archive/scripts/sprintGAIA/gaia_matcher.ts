/**
 * Matcher oficial de GAIA — port fiel del `question_scorer` del paper /
 * repo de GAIA (gaia-benchmark).
 *
 * Reglas:
 *   - Si el ground truth es un número → comparación numérica tras quitar
 *     $, %, comas.
 *   - Si contiene `,` o `;` → lista; se comparan los elementos uno a uno
 *     (numérico o string normalizado según el elemento).
 *   - Si es string → se normaliza (sin espacios, lowercase, sin
 *     puntuación) y se compara exacto.
 */

const PUNCT = `!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`;

function isFloat(s: string): boolean {
  if (s === null || s === undefined) return false;
  const t = s.trim();
  if (t === '') return false;
  return Number.isFinite(Number(t));
}

function normalizeNumberStr(numberStr: string): number {
  let s = numberStr;
  for (const ch of ['$', '%', ',']) s = s.split(ch).join('');
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : Infinity;
}

function splitString(s: string): string[] {
  return s.split(/[,;]/);
}

function normalizeStr(input: string, removePunct = true): string {
  const noSpaces = input.replace(/\s/g, '');
  let out = noSpaces.toLowerCase();
  if (removePunct) {
    for (const ch of PUNCT) out = out.split(ch).join('');
  }
  return out;
}

/**
 * Devuelve true si `modelAnswer` coincide con `groundTruth` según las
 * reglas oficiales de GAIA.
 */
export function gaiaScorer(modelAnswer: string, groundTruth: string): boolean {
  const ma = (modelAnswer ?? '').toString();
  const gt = (groundTruth ?? '').toString();

  if (isFloat(gt)) {
    return normalizeNumberStr(ma) === Number(gt.trim());
  }

  if (gt.includes(',') || gt.includes(';')) {
    const gtElems = splitString(gt);
    const maElems = splitString(ma);
    if (gtElems.length !== maElems.length) return false;
    for (let i = 0; i < gtElems.length; i++) {
      const gtE = gtElems[i].trim();
      const maE = maElems[i].trim();
      if (isFloat(gtE)) {
        if (normalizeNumberStr(maE) !== Number(gtE)) return false;
      } else {
        if (normalizeStr(maE, false) !== normalizeStr(gtE, false)) return false;
      }
    }
    return true;
  }

  return normalizeStr(ma) === normalizeStr(gt);
}

/**
 * Extrae la respuesta final tras "FINAL ANSWER:" (formato del prompt
 * oficial GAIA). Si no aparece el marcador, devuelve la última línea no
 * vacía como mejor esfuerzo.
 */
export function extractFinalAnswer(output: string): string {
  const text = (output ?? '').toString();
  const m = text.match(/FINAL ANSWER:\s*(.+?)\s*$/is);
  if (m) {
    // Toma la primera línea tras el marcador (la respuesta).
    return m[1].split('\n')[0].trim();
  }
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

/** Prompt-wrapper oficial de GAIA. */
export const GAIA_SYSTEM_PROMPT =
  'You are a general AI assistant. I will ask you a question. Report your ' +
  'thoughts, and finish your answer with the following template: FINAL ANSWER: ' +
  '[YOUR FINAL ANSWER]. YOUR FINAL ANSWER should be a number OR as few words ' +
  'as possible OR a comma separated list of numbers and/or strings. If you are ' +
  "asked for a number, don't use comma to write your number neither use units " +
  'such as $ or percent sign unless specified otherwise. If you are asked for a ' +
  "string, don't use articles, neither abbreviations (e.g. for cities), and " +
  'write the digits in plain text unless specified otherwise. If you are asked ' +
  'for a comma separated list, apply the above rules depending of whether the ' +
  'element to be put in the list is a number or a string.';
