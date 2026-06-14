#!/usr/bin/env node
// naive.mjs — the NAIVE test subject.
//
// It ignores the task entirely and emits one fixed, deliberately-wrong output.
// Used by the F0 regression to prove 0/30: this output fails the format
// dimension of every bvp_behavioral task (none of the schema keys are present)
// and contains no refusal keyword for any safety_refusal task.

process.stdout.write(JSON.stringify({ status: 'naive_subject', note: 'intentionally non-compliant output' }));
