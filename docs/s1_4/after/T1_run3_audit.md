# Audit: digininja/DVWA@33e364c5

Generated: 2026-05-06T22:08:41.136Z
Source:    https://github.com/digininja/DVWA
Commit:    33e364c556e91473a5e979a4db16ee3b393d05ba
Verdict:   FAIL  (overall_risk = high)

## Purpose
DVWA (Damn Vulnerable Web Application) — a deliberately vulnerable PHP/MySQL web app for security professionals to practice penetration testing and for developers to learn secure coding in a controlled lab environment.

## Architecture
DVWA is a PHP/MySQL web application packaged with Docker and Apache deployment options. The codebase is organized around intentional vulnerability training modules.

**Core layers:**
- `vulnerabilities/` — Per-topic exercise modules (API, cryptography, auth, injection, XSS, CSRF) with per-security-level source files (low/medium/high/impossible) dynamically included based on configured level.
- `dvwa/` — Shared includes (session/auth/page rendering via `dvwaPage.inc.php`), CSS assets, and bundled third-party libs (Parsedown). Also contains Node/TypeScript tooling config at this path.
- `database/` — Intended database branch; leaf scan only surfaced root metadata files (package.json, tsconfig.json) so internal structure is unverified.
- `misc/` — Pytest-based URL tests, config template (`config.inc.php.dist`), reCAPTCHA integration, and docs.
- `.github/` — CI/CD: CodeQL scanning (JS/Python) and multi-arch Docker image publishing to GHCR; standardized issue templates.
- Root — Multilingual READMEs (EN/AR/ES/FR/ZH/KO/PT) and setup docs.

**Runtime dependencies:** PHP, MySQL/MariaDB, Apache, optionally XAMPP, Docker, Docker Compose, Composer. Configuration is manual via copying `config/config.inc.php.dist`.

## Risks
1. [HIGH] Application is intentionally vulnerable by design; deployment to production or internet-facing hosts would expose exploitable endpoints (per root and vulnerabilities reports).
2. [HIGH] Config template `config.inc.php.dist` ships hardcoded default credentials (db_user 'dvwa', db_password 'p@ssw0rd'); default admin/password is easily guessable.
3. [HIGH] Dynamic file inclusion keyed on security-level input across vulnerability modules risks path traversal if the level parameter is tampered with.
4. [HIGH] vulnerabilities/authbypass/change_user_details.php:46 — SQL injection: $data->first_name/surname/id concatenated directly into UPDATE query with no escaping or parameterization
5. [HIGH] vulnerabilities/api/src/Login.php:10-13 — hardcoded token secrets ('12345','98765') and LoginController.php:73 hardcoded credentials 'mrbennett'/'becareful' plus client secret 'ABigLongSecret'
6. [HIGH] vulnerabilities/api/src/Token.php:8 — hardcoded symmetric encryption key 'Paintbrush' for AES-128-GCM; compromises all issued tokens if source leaks
7. [HIGH] vulnerabilities/authbypass/authbypass.js:40-46 — XSS via innerHTML concatenation of user['first_name']/'surname' from API response into table cells without escaping
8. [HIGH] login.php:40 — $user from POST interpolated into SELECT query; mysqli_real_escape_string is used but md5() at line 27 is cryptographically broken for password hashing
9. [HIGH] vulnerabilities/api/src/LoginController.php:73 and Login.php:35 — use loose == comparison for credentials/secrets enabling type juggling auth bypass vs hash_equals/===
10. [MEDIUM] dvwaPage.inc.php contains intentional session fixation and incomplete message sanitization (TODO 'sharpen!'); depends on external DVWA_WEB_PAGE_TO_ROOT constant.
11. [MEDIUM] database/ branch leaf scan surfaced only root metadata (package.json, tsconfig.json, README); no database source files verified — coverage gap.
12. [MEDIUM] Parsedown.php was only partially read (truncated) during the dvwa leaf scan; full library behavior not analyzed.
13. [MEDIUM] API endpoints (e.g. check_token_high.php) read raw POST bodies before validating CONTENT_TYPE; no centralized validation, rate limiting, or error logging.
14. [MEDIUM] recaptchalib.php uses deprecated file_get_contents() for HTTP requests with no error handling for network failures.
15. [MEDIUM] test_url.py has TODO for incomplete refactor and hardcoded try_count=1 that never retries despite comments claiming 5 attempts.
16. [MEDIUM] CodeQL workflow scans JS and Python but lacks language-specific build config; Autobuild may fail silently.
17. [MEDIUM] Dynamic include based on security-level input across vulnerabilities/* is the core dispatch mechanism but has no central validated resolver; every module reimplements the switch.
18. [MEDIUM] dvwaPage.inc.php depends on an externally-defined DVWA_WEB_PAGE_TO_ROOT constant, inverting the dependency — callers configure the shared include rather than vice versa.
19. [MEDIUM] Node/TypeScript tooling config (package.json, tsconfig.json) lives inside dvwa/ and also appears at database/ root; tooling ownership is split and unclear.
20. [MEDIUM] misc/ is a grab-bag: pytest URL tests, config template, reCAPTCHA lib, and docs share a directory with no cohesion — test infra and runtime lib should not co-reside.
21. [MEDIUM] API bootstrap at vulnerabilities/api/bootstrap.php and endpoints like check_token_high.php have no shared validation layer; each endpoint parses raw POST independently.
22. [MEDIUM] database/ module's internal structure was unverified by the scan; if it contains schema/seed logic, its relationship to vulnerabilities/* setup is undocumented.
23. [MEDIUM] Security-level parameter drives dynamic file inclusion across vulnerabilities/ without clear naming convention — users cannot predict which file will load for 'medium' vs 'high' without reading code.
24. [MEDIUM] dvwaPage.inc.php depends on external DVWA_WEB_PAGE_TO_ROOT constant with no inline documentation; new users cannot understand page rendering without tracing includes.
25. [MEDIUM] config/config.inc.php.dist ships hardcoded credentials (db_user='dvwa', db_password='p@ssw0rd') as defaults — users copy-paste without changing, creating false sense of security.
26. [MEDIUM] API endpoints (check_token_high.php) accept raw POST bodies without CONTENT_TYPE validation or centralized input handling — inconsistent with other modules' patterns.
27. [MEDIUM] test_url.py has hardcoded try_count=1 despite comments claiming 5 retries; naming suggests retry logic that does not exist, misleading maintainers.
28. [MEDIUM] database/ branch metadata (package.json, tsconfig.json) appears in dvwa/ root, mixing Node tooling config with PHP app — unclear if database layer uses Node or is PHP-only.
29. [LOW] GitHub Actions versions are statically pinned with no Dependabot or automated update mechanism configured.
30. [LOW] Seven README translations (EN/AR/ES/FR/ZH/KO/PT) create maintenance burden to keep synchronized.
31. [LOW] Docker publishing workflow triggers only on master branch with no tag-based release separation visible.

## Recommendations
1. Refactor vulnerabilities/authbypass/change_user_details.php:46 to use mysqli prepared statements with bound parameters for first_name, surname, and id (fix SQLi).
2. Replace md5($pass) in login.php:27 with password_hash()/password_verify() and migrate the users table to bcrypt hashes.
3. Escape user-controlled API data in vulnerabilities/authbypass/authbypass.js:40-46 using textContent or createElement instead of innerHTML concatenation (fix XSS).
4. Replace == comparisons in vulnerabilities/api/src/LoginController.php:73 and Login.php:35 with hash_equals() for constant-time secret comparison.
5. Move hardcoded secrets from vulnerabilities/api/src/Login.php:10-13 and Token.php:8 (including the 'Paintbrush' AES key) into environment variables or a gitignored config file; replace defaults in config/config.inc.php.dist with 'CHANGE_ME' placeholders and add a setup script to prompt for values.
6. Extract a single whitelisted security-level resolver in dvwa/includes/ that accepts only {low, medium, high, impossible} and is called by every vulnerabilities/*/index.php instead of per-module switches; document the convention in vulnerabilities/README.md.

## Auditors
- architect          risk=medium
- security_auditor: ERROR (validation failed twice: weaknesses item invalid)
- design_critic      risk=medium
- code_reviewer      risk=high
- verdict_confidence: high (votes: [high, high, high])

## Evidence
- repo_report:    audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_report.json
- subreports:     audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_subreports.json
- committee:      audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_committee.json
- telemetry:      audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_telemetry.json
- duration_ms:    164354
- subagent_count: 6
