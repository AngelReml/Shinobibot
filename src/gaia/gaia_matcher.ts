// src/gaia/gaia_matcher.ts
//
// Scorer OFICIAL de GAIA — port fiel y VALIDADO del `question_scorer` del
// repo de referencia (huggingface.co/spaces/gaia-benchmark/leaderboard,
// scorer.py). La normalización de GAIA tiene reglas concretas; reinventarla
// da números falsos, así que esto es un port 1:1 del oficial, fijado con
// tests de paridad en __tests__/gaia_matcher.test.ts.
//
// Reglas del oficial:
//   - is_float(gt)                 → comparación numérica (quita $, %, ,)
//   - gt contiene ',' o ';'        → lista; elemento a elemento (numérico o
//                                     string SIN quitar puntuación)
//   - resto                        → string normalizado (sin espacios,
//                                     lowercase, SIN puntuación) y exacto
//
// Divergencias respecto al oficial (documentadas, fuera del dominio GAIA):
//   - Python float() acepta "inf"/"nan"/"1_000"/"+5"; JS Number() no. Los
//     ground truths de GAIA son números decimales normales → sin impacto.
//   - model_answer === null/undefined se mapea a la cadena "None", igual que
//     el oficial (`if model_answer is None: model_answer = "None"`).

// string.punctuation de Python (32 chars), idéntico:
const PUNCT = `!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`;

/** Equivalente a `is_float` del oficial: ¿float(s) no lanza? */
function isFloat(s: string): boolean {
  if (s === null || s === undefined) return false;
  const t = s.trim();
  if (t === '') return false;
  return Number.isFinite(Number(t));
}

/** normalize_number_str: quita $ % , y parsea float; fallo → Infinity. */
function normalizeNumberStr(numberStr: string): number {
  let s = numberStr;
  for (const ch of ['$', '%', ',']) s = s.split(ch).join('');
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : Infinity;
}

/** split_string: re.split(/[,;]/). */
function splitString(s: string): string[] {
  return s.split(/[,;]/);
}

/** normalize_str: quita \s, lowercase, opcionalmente quita puntuación. */
function normalizeStr(input: string, removePunct = true): string {
  const noSpaces = input.replace(/\s/g, '');
  let out = noSpaces.toLowerCase();
  if (removePunct) {
    for (const ch of PUNCT) out = out.split(ch).join('');
  }
  return out;
}

/**
 * question_scorer oficial: true si `modelAnswer` coincide con `groundTruth`.
 */
export function gaiaScorer(modelAnswer: string | null | undefined, groundTruth: string): boolean {
  // Oficial: `if model_answer is None: model_answer = "None"`.
  const ma = modelAnswer === null || modelAnswer === undefined ? 'None' : String(modelAnswer);
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
        // Oficial: remove_punct=False en elementos de lista.
        if (normalizeStr(maE, false) !== normalizeStr(gtE, false)) return false;
      }
    }
    return true;
  }

  return normalizeStr(ma) === normalizeStr(gt);
}

/**
 * Extrae la respuesta tras "FINAL ANSWER:" (formato del prompt oficial). Si
 * no aparece el marcador, devuelve la última línea no vacía (mejor esfuerzo).
 */
export function extractFinalAnswer(output: string): string {
  const text = (output ?? '').toString();
  const m = text.match(/FINAL ANSWER:\s*(.+?)\s*$/is);
  if (m) return m[1].split('\n')[0].trim();
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

/** Prompt oficial de GAIA (formato FINAL ANSWER), idéntico al paper. */
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
