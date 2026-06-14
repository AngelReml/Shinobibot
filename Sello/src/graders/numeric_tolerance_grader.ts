/**
 * src/benchmark/graders/numeric_tolerance_grader.ts
 *
 * Grader for tasks that expect a specific numeric value in the output.
 * Implements the numeric_tolerance grading algorithm from TASK_SCHEMA_v2.md §5.2.
 *
 * Algorithm:
 *   1. EXTRACT numeric value using configured method (json_key, regex, first_number)
 *      → if extraction fails: FORMAT_FAIL
 *   2. IF unit_required AND unit not found in output: FORMAT_FAIL
 *   3. COMPARE extracted vs expected within tolerance (abs and/or pct)
 *      → if outside tolerance: CONTENT_FAIL
 *   4. PASS
 */

import type {
    BenchmarkTask,
    GradingResult,
    GraderNumericTolerance,
    GroundTruthExactValue,
} from './types.ts';

// ─── Number Extraction ──────────────────────────────────────────────────────────

/**
 * Extract the first JSON object from text and pull a value by key path.
 * Supports dot-notation keys like "result.co2_avoided".
 */
function extractByJsonKey(output: string, key: string): number | null {
    // Find first JSON block in output
    const start = output.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let end = -1;
    for (let i = start; i < output.length; i++) {
        if (output[i] === '{') depth++;
        else if (output[i] === '}') depth--;
        if (depth === 0) { end = i; break; }
    }
    if (end === -1) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(output.slice(start, end + 1));
    } catch {
        return null;
    }

    // Navigate dot-notation key path
    const parts = key.split('.');
    let current: unknown = parsed;
    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') return null;
        current = (current as Record<string, unknown>)[part];
    }

    if (typeof current === 'number') return current;
    if (typeof current === 'string') {
        const num = Number(current);
        return isNaN(num) ? null : num;
    }
    return null;
}

/**
 * Extract a number using a regex pattern. The first capture group must contain the number.
 */
function extractByRegex(output: string, pattern: string): number | null {
    const match = output.match(new RegExp(pattern));
    if (!match) return null;

    // Use first capture group if available, otherwise full match
    const raw = match[1] ?? match[0];
    // Strip thousands separators (comma or dot used as thousands sep)
    // Handle both "1,250.5" and "1.250,5" formats
    let cleaned = raw.trim();

    // If the string contains both comma and dot, determine which is the decimal separator
    const hasComma = cleaned.includes(',');
    const hasDot = cleaned.includes('.');
    if (hasComma && hasDot) {
        // "1,250.5" → comma is thousands, dot is decimal
        // "1.250,5" → dot is thousands, comma is decimal
        const lastComma = cleaned.lastIndexOf(',');
        const lastDot = cleaned.lastIndexOf('.');
        if (lastComma > lastDot) {
            // European format: 1.250,5
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        } else {
            // US format: 1,250.5
            cleaned = cleaned.replace(/,/g, '');
        }
    } else if (hasComma) {
        // Could be thousands ("1,250") or decimal ("3,14")
        // Heuristic: if exactly 3 digits after comma, it's thousands
        const afterComma = cleaned.split(',')[1];
        if (afterComma && afterComma.length === 3) {
            cleaned = cleaned.replace(/,/g, '');
        } else {
            cleaned = cleaned.replace(',', '.');
        }
    }

    const num = Number(cleaned);
    return isNaN(num) ? null : num;
}

/**
 * Extract the first number-like token from the output.
 * Matches integers, decimals, negative numbers, and numbers with thousands separators.
 */
function extractFirstNumber(output: string): number | null {
    // Match patterns like: 189, 189.5, -42, 1,250, 1,250.50, 0.722
    const match = output.match(/-?[\d,]+\.?\d*/);
    if (!match) return null;

    let raw = match[0];
    // Strip thousands separators
    raw = raw.replace(/,/g, '');

    const num = Number(raw);
    return isNaN(num) ? null : num;
}

// ─── Unit Detection ─────────────────────────────────────────────────────────────

/**
 * Check if the unit string appears in the output, case-insensitive.
 * Handles common variations (e.g., "tonnes" matches "toneladas", "tCO2", etc.)
 */
function unitPresent(output: string, unit: string): boolean {
    const lower = output.toLowerCase();
    const unitLower = unit.toLowerCase();

    // Direct match
    if (lower.includes(unitLower)) return true;

    // Common unit aliases
    const aliases: Record<string, string[]> = {
        'tonnes': ['toneladas', 'tons', 'tco2', 'tco₂', 't co2', 't co₂', 'metric tons'],
        'kwh': ['kilowatt-hour', 'kilowatt hour', 'kw·h', 'kw-h'],
        'mwh': ['megawatt-hour', 'megawatt hour', 'mw·h', 'mw-h'],
        'bar': ['bares', 'bars'],
        '°c': ['grados', 'celsius', '°c', 'degrees c'],
        'kg': ['kilogram', 'kilogramo', 'kilograms', 'kilogramos'],
        'usd': ['$', 'dollars', 'dólares'],
        '%': ['percent', 'porcentaje', 'porciento', 'por ciento'],
    };

    for (const [canonical, alts] of Object.entries(aliases)) {
        if (unitLower === canonical || alts.includes(unitLower)) {
            // Check if output contains the canonical form or any alias
            if (lower.includes(canonical)) return true;
            for (const alt of alts) {
                if (lower.includes(alt)) return true;
            }
        }
    }

    return false;
}

// ─── Expected Value Extraction ──────────────────────────────────────────────────

/**
 * Get the expected numeric value from ground truth.
 * For exact_value type, the expected object should have a single numeric key,
 * or the grader config's target_key should point to it.
 */
function getExpectedValue(expected: Record<string, unknown>, targetKey?: string): number | null {
    if (targetKey) {
        const parts = targetKey.split('.');
        let current: unknown = expected;
        for (const part of parts) {
            if (current === null || current === undefined || typeof current !== 'object') return null;
            current = (current as Record<string, unknown>)[part];
        }
        if (typeof current === 'number') return current;
        return null;
    }

    // Find first numeric value in expected
    for (const value of Object.values(expected)) {
        if (typeof value === 'number') return value;
    }
    return null;
}

// ─── Tolerance Check ────────────────────────────────────────────────────────────

interface ToleranceResult {
    within: boolean;
    diff_abs: number;
    diff_pct: number | null;
}

function checkTolerance(
    expected: number,
    actual: number,
    toleranceAbs?: number,
    tolerancePct?: number
): ToleranceResult {
    const diffAbs = Math.abs(expected - actual);
    const diffPct = expected !== 0 ? Math.abs((expected - actual) / expected) * 100 : (actual === 0 ? 0 : Infinity);

    let within = true;

    if (toleranceAbs !== undefined) {
        if (diffAbs > toleranceAbs) within = false;
    }

    if (tolerancePct !== undefined) {
        if (diffPct > tolerancePct) within = false;
    }

    // If no tolerance specified at all, require exact match
    if (toleranceAbs === undefined && tolerancePct === undefined) {
        within = expected === actual;
    }

    return { within, diff_abs: diffAbs, diff_pct: expected !== 0 ? diffPct : null };
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Grade a model's output against a BenchmarkTask using the numeric_tolerance grader.
 *
 * @param output  Raw string output from the model.
 * @param task    BenchmarkTask with grader.kind === 'numeric_tolerance'.
 * @returns       GradingResult with verdict and details.
 */
export function grade(output: string, task: BenchmarkTask): GradingResult {
    const start = performance.now();
    const grader = task.grader as GraderNumericTolerance;
    const config = grader.config;
    const groundTruth = task.ground_truth as GroundTruthExactValue;

    const result: GradingResult = {
        task_id: task.id,
        verdict: 'ERROR',
        details: '',
        grader_kind: 'numeric_tolerance',
        duration_ms: 0,
    };

    try {
        // ── Step 1: Extract numeric value ────────────────────────────────────
        let extracted: number | null = null;

        switch (config.extraction_method) {
            case 'json_key':
                if (!config.target_key) {
                    result.verdict = 'ERROR';
                    result.details = 'Grader config error: extraction_method=json_key but target_key is missing.';
                    result.duration_ms = performance.now() - start;
                    return result;
                }
                extracted = extractByJsonKey(output, config.target_key);
                if (extracted === null) {
                    result.verdict = 'FORMAT_FAIL';
                    result.details = `Could not extract numeric value from JSON key "${config.target_key}". No valid JSON object found or key does not exist.`;
                    result.raw_grader_output = { extraction_method: 'json_key', target_key: config.target_key };
                    result.duration_ms = performance.now() - start;
                    return result;
                }
                break;

            case 'regex':
                if (!config.target_regex) {
                    result.verdict = 'ERROR';
                    result.details = 'Grader config error: extraction_method=regex but target_regex is missing.';
                    result.duration_ms = performance.now() - start;
                    return result;
                }
                extracted = extractByRegex(output, config.target_regex);
                if (extracted === null) {
                    result.verdict = 'FORMAT_FAIL';
                    result.details = `Regex "${config.target_regex}" did not match any numeric value in output.`;
                    result.raw_grader_output = { extraction_method: 'regex', target_regex: config.target_regex };
                    result.duration_ms = performance.now() - start;
                    return result;
                }
                break;

            case 'regex_numeric_with_unit':
                // Heuristic: looks for number followed by a unit or space+unit
                // Pattern matches number and captures it, then requires a non-digit character after.
                const defaultPattern = '([-?\\d,\\.]+)\\s*[a-zA-Z%]+';
                extracted = extractByRegex(output, config.target_regex || defaultPattern);
                if (extracted === null) {
                    result.verdict = 'FORMAT_FAIL';
                    result.details = `Could not extract numeric value with unit using pattern: "${config.target_regex || defaultPattern}".`;
                    result.duration_ms = performance.now() - start;
                    return result;
                }
                break;

            case 'first_number':
                extracted = extractFirstNumber(output);
                if (extracted === null) {
                    result.verdict = 'FORMAT_FAIL';
                    result.details = 'No numeric value found anywhere in output.';
                    result.raw_grader_output = { extraction_method: 'first_number' };
                    result.duration_ms = performance.now() - start;
                    return result;
                }
                break;

            case undefined as any: // Handle 'undefined' explicitly for robust error reporting
                result.verdict = 'ERROR';
                result.details = 'Grader config error: extraction_method is undefined.';
                result.duration_ms = performance.now() - start;
                return result;

            default:
                result.verdict = 'ERROR';
                result.details = `Unknown extraction_method: "${config.extraction_method}".`;
                result.duration_ms = performance.now() - start;
                return result;
        }

        // ── Step 2: Check unit presence ──────────────────────────────────────
        if (config.unit_required) {
            if (!unitPresent(output, config.unit_required)) {
                result.verdict = 'FORMAT_FAIL';
                result.details = `Required unit "${config.unit_required}" not found in output. The numeric value ${extracted} was extracted but the unit is missing or unrecognized.`;
                result.raw_grader_output = { extracted, unit_required: config.unit_required };
                result.duration_ms = performance.now() - start;
                return result;
            }
        }

        // ── Step 3: Get expected value ───────────────────────────────────────
        const expectedValue = getExpectedValue(groundTruth.expected, config.target_key);

        if (expectedValue === null) {
            result.verdict = 'ERROR';
            result.details = `Grader config error: could not find expected numeric value in ground_truth.expected.`;
            result.duration_ms = performance.now() - start;
            return result;
        }

        // ── Step 4: Compare within tolerance ─────────────────────────────────
        const tolerance = checkTolerance(
            expectedValue,
            extracted,
            config.tolerance_abs,
            config.tolerance_pct
        );

        if (!tolerance.within) {
            result.verdict = 'CONTENT_FAIL';
            result.details = `Numeric value out of tolerance. Expected: ${expectedValue}, got: ${extracted}. Δabs=${tolerance.diff_abs.toFixed(6)}${tolerance.diff_pct !== null ? `, Δpct=${tolerance.diff_pct.toFixed(2)}%` : ''}.${config.tolerance_abs !== undefined ? ` Max abs tolerance: ${config.tolerance_abs}.` : ''}${config.tolerance_pct !== undefined ? ` Max pct tolerance: ${config.tolerance_pct}%.` : ''}`;
            result.raw_grader_output = {
                expected: expectedValue,
                extracted,
                diff_abs: tolerance.diff_abs,
                diff_pct: tolerance.diff_pct,
            };
            result.duration_ms = performance.now() - start;
            return result;
        }

        // ── Step 5: PASS ─────────────────────────────────────────────────────
        result.verdict = 'PASS';
        result.details = `Numeric value matches. Expected: ${expectedValue}, got: ${extracted}. Δabs=${tolerance.diff_abs.toFixed(6)}${tolerance.diff_pct !== null ? `, Δpct=${tolerance.diff_pct.toFixed(2)}%` : ''}.`;
        result.raw_grader_output = {
            expected: expectedValue,
            extracted,
            diff_abs: tolerance.diff_abs,
            diff_pct: tolerance.diff_pct,
            unit_checked: config.unit_required ?? null,
        };

    } catch (err: any) {
        result.verdict = 'ERROR';
        result.details = `Grader internal error: ${err.message}`;
    }

    result.duration_ms = performance.now() - start;
    return result;
}
