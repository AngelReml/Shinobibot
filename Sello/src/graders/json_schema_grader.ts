/**
 * src/benchmark/graders/json_schema_grader.ts
 *
 * Grader for tasks that expect structured JSON output.
 * Implements the json_schema grading algorithm from TASK_SCHEMA_v2.md §5.1.
 *
 * Algorithm:
 *   1. TRY parse output as JSON (optionally extract first {...} from prose)
 *      → if parse fails: FORMAT_FAIL
 *   2. COMPARE parsed keys/values against ground_truth.expected using config rules
 *      → if mismatch: CONTENT_FAIL
 *   3. PASS
 */

import type {
    BenchmarkTask,
    GradingResult,
    GraderJsonSchema,
    GroundTruthSchemaMatch,
    GroundTruthExactValue,
} from './types.ts';

// ─── JSON Extraction ────────────────────────────────────────────────────────────

/**
 * Extract the first top-level JSON object from mixed prose+JSON output.
 * Handles nested braces correctly by counting depth.
 */
function extractJsonFromProse(text: string): string | null {
    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        if (depth === 0) return text.slice(start, i + 1);
    }
    return null; // unbalanced braces
}

// ─── Value Comparison ───────────────────────────────────────────────────────────

interface ComparisonConfig {
    strings: 'exact' | 'case_insensitive' | 'contains';
    numbers: { tolerance_abs?: number; tolerance_pct?: number };
    arrays: 'exact_order' | 'set_equal';
}

interface Mismatch {
    path: string;
    expected: unknown;
    actual: unknown;
    reason: string;
}

function compareStrings(expected: string, actual: string, mode: ComparisonConfig['strings']): boolean {
    switch (mode) {
        case 'exact':
            return expected === actual;
        case 'case_insensitive':
            return expected.toLowerCase() === actual.toLowerCase();
        case 'contains':
            return actual.toLowerCase().includes(expected.toLowerCase());
    }
}

function compareNumbers(expected: number, actual: number, tolerance: ComparisonConfig['numbers']): boolean {
    if (tolerance.tolerance_abs !== undefined) {
        if (Math.abs(expected - actual) > tolerance.tolerance_abs) return false;
    }
    if (tolerance.tolerance_pct !== undefined) {
        if (expected === 0) return actual === 0;
        const pctDiff = Math.abs((expected - actual) / expected) * 100;
        if (pctDiff > tolerance.tolerance_pct) return false;
    }
    // If no tolerance specified, require exact match
    if (tolerance.tolerance_abs === undefined && tolerance.tolerance_pct === undefined) {
        return expected === actual;
    }
    return true;
}

function compareArrays(expected: unknown[], actual: unknown[], mode: ComparisonConfig['arrays'], config: ComparisonConfig, path: string): Mismatch[] {
    const mismatches: Mismatch[] = [];

    if (mode === 'set_equal') {
        // Compare as sets — order doesn't matter, but all elements must be present
        if (expected.length !== actual.length) {
            mismatches.push({
                path,
                expected: `array of length ${expected.length}`,
                actual: `array of length ${actual.length}`,
                reason: 'array_length_mismatch',
            });
            return mismatches;
        }
        const actualCopy = [...actual];
        for (const exp of expected) {
            const idx = actualCopy.findIndex(a => deepEqual(exp, a, config));
            if (idx === -1) {
                mismatches.push({
                    path,
                    expected: JSON.stringify(exp),
                    actual: 'not found in array',
                    reason: 'missing_set_element',
                });
            } else {
                actualCopy.splice(idx, 1);
            }
        }
    } else {
        // exact_order — element-by-element comparison
        if (expected.length !== actual.length) {
            mismatches.push({
                path,
                expected: `array of length ${expected.length}`,
                actual: `array of length ${actual.length}`,
                reason: 'array_length_mismatch',
            });
            return mismatches;
        }
        for (let i = 0; i < expected.length; i++) {
            mismatches.push(...compareValues(expected[i], actual[i], config, `${path}[${i}]`));
        }
    }
    return mismatches;
}

/**
 * Quick structural equality check for set comparison.
 */
function deepEqual(a: unknown, b: unknown, config: ComparisonConfig): boolean {
    return compareValues(a, b, config, '').length === 0;
}

/**
 * Recursively compare expected vs actual values, collecting all mismatches.
 */
function compareValues(expected: unknown, actual: unknown, config: ComparisonConfig, path: string): Mismatch[] {
    const mismatches: Mismatch[] = [];

    // null checks
    if (expected === null || expected === undefined) {
        if (actual !== null && actual !== undefined) {
            mismatches.push({ path, expected, actual, reason: 'expected_null_got_value' });
        }
        return mismatches;
    }

    if (actual === null || actual === undefined) {
        mismatches.push({ path, expected, actual, reason: 'expected_value_got_null' });
        return mismatches;
    }

    // Type-specific comparison
    if (typeof expected === 'string') {
        if (typeof actual !== 'string') {
            // Allow numeric strings to match numbers
            if (typeof actual === 'number') {
                if (!compareStrings(expected, String(actual), config.strings)) {
                    mismatches.push({ path, expected, actual, reason: 'string_mismatch_against_number' });
                }
            } else {
                mismatches.push({ path, expected, actual, reason: 'type_mismatch_expected_string' });
            }
        } else if (!compareStrings(expected, actual, config.strings)) {
            mismatches.push({ path, expected, actual, reason: 'string_mismatch' });
        }
        return mismatches;
    }

    if (typeof expected === 'number') {
        if (typeof actual !== 'number') {
            // Try to parse string as number
            if (typeof actual === 'string') {
                const parsed = Number(actual);
                if (isNaN(parsed)) {
                    mismatches.push({ path, expected, actual, reason: 'type_mismatch_expected_number' });
                } else if (!compareNumbers(expected, parsed, config.numbers)) {
                    mismatches.push({ path, expected, actual: parsed, reason: 'numeric_mismatch' });
                }
            } else {
                mismatches.push({ path, expected, actual, reason: 'type_mismatch_expected_number' });
            }
        } else if (!compareNumbers(expected, actual, config.numbers)) {
            mismatches.push({ path, expected, actual, reason: 'numeric_mismatch' });
        }
        return mismatches;
    }

    if (typeof expected === 'boolean') {
        if (actual !== expected) {
            mismatches.push({ path, expected, actual, reason: 'boolean_mismatch' });
        }
        return mismatches;
    }

    if (Array.isArray(expected)) {
        if (!Array.isArray(actual)) {
            mismatches.push({ path, expected: 'array', actual: typeof actual, reason: 'type_mismatch_expected_array' });
        } else {
            mismatches.push(...compareArrays(expected, actual, config.arrays, config, path));
        }
        return mismatches;
    }

    if (typeof expected === 'object') {
        if (typeof actual !== 'object' || Array.isArray(actual)) {
            mismatches.push({ path, expected: 'object', actual: typeof actual, reason: 'type_mismatch_expected_object' });
            return mismatches;
        }

        const expObj = expected as Record<string, unknown>;
        const actObj = actual as Record<string, unknown>;

        // Check all expected keys exist and match
        for (const key of Object.keys(expObj)) {
            if (!(key in actObj)) {
                mismatches.push({
                    path: path ? `${path}.${key}` : key,
                    expected: expObj[key],
                    actual: undefined,
                    reason: 'missing_key',
                });
            } else {
                mismatches.push(...compareValues(expObj[key], actObj[key], config, path ? `${path}.${key}` : key));
            }
        }
        return mismatches;
    }

    // Fallback: strict equality
    if (expected !== actual) {
        mismatches.push({ path, expected, actual, reason: 'value_mismatch' });
    }
    return mismatches;
}

// ─── Key Validation ─────────────────────────────────────────────────────────────

function checkExtraKeys(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
    strict: boolean,
    path: string = ''
): string[] {
    if (!strict) return [];

    const extras: string[] = [];
    for (const key of Object.keys(actual)) {
        const fullPath = path ? `${path}.${key}` : key;
        if (!(key in expected)) {
            extras.push(fullPath);
        } else if (
            typeof expected[key] === 'object' && expected[key] !== null && !Array.isArray(expected[key]) &&
            typeof actual[key] === 'object' && actual[key] !== null && !Array.isArray(actual[key])
        ) {
            extras.push(...checkExtraKeys(
                expected[key] as Record<string, unknown>,
                actual[key] as Record<string, unknown>,
                strict,
                fullPath
            ));
        }
    }
    return extras;
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Grade a model's output against a BenchmarkTask using the json_schema grader.
 *
 * @param output  Raw string output from the model.
 * @param task    BenchmarkTask with grader.kind === 'json_schema'.
 * @returns       GradingResult with verdict and details.
 */
export function grade(output: string, task: BenchmarkTask): GradingResult {
    const start = performance.now();
    const grader = task.grader as GraderJsonSchema;
    const config = grader.config;
    const groundTruth = task.ground_truth as GroundTruthSchemaMatch | GroundTruthExactValue;

    const result: GradingResult = {
        task_id: task.id,
        verdict: 'ERROR',
        details: '',
        grader_kind: 'json_schema',
        duration_ms: 0,
    };

    try {
        // ── Step 1: Parse JSON ───────────────────────────────────────────────
        let jsonText = output.trim();
        
        // 1.1 Robust Markdown Extraction (Fix for prosa + block)
        // Resolves the case where the model outputs explanation and then a code block.
        const fenceRegex = /```(?:json|javascript|js)?\s*\n?([\s\S]*?)\n?```/gi;
        const matches = Array.from(jsonText.matchAll(fenceRegex));
        
        let extractedFromFences = false;
        if (matches.length > 0) {
            // Strategy: Try the first block, then the last one if the first fails.
            // TODO: consider iterating all blocks in future iteration
            const blockCandidates = [
                matches[0][1].trim(),
                matches[matches.length - 1][1].trim()
            ];

            for (const candidate of blockCandidates) {
                try {
                    JSON.parse(candidate);
                    jsonText = candidate;
                    extractedFromFences = true;
                    break; 
                } catch {
                    // Continue to next candidate or fallback
                }
            }
        }

        // 1.2 Legacy fence stripping (fallback for simple start/end cases without prose)
        if (!extractedFromFences && jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
        }

        // 1.3 Prose extraction fallback (only if not extracted from markdown blocks)
        if (!extractedFromFences && config.extract_json_from_prose) {
            const extracted = extractJsonFromProse(jsonText);
            if (extracted === null) {
                result.verdict = 'FORMAT_FAIL';
                result.details = 'No JSON object found in output. Expected at least one {...} block.';
                result.duration_ms = performance.now() - start;
                return result;
            }
            jsonText = extracted;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(jsonText);
        } catch (parseErr: any) {
            result.verdict = 'FORMAT_FAIL';
            result.details = `JSON parse failed: ${parseErr.message}. First 200 chars of input: "${jsonText.slice(0, 200)}"`;
            result.duration_ms = performance.now() - start;
            return result;
        }

        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            result.verdict = 'FORMAT_FAIL';
            result.details = `Expected JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}.`;
            result.duration_ms = performance.now() - start;
            return result;
        }

        const parsedObj = parsed as Record<string, unknown>;
        const expectedObj = groundTruth.expected as Record<string, unknown>;

        // ── Step 2: Check for extra keys (if strict) ─────────────────────────
        if (config.strict) {
            const extras = checkExtraKeys(expectedObj, parsedObj, true);
            if (extras.length > 0) {
                result.verdict = 'FORMAT_FAIL';
                result.details = `Strict mode: unexpected keys found: [${extras.join(', ')}].`;
                result.raw_grader_output = { extra_keys: extras, parsed: parsedObj };
                result.duration_ms = performance.now() - start;
                return result;
            }
        }

        // ── Step 3: Check key presence ───────────────────────────────────────
        if (config.key_comparison === 'exact') {
            const expectedKeys = Object.keys(expectedObj).sort();
            const actualKeys = Object.keys(parsedObj).sort();
            const missingKeys = expectedKeys.filter(k => !actualKeys.includes(k));
            if (missingKeys.length > 0) {
                result.verdict = 'FORMAT_FAIL';
                result.details = `Missing required keys: [${missingKeys.join(', ')}].`;
                result.raw_grader_output = { missing_keys: missingKeys, parsed: parsedObj };
                result.duration_ms = performance.now() - start;
                return result;
            }
        }

        // ── Step 4: Compare values ───────────────────────────────────────────
        const mismatches = compareValues(expectedObj, parsedObj, config.value_comparison, '');

        if (mismatches.length > 0) {
            result.verdict = 'CONTENT_FAIL';
            result.details = `${mismatches.length} value mismatch(es): ${mismatches.map(m => `[${m.path}] expected=${JSON.stringify(m.expected)}, got=${JSON.stringify(m.actual)} (${m.reason})`).join('; ')}`;
            result.raw_grader_output = { mismatches, parsed: parsedObj };
            result.duration_ms = performance.now() - start;
            return result;
        }

        // ── Step 5: PASS ─────────────────────────────────────────────────────
        result.verdict = 'PASS';
        result.details = `All keys and values match. Parsed ${Object.keys(parsedObj).length} keys.`;
        result.raw_grader_output = { parsed: parsedObj };

    } catch (err: any) {
        result.verdict = 'ERROR';
        result.details = `Grader internal error: ${err.message}`;
    }

    result.duration_ms = performance.now() - start;
    return result;
}
