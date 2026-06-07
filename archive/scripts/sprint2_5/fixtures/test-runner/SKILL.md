---
name: test-runner
description: Ejecuta y diagnostica suites de tests; sugiere cobertura faltante.
license: Apache-2.0
---

# Test Runner

Steps:
1. Detect framework (vitest, jest, pytest, mocha).
2. Run with verbose flag.
3. Parse failures into structured list.
4. For each failure suggest minimum reproducer.
5. Identify uncovered modules with low risk of regression.
