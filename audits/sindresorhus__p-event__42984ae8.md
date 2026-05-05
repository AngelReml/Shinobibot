# Audit: sindresorhus/p-event@42984ae8

Generated: 2026-05-05T23:20:46.291Z
Source:    https://github.com/sindresorhus/p-event
Commit:    42984ae88cd09c88b930e2904f94f9721176edbc
Verdict:   PASS  (overall_risk = medium)

## Purpose
p-event makes handling events easier by promisifying event results, simplifying async operations in Node.js and browsers.

## Architecture
The repository consists primarily of event handling tools that leverage the promisified outcomes of events to enable asynchronous operations in both Node.js environments and web browsers. The primary files include a `package.json` for defining project metadata, dependencies, and scripts, and a `readme.md` for usage instructions and API details. The GitHub workflows are housed in the `.github` directory, utilizing YAML configurations to manage CI/CD pipelines, particularly for Node.js applications.

## Risks
1. [MEDIUM] Possible contradictions between the purpose of the repository ('for Node.js and browsers') and the CI workflow ('only specified Node.js environments').
2. [MEDIUM] Current CI workflows only target Node.js environments, which might miss browser-specific issues.
3. [MEDIUM] Limited evidence of modularization beyond metadata, documentation, and CI configuration.
4. [MEDIUM] CI workflow only tests Node.js environments; risks ignoring browser-specific issues.
5. [MEDIUM] Lack of explicit secret management in the configuration may lead to exposure of sensitive data.
6. [MEDIUM] No automated dependency vulnerability checks are mentioned, increasing risk from outdated packages.
7. [MEDIUM] Absence of input validation mechanisms could lead to command injection or resource manipulation.
8. [MEDIUM] Potential for file system access vulnerabilities if user input is improperly handled in event methods.
9. [MEDIUM] Usage of broad permissions in CI/CD workflows without specific checks increases attack surface.
10. [MEDIUM] Contradiction between supporting both Node.js and browsers while only configuring CI for Node.js.
11. [MEDIUM] Lack of clarity in the naming convention for event handling functions, making them less intuitive.
12. [MEDIUM] Potential for scope creep as the repository mentions broader uses that may not align with its core focus.
13. [MEDIUM] Hidden complexity in promisifying events that could confuse less experienced developers.
14. [MEDIUM] Absence of examples in the documentation for practical application.
15. [MEDIUM] Inadequate explanation of CI/CD workflow in the readme, leading to potential user confusion.

## Recommendations
1. Enhance CI workflows to include browser environment testing to cover cross-environment compatibility.
2. Implement secret management tools to protect sensitive information.
3. Integrate dependency vulnerability scanning tools to mitigate risks.
4. Add input validation and sanitization to prevent vulnerabilities in event handling.
5. Limit file system access and permissions in CI workflows to ensure least privilege access.
6. Regularly review and update dependencies to close any emerging vulnerabilities promptly.

## Auditors
- architect          risk=medium
- security_auditor   risk=medium
- design_critic      risk=medium

## Evidence
- repo_report:    audits/.machine/42984ae88cd09c88b930e2904f94f9721176edbc_report.json
- subreports:     audits/.machine/42984ae88cd09c88b930e2904f94f9721176edbc_subreports.json
- committee:      audits/.machine/42984ae88cd09c88b930e2904f94f9721176edbc_committee.json
- telemetry:      audits/.machine/42984ae88cd09c88b930e2904f94f9721176edbc_telemetry.json
- duration_ms:    19885
- subagent_count: 2
