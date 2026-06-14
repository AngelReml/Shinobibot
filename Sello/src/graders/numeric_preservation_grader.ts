/**
 * src/benchmark/graders/numeric_preservation_grader.ts
 * 
 * Grader for compression tasks that must preserve multiple numeric values
 * with their associated units, while respecting word limits and preamble constraints.
 * 
 * Strategy D2 v3: Semantic keyword validation with context windows.
 */

import type {
    BenchmarkTask,
    GradingResult,
    GraderNumericPreservation,
} from './types.ts';

/**
 * Escapes special characters in a string for use in a regular expression.
 */
function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts unicode subscripts (₀-₉) to regular digits.
 */
function normalizeSubscripts(s: string): string {
    return s
        .replace(/₀/g, '0')
        .replace(/₁/g, '1')
        .replace(/₂/g, '2')
        .replace(/₃/g, '3')
        .replace(/₄/g, '4')
        .replace(/₅/g, '5')
        .replace(/₆/g, '6')
        .replace(/₇/g, '7')
        .replace(/₈/g, '8')
        .replace(/₉/g, '9');
}

/**
 * Normalizes industrial numbers: "91.000", "91,000", "91000" -> 91000
 * Handles dot or comma as thousands separator if it looks like one.
 */
function parseIndustrialNumber(str: string): number {
    let clean = str.replace(/\s/g, '');
    
    // Format mixed: 1,250.50 -> strip comma
    if (clean.includes('.') && clean.includes(',')) {
        return parseFloat(clean.replace(/,/g, ''));
    }
    
    // Heuristic: if exactly 3 digits after a dot/comma and no other separators
    // e.g. 91.000 or 91,000
    if (/^[1-9]\d{0,2}[.,]\d{3}$/.test(clean)) {
        return parseFloat(clean.replace(/[.,]/g, ''));
    }
    
    // Default fallback: assume comma is decimal if not matching thousands heuristic above
    return parseFloat(clean.replace(',', '.'));
}

/**
 * D2 v3: Validate a number by looking for keywords in its immediate context.
 * Tolerates linguistical variations by using substrings in a window.
 */
function validateNumberWithContext(
    expectedVal: number, 
    keywords: string[], 
    text: string, 
    tolerance: number
): { found: boolean, detail: string, actualVal: number | null } {
    // Buscar ocurrencias del número en el texto original (sin bajar a lower aún para preservar índices)
    const numRegex = /(\d+(?:[.,]\d+)*)/g;
    let match;
    let bestMatch: number | null = null;

    numRegex.lastIndex = 0;
    while ((match = numRegex.exec(text)) !== null) {
        const rawValStr = match[1];
        const val = parseIndustrialNumber(rawValStr);
        if (isNaN(val)) continue;

        const diff = Math.abs(val - expectedVal);
        if (diff <= tolerance) {
            // Candidato encontrado por valor. Validar contexto.
            const startIdx = match.index;
            const endIdx = match.index + rawValStr.length;
            
            // Ventana: 10 izq, 40 der
            const windowStart = Math.max(0, startIdx - 10);
            const windowEnd = Math.min(text.length, endIdx + 40);
            let window = text.substring(windowStart, windowEnd).toLowerCase();
            
            // Normalizar ventana para matching semántico
            window = normalizeSubscripts(window).replace(/\s+/g, ' ');

            for (const kw of keywords) {
                if (window.includes(kw.toLowerCase())) {
                    return { found: true, detail: '', actualVal: val };
                }
            }
            bestMatch = val; // Valor correcto encontrado pero sin keywords válidas cerca
        }
    }

    if (bestMatch !== null) {
        return { 
            found: false, 
            detail: `${expectedVal} encontrado pero sin ninguna keyword de [${keywords.join(', ')}] en contexto`, 
            actualVal: bestMatch 
        };
    }
    return { found: false, detail: `${expectedVal} no encontrado en el texto`, actualVal: null };
}

export function grade(output: string, task: BenchmarkTask): GradingResult {
    const start = performance.now();
    const grader = task.grader as GraderNumericPreservation;
    const config = grader.config;
    const expected = (task.ground_truth as any).expected;

    const result: GradingResult = {
        task_id: task.id,
        verdict: 'ERROR',
        details: '',
        grader_kind: 'numeric_preservation',
        duration_ms: 0,
    };

    try {
        const normalizedOutput = normalizeSubscripts(output.trim());
        const trimmedOutput = normalizedOutput;
        const lowerOutput = trimmedOutput.toLowerCase();

        // ── Condition A: No Preamble ─────────────────────────────────────────
        if (config.enforce_no_preamble && expected.forbidden_prefixes) {
            for (const prefix of expected.forbidden_prefixes) {
                if (lowerOutput.startsWith(prefix.toLowerCase())) {
                    result.verdict = 'FORMAT_FAIL';
                    result.details = `Contrato de compresión roto: se detectó preámbulo prohibido ("${prefix}").`;
                    result.duration_ms = performance.now() - start;
                    return result;
                }
            }
        }

        // ── Condition B: Word Limit ──────────────────────────────────────────
        const words = trimmedOutput.split(/\s+/).filter(w => w.length > 0);
        const wordCount = words.length;
        if (config.enforce_word_limit && expected.max_words) {
            if (wordCount > expected.max_words) {
                result.verdict = 'CONTENT_FAIL';
                result.details = `Límite de palabras excedido. Máximo: ${expected.max_words}, Actual: ${wordCount}.`;
                result.duration_ms = performance.now() - start;
                return result;
            }
        }

        // ── Condition C: Required Numeric Preservation (D2 v3) ────────────────
        if (config.all_numerics_required && expected.required_numerics) {
            const missing = [];

            for (const req of expected.required_numerics) {
                // Retrocompatibilidad: convertir 'unit' ("mw|megavatio") a 'keywords' ([mw, megavatio])
                let keywords: string[] = req.keywords || [];
                if (keywords.length === 0 && req.unit) {
                    keywords = req.unit.split('|').map((u: string) => u.trim());
                }

                const validation = validateNumberWithContext(
                    req.value,
                    keywords,
                    trimmedOutput,
                    req.tolerance_abs || 0
                );

                if (!validation.found) {
                    missing.push({ 
                        expected: req.value, 
                        labels: keywords.join('/'), 
                        error: validation.detail 
                    });
                }
            }

            if (missing.length > 0) {
                result.verdict = 'CONTENT_FAIL';
                const missingStr = missing.map(m => 
                    `${m.expected} [${m.labels}] -> ${m.error}`
                ).join('; ');
                result.details = `Faltan datos críticos o contexto inválido: ${missingStr}`;
                result.duration_ms = performance.now() - start;
                return result;
            }
        }

        // ── Success ──────────────────────────────────────────────────────────
        result.verdict = 'PASS';
        result.details = `Preservación correcta (${expected.required_numerics?.length || 0} números). Palabras: ${wordCount}/${expected.max_words || 'N/A'}.`;

    } catch (err: any) {
        result.verdict = 'ERROR';
        result.details = `Grader internal error: ${err.message}`;
    }

    result.duration_ms = performance.now() - start;
    return result;
}
