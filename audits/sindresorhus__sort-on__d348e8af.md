# Audit: sindresorhus/sort-on@d348e8af

Generated: 2026-05-05T23:19:02.898Z
Source:    https://github.com/sindresorhus/sort-on
Commit:    d348e8af857c8ffe2b6efcc5f6d50bdf678810a9
Verdict:   PASS  (overall_risk = medium)

## Purpose
Library to sort an array based on specified properties of its objects.

## Architecture
The repository consists of modules for sorting arrays using object properties and includes GitHub workflows for CI/CD. The main implementation resides in `index.js` and is supported with type definitions in `index.d.ts`. External dependencies such as `dot-prop` and testing tools like `ava` are noted. GitHub workflows are defined in `.github/workflows/main.yml` for automation tasks.

## Risks
1. [MEDIUM] README does not specify version compatibility.
2. [MEDIUM] No tests found for edge cases in sorting.
3. [MEDIUM] No example for using 'options' parameter in API documentation.
4. [MEDIUM] No tests found for edge cases, which reduces confidence in robustness.
5. [MEDIUM] Lack of API usage examples in documentation limits user understanding.
6. [MEDIUM] README does not specify version compatibility, which can lead to integration issues.
7. [MEDIUM] README does not specify version compatibility, which could lead to integration issues.
8. [MEDIUM] No tests are present for edge cases in sorting, potentially leading to unhandled scenarios.
9. [MEDIUM] Lack of documentation examples for the 'options' parameter could lead to misuse of the API.
10. [MEDIUM] External dependency risks are not evaluated; 'dot-prop' should be regularly checked for vulnerabilities.
11. [MEDIUM] The entry point 'index.js' may have vulnerabilities if input validation is not robust.
12. [MEDIUM] Absence of secret handling measures in workflows may lead to accidental exposure of sensitive data.
13. [MEDIUM] The README lacks version compatibility, leading to potential user confusion about dependency management.
14. [MEDIUM] Absence of tests for edge cases in sorting raises concerns about robustness and reliability.
15. [MEDIUM] No examples provided for using the 'options' parameter in API documentation potentially hinders user adoption.

## Recommendations
1. Add tests to cover edge cases in the sorting logic for reliability.
2. Update the README with version compatibility information to guide users.
3. Include usage examples for the 'options' parameter in the API documentation.
4. Ensure type definitions are complete and accurately reflect 'index.js' functionality.
5. Regularly audit external dependencies like 'dot-prop' for known vulnerabilities.
6. Enhance input validation mechanisms in 'index.js' to safeguard against injection attacks.

## Auditors
- architect          risk=medium
- security_auditor   risk=medium
- design_critic      risk=medium

## Evidence
- repo_report:    audits/.machine/d348e8af857c8ffe2b6efcc5f6d50bdf678810a9_report.json
- subreports:     audits/.machine/d348e8af857c8ffe2b6efcc5f6d50bdf678810a9_subreports.json
- committee:      audits/.machine/d348e8af857c8ffe2b6efcc5f6d50bdf678810a9_committee.json
- telemetry:      audits/.machine/d348e8af857c8ffe2b6efcc5f6d50bdf678810a9_telemetry.json
- duration_ms:    16422
- subagent_count: 2
