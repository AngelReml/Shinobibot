# Audit: digininja/DVWA@33e364c5

Generated: 2026-05-06T20:16:21.158Z
Source:    https://github.com/digininja/DVWA
Commit:    33e364c556e91473a5e979a4db16ee3b393d05ba
Verdict:   FAIL  (overall_risk = high)

## Purpose
Damn Vulnerable Web Application (DVWA) - an intentionally vulnerable PHP/MySQL web application designed for security training, penetration testing practice, and educational demonstration of common web vulnerabilities.

## Architecture
DVWA is a PHP/MySQL web application packaged with multi-language documentation, Docker support, and CI/CD via GitHub Actions.

**Core structure:**
- **Root**: README files (8 languages), installation guides, Docker Compose setup (port 4280)
- **vulnerabilities/**: Self-contained intentionally-vulnerable modules (SQLi, XSS, CSRF, cryptography, API) routed by user-selected security level (low/medium/high/impossible)
- **dvwa/**: Core scaffolding with shared utilities (`dvwaPage.inc.php` for session/auth/rendering, Parsedown for Markdown), CSS assets
- **database/**: Database tooling and workspace configuration
- **misc/**: Configuration templates (`config.inc.php.dist`), Python test suite (URL validation), Google ReCAPTCHA library, PDF docs
- **.github/**: CodeQL security scanning, multi-arch Docker image builds to GHCR, structured issue templates

**Notable contradiction:** Several sub-reports (dvwa/, database/) describe a Turborepo/TypeScript/Next.js/React workspace stack, which conflicts with the primary identification of DVWA as a pure PHP/MySQL application. This likely indicates incorrect/template `package.json`/`turbo.json`/`tsconfig.json` files or sub-report misclassification rather than an actual JS/TS architecture.

## Risks
1. [HIGH] Entire app is intentionally vulnerable; default credentials (admin/password, db dvwa/p@ssw0rd) and no automated guard against production deployment
2. [HIGH] Variable interpolation in require_once based on user-selected security level in cryptography module risks LFI if validation gaps exist
3. [HIGH] No production deployment safeguards: hardcoded default credentials (admin/password, dvwa/p@ssw0rd) and no environment-based warnings create critical risk if accidentally exposed
4. [HIGH] Variable interpolation in cryptography module's require_once based on user-selected security level risks Local File Inclusion (LFI) if validation gaps exist in level-switching logic
5. [HIGH] check_token_high.php parses raw POST body as JSON without input validation; missing CSRF token validation in cryptography endpoints enables token bypass attacks
6. [HIGH] ReCAPTCHA library uses deprecated file_get_contents() for HTTP requests instead of curl, risking SSL/TLS bypass and stream wrapper attacks
7. [HIGH] Stale/conflicting configuration files (package.json, turbo.json, tsconfig.json in dvwa/ and database/) suggest incomplete cleanup or template remnants that could confuse deployment
8. [HIGH] Session fixation intentionally permitted at lower security levels; unfinished logic ('sharpen!' TODO in messagesPopAllToHtml()) indicates incomplete vulnerability implementation
9. [HIGH] vulnerabilities/authbypass/change_user_details.php:46 — SQL injection via string concatenation of $data->first_name, $data->surname, $data->id into UPDATE query with no escaping/parameterization.
10. [HIGH] vulnerabilities/authbypass/change_user_details.php — missing authorization check at high level; only 'impossible' gates non-admin, enabling auth bypass (documented in help.php as intended).
11. [HIGH] vulnerabilities/api/src/Token.php:10 — hardcoded encryption key 'Paintbrush'; Login.php:9-12 hardcodes ACCESS/REFRESH token secrets '12345'/'98765' — trivial secrets in source.
12. [HIGH] vulnerabilities/api/src/LoginController.php:78 — hardcoded credentials (mrbennett/becareful, client_id 1471.dvwa.digi.ninja/ABigLongSecret); uses == loose comparison enabling type-juggling risks.
13. [HIGH] vulnerabilities/authbypass/authbypass.js:37-44 — XSS via innerHTML concatenation of user['first_name']/user['surname']/user_id from API response with no escaping.
14. [HIGH] login.php:41 — password hashed with unsalted MD5 (md5($pass)) before SQL lookup; weak cryptography for credential storage/comparison.
15. [MEDIUM] Contradiction between sub-reports: dvwa/ and database/ list TypeScript/Turborepo/Next.js/React stack inconsistent with PHP/MySQL nature of DVWA — likely stale or template config files needing review
16. [MEDIUM] check_token_high.php parses raw POST body as JSON without validation; missing CSRF token validation in cryptography endpoints
17. [MEDIUM] Session fixation intentionally permitted at lower security levels; TODO 'sharpen!' comment in messagesPopAllToHtml() indicates unfinished logic
18. [MEDIUM] ReCAPTCHA library uses deprecated file_get_contents() for HTTP requests instead of curl
19. [MEDIUM] Reported TypeScript/Turborepo/Next.js configs in dvwa/ and database/ conflict with the PHP/MySQL reality — indicates architectural noise or misplaced template files.
20. [MEDIUM] Shared dvwaPage.inc.php concentrates session, auth, and rendering concerns, creating a god-module that all vulnerability pages couple to.
21. [MEDIUM] Dynamic require_once based on user-selected level (e.g., cryptography/index.php) is a structural LFI pattern, not just a bug — needs architectural guardrails.
22. [MEDIUM] No apparent routing/controller abstraction; entry points are scattered .php files plus an .htaccess rewrite for the api module, making conventions inconsistent.
23. [MEDIUM] CSRF/token handling lives ad-hoc per module (check_token_high.php parses raw JSON unchecked) rather than via a shared validated middleware.
24. [MEDIUM] Third-party integrations (Parsedown, ReCAPTCHA using file_get_contents) are vendored without a dependency manager (e.g., Composer), complicating upgrades.
25. [LOW] Maintenance burden: 8 language README translations risk drifting out of sync
26. [LOW] Hardcoded GitHub Action versions in CodeQL workflow may become outdated
27. [LOW] test_url.py contains TODO and commented-out code indicating incomplete test logic

## Recommendations
1. Rewrite vulnerabilities/authbypass/change_user_details.php UPDATE to use mysqli prepared statements with bound parameters, and add admin authorization check at the high level.
2. Replace innerHTML assignments in authbypass.js updateTable() with textContent or DOM APIs to prevent stored XSS from DB-sourced fields.
3. Move Token.php ENCRYPTION_KEY and Login.php ACCESS/REFRESH token secrets out of source into environment/config; rotate to cryptographically strong random values.
4. Replace md5() password hashing in login.php with password_hash()/password_verify() (bcrypt/argon2) and migrate existing hashes.
5. Replace == credential comparisons in LoginController.php with hash_equals() constant-time comparison and remove hardcoded user/client credentials.
6. Validate cryptography module's security-level parameter against an explicit whitelist before require_once to eliminate LFI structural risk.

## Auditors
- architect          risk=medium
- security_auditor   risk=high
- design_critic: ERROR (validation failed twice: weaknesses item invalid)
- code_reviewer      risk=high
- verdict_confidence: high (votes: [high, high, high])

## Evidence
- repo_report:    audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_report.json
- subreports:     audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_subreports.json
- committee:      audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_committee.json
- telemetry:      audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_telemetry.json
- duration_ms:    328644
- subagent_count: 6
