/**
 * Loop Detection Test — Eje B Fase 0
 * Verifica que Shinobi puede detectar cuando intenta la misma estrategia repetidamente sin éxito.
 * Este es un test conceptual, no toca el kernel.
 */

interface AttemptRecord {
  iteration: number;
  strategy: string;
  result: 'success' | 'failure';
  error?: string;
}

class LoopDetector {
  private attempts: AttemptRecord[] = [];
  private maxAttempts = 3;

  recordAttempt(strategy: string, result: 'success' | 'failure', error?: string): {
    shouldPivot: boolean;
    shouldEscalate: boolean;
    reason: string;
  } {
    this.attempts.push({
      iteration: this.attempts.length + 1,
      strategy,
      result,
      error
    });

    if (result === 'success') {
      return { shouldPivot: false, shouldEscalate: false, reason: 'success' };
    }

    const failuresOfSameStrategy = this.attempts.filter(
      a => a.strategy === strategy && a.result === 'failure'
    ).length;

    if (failuresOfSameStrategy >= this.maxAttempts) {
      return {
        shouldPivot: false,
        shouldEscalate: true,
        reason: `Strategy "${strategy}" failed ${failuresOfSameStrategy} times — escalating to human`
      };
    }

    if (failuresOfSameStrategy >= 2) {
      return {
        shouldPivot: true,
        shouldEscalate: false,
        reason: `Strategy "${strategy}" failed ${failuresOfSameStrategy} times — pivoting strategy`
      };
    }

    return {
      shouldPivot: false,
      shouldEscalate: false,
      reason: `Strategy "${strategy}" failed once — retrying`
    };
  }

  getReport() {
    return {
      total_attempts: this.attempts.length,
      failures: this.attempts.filter(a => a.result === 'failure').length,
      successes: this.attempts.filter(a => a.result === 'success').length,
      attempts: this.attempts
    };
  }
}

// Test scenarios
function runTests() {
  console.log('=== LOOP DETECTION TEST — Eje B Fase 0 ===\n');

  console.log('SCENARIO 1: Same strategy fails 3 times → should escalate');
  const detector1 = new LoopDetector();
  const r1a = detector1.recordAttempt('click_button_X', 'failure', 'element not found');
  console.log(`  Attempt 1: shouldPivot=${r1a.shouldPivot}, shouldEscalate=${r1a.shouldEscalate} — ${r1a.reason}`);
  const r1b = detector1.recordAttempt('click_button_X', 'failure', 'element not found');
  console.log(`  Attempt 2: shouldPivot=${r1b.shouldPivot}, shouldEscalate=${r1b.shouldEscalate} — ${r1b.reason}`);
  const r1c = detector1.recordAttempt('click_button_X', 'failure', 'element not found');
  console.log(`  Attempt 3: shouldPivot=${r1c.shouldPivot}, shouldEscalate=${r1c.shouldEscalate} — ${r1c.reason}`);
  console.log(`  Expected: Attempt 3 should escalate. Got: ${r1c.shouldEscalate ? 'PASS' : 'FAIL'}\n`);

  console.log('SCENARIO 2: Strategy fails twice → should pivot');
  const detector2 = new LoopDetector();
  detector2.recordAttempt('search_via_bing', 'failure');
  const r2 = detector2.recordAttempt('search_via_bing', 'failure');
  console.log(`  Attempt 2: shouldPivot=${r2.shouldPivot}, shouldEscalate=${r2.shouldEscalate} — ${r2.reason}`);
  console.log(`  Expected: should pivot. Got: ${r2.shouldPivot ? 'PASS' : 'FAIL'}\n`);

  console.log('SCENARIO 3: Different strategies fail → no escalation yet');
  const detector3 = new LoopDetector();
  detector3.recordAttempt('strategy_A', 'failure');
  detector3.recordAttempt('strategy_B', 'failure');
  const r3 = detector3.recordAttempt('strategy_C', 'failure');
  console.log(`  Attempt 3 (different strategies): shouldPivot=${r3.shouldPivot}, shouldEscalate=${r3.shouldEscalate} — ${r3.reason}`);
  console.log(`  Expected: no escalation, no pivot. Got: ${!r3.shouldEscalate && !r3.shouldPivot ? 'PASS' : 'FAIL'}\n`);

  console.log('SCENARIO 4: Strategy succeeds → no action needed');
  const detector4 = new LoopDetector();
  const r4 = detector4.recordAttempt('quick_lookup', 'success');
  console.log(`  Success: shouldPivot=${r4.shouldPivot}, shouldEscalate=${r4.shouldEscalate} — ${r4.reason}`);
  console.log(`  Expected: success, no action. Got: ${!r4.shouldEscalate && !r4.shouldPivot ? 'PASS' : 'FAIL'}\n`);
}

runTests();
