/**
 * GOLDEN SET — FASE 0: Promptfoo como juez objetivo de calidad de prompt.
 *
 * Oráculo de cierre de la FASE 0. 12 pares (A,B) con ganador CONOCIDO:
 *   - 6 pares donde B (refinado) supera a A,
 *   - 4 pares donde B es PEOR que A (verifica que Promptfoo no siempre da
 *     ganador al refinado),
 *   - 2 pares de empate (A y B equivalentes).
 *
 * Cada par se evalúa con `evaluatePromptQuality` (que invoca Promptfoo de
 * verdad, modelo Haiku vía OpenRouter, temperatura 0). Aserciones ANCLADAS
 * AL CONTENIDO: miden si el output hace la tarea sobre el input real, no
 * proxies de formato.
 *
 * Rúbrica BINARIA: result.winner === ganador esperado. Cierre = 12/12.
 *
 * Run: npx tsx scripts/audit_validation/fase0_promptfoo_golden.ts
 */
import { config } from 'dotenv';
config();
import { evaluatePromptQuality, type EvalCase } from '../../src/evaluation/prompt_quality.js';

let pass = 0, fail = 0;
function check(id: string, name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[PASS] ${id} — ${name} :: ${detail}`); }
  else { fail++; console.log(`[FAIL] ${id} — ${name} :: ${detail}`); }
}

// Aserciones reutilizables (ancladas al contenido / formato verificable).
const sentimentOneWord = {
  type: 'javascript',
  value: 'output.trim().split(/\\s+/).length <= 2 && /(positivo|negativo|neutral)/i.test(output)',
};
const isWholeEmail = {
  type: 'javascript',
  value: '/^[\\w.+-]+@[\\w-]+\\.[\\w.-]+$/.test(output.trim())',
};
const isShort = (n: number) => ({ type: 'javascript', value: `output.trim().length < ${n}` });
// Nota: NO se usa \b tras la alternativa — "í" (U+00ED) no es un carácter de
// palabra ASCII en el regex de JS, así que \b fallaría tras "sí". Se usa
// (\W|$): un no-carácter-de-palabra o fin de cadena.
const yesNoOneWord = {
  type: 'javascript',
  value: 'output.trim().split(/\\s+/).length <= 2 && /^(s[ií]|no|yes)(\\W|$)/i.test(output.trim())',
};
const isUserJson = {
  type: 'javascript',
  value: '(()=>{try{const m=output.replace(/```json|```/g,"").trim();const o=JSON.parse(m);' +
    'return typeof o.nombre==="string"&&typeof o.edad==="number";}catch{return false;}})()',
};

interface Pair {
  id: string; label: string; A: string; B: string; cases: EvalCase[]; expect: 'A' | 'B' | 'tie';
}

const PAIRS: Pair[] = [
  // ───────── B (refinado) supera a A ─────────
  {
    id: 'F0-01', label: 'B gana — A no incluye el texto a resumir', expect: 'B',
    A: 'Haz un buen resumen.',
    B: 'Resume el siguiente texto en 3 viñetas concisas.\n<texto>{input}</texto>',
    cases: [
      { vars: { input: 'La fotosíntesis convierte la luz solar en energía química en los cloroplastos y libera oxígeno.' },
        assert: [{ type: 'icontains', value: 'fotos' }] },
      { vars: { input: 'El protocolo TCP establece la conexión mediante un handshake de tres vías antes de transmitir.' },
        assert: [{ type: 'icontains', value: 'handshake' }] },
    ],
  },
  {
    id: 'F0-02', label: 'B gana — A no incluye la reseña a clasificar', expect: 'B',
    A: 'Clasifica el sentimiento.',
    B: 'Clasifica el sentimiento de la reseña. Responde con UNA palabra: positivo, negativo o neutral.\n<reseña>{input}</reseña>',
    cases: [
      { vars: { input: 'El producto llegó roto y el soporte nunca respondió. Una experiencia pésima.' },
        assert: [sentimentOneWord] },
      { vars: { input: 'Me encanta, funciona perfecto y el envío fue rapidísimo. Totalmente recomendado.' },
        assert: [sentimentOneWord] },
    ],
  },
  {
    id: 'F0-03', label: 'B gana — A no incluye el texto del que extraer el email', expect: 'B',
    A: 'Extrae el email.',
    B: 'Extrae la dirección de email del texto. Responde SOLO la dirección, nada más.\n<texto>{input}</texto>',
    cases: [
      { vars: { input: 'Para soporte escribe a ayuda@empresa.com en horario laboral.' }, assert: [isWholeEmail] },
      { vars: { input: 'Mi correo personal es juan.perez@mail.org y lo reviso a diario.' }, assert: [isWholeEmail] },
    ],
  },
  {
    id: 'F0-04', label: 'B gana — A no incluye el texto a traducir', expect: 'B',
    A: 'Traduce esto al inglés.',
    B: 'Traduce el siguiente texto al inglés. Devuelve solo la traducción.\n<texto>{input}</texto>',
    cases: [
      { vars: { input: 'El gato duerme en el tejado.' }, assert: [{ type: 'icontains', value: 'cat' }] },
      { vars: { input: 'Mañana lloverá durante toda la tarde.' }, assert: [{ type: 'icontains', value: 'rain' }] },
    ],
  },
  {
    id: 'F0-05', label: 'B gana — A no restringe el formato; B exige una palabra', expect: 'B',
    A: '¿Qué te parece el sentimiento de esta reseña? Analízala a fondo.\n<reseña>{input}</reseña>',
    B: 'Clasifica el sentimiento de la reseña. Responde EXACTAMENTE con una palabra: positivo, negativo o neutral.\n<reseña>{input}</reseña>',
    cases: [
      { vars: { input: 'Pésimo servicio, no vuelvo nunca más.' }, assert: [sentimentOneWord] },
      { vars: { input: 'Excelente atención, todo perfecto.' }, assert: [sentimentOneWord] },
    ],
  },
  {
    id: 'F0-06', label: 'B gana — A no incluye el texto ni pide JSON', expect: 'B',
    A: 'Saca los datos del usuario.',
    B: 'Extrae nombre y edad del texto. Devuelve solo un objeto JSON: {"nombre": string, "edad": number}.\n<texto>{input}</texto>',
    cases: [
      { vars: { input: 'Hola, me llamo Ana López y tengo 34 años.' }, assert: [isUserJson] },
      { vars: { input: 'El cliente Pedro Ruiz, de 28 años, abrió la incidencia.' }, assert: [isUserJson] },
    ],
  },

  // ───────── A (original) es MEJOR — B refinado lo empeora ─────────
  {
    id: 'F0-07', label: 'A gana — B "refinado" induce verbosidad en una clasificación', expect: 'A',
    A: 'Clasifica el sentimiento. Responde con UNA palabra: positivo, negativo o neutral.\n<reseña>{input}</reseña>',
    B: 'Clasifica el sentimiento de la reseña y explica detalladamente, paso a paso y con ejemplos, todo tu razonamiento.\n<reseña>{input}</reseña>',
    cases: [
      { vars: { input: 'El producto es malísimo, una decepción total.' }, assert: [sentimentOneWord] },
      { vars: { input: 'Genial, lo recomiendo a todo el mundo.' }, assert: [sentimentOneWord] },
    ],
  },
  {
    id: 'F0-08', label: 'A gana — B "refinado" pide explicación extensa en una extracción', expect: 'A',
    A: 'Extrae el email. Responde SOLO la dirección, nada más.\n<texto>{input}</texto>',
    B: 'Extrae el email del texto y explícame de forma amistosa y extensa dónde lo encontraste y por qué es ese.\n<texto>{input}</texto>',
    cases: [
      { vars: { input: 'Escríbenos a contacto@web.io para cualquier duda.' }, assert: [isWholeEmail] },
      { vars: { input: 'El responsable es lucia.gomez@dominio.net según el registro.' }, assert: [isWholeEmail] },
    ],
  },
  {
    id: 'F0-09', label: 'A gana — B "refinado" pierde la restricción de longitud', expect: 'A',
    A: 'Resume el texto en máximo 2 frases breves.\n<texto>{input}</texto>',
    B: 'Resume el texto con el máximo detalle posible, sin omitir absolutamente nada, de forma extensa.\n<texto>{input}</texto>',
    cases: [
      { vars: { input: 'La empresa fundada en 1998 fabrica componentes electrónicos, exporta a 40 países, emplea a 2000 personas y abrió una sede nueva en Asia el año pasado.' },
        assert: [isShort(220)] },
      { vars: { input: 'El río nace en la montaña, atraviesa tres regiones, alimenta dos embalses, riega cultivos extensos y desemboca en el mar tras 400 kilómetros.' },
        assert: [isShort(220)] },
    ],
  },
  {
    id: 'F0-10', label: 'A gana — B "refinado" convierte un sí/no en un ensayo', expect: 'A',
    A: 'Responde la pregunta solo con "sí" o "no".\n<pregunta>{input}</pregunta>',
    B: 'Responde la pregunta desarrollando un razonamiento exhaustivo y considerando todos los matices posibles.\n<pregunta>{input}</pregunta>',
    cases: [
      { vars: { input: '¿El agua hierve a 100 grados Celsius a nivel del mar?' }, assert: [yesNoOneWord] },
      { vars: { input: '¿Es el Sol una estrella?' }, assert: [yesNoOneWord] },
    ],
  },

  // ───────── Empate — A y B equivalentes ─────────
  {
    id: 'F0-11', label: 'Empate — dos clasificadores de una palabra equivalentes', expect: 'tie',
    A: 'Clasifica el sentimiento. Responde con una palabra: positivo, negativo o neutral.\n<reseña>{input}</reseña>',
    B: 'Indica el sentimiento de la reseña respondiendo únicamente: positivo, negativo o neutral.\n<reseña>{input}</reseña>',
    cases: [
      { vars: { input: 'Una compra horrible, llegó tarde y dañado.' }, assert: [sentimentOneWord] },
      { vars: { input: 'Servicio impecable, muy satisfecho.' }, assert: [sentimentOneWord] },
    ],
  },
  {
    id: 'F0-12', label: 'Empate — dos extractores de email equivalentes', expect: 'tie',
    A: 'Extrae el email. Responde solo la dirección.\n<texto>{input}</texto>',
    B: 'Devuelve únicamente la dirección de email que aparece en el texto.\n<texto>{input}</texto>',
    cases: [
      { vars: { input: 'Puedes contactarme en hola@correo.com cuando quieras.' }, assert: [isWholeEmail] },
      { vars: { input: 'La factura la envió pagos@tienda.es esta mañana.' }, assert: [isWholeEmail] },
    ],
  },
];

async function main() {
  for (const p of PAIRS) {
    const r = await evaluatePromptQuality(p.A, p.B, p.cases);
    const ok = r.winner === p.expect && !r.error;
    check(p.id, `${p.label} (esperado: ${p.expect})`, ok,
      r.error ? `ERROR: ${r.error}` : r.detail);
  }
  console.log(`\n=== GOLDEN SET FASE 0: ${pass}/${pass + fail} PASS ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
