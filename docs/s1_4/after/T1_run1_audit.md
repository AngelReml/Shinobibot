# Audit: digininja/DVWA@33e364c5

Generated: 2026-05-06T21:47:28.183Z
Source:    https://github.com/digininja/DVWA
Commit:    33e364c556e91473a5e979a4db16ee3b393d05ba
Verdict:   FAIL  (overall_risk = high)

## Purpose
DVWA (Damn Vulnerable Web Application) — a deliberately vulnerable PHP/MySQL web app for security professionals to practice penetration testing and for developers to learn secure coding in a controlled training environment.

## Architecture
DVWA is a PHP/MySQL web application organized around per-vulnerability training modules plus shared infrastructure.

**Top-level layout:**
- `/` — Multilingual READMEs (EN, AR, ES, FR, ZH, KO, PT) and project entry documentation.
- `vulnerabilities/` — Per-module vulnerability exercises (API, cryptography, etc.) with source variants for each DVWA security level (low/medium/high/impossible), dispatched dynamically by level.
- `dvwa/` — Core application support: `includes/dvwaPage.inc.php` (session, auth, page rendering), `includes/Parsedown.php` (Markdown parser), CSS assets, plus root-level `package.json`, `tsconfig.json`, `LICENSE`, `README.md`.
- `database/` — Database-related branch; leaf sub-reports could only confirm root-level config files (`package.json`, `tsconfig.json`, `README.md`, `.gitignore`, `LICENSE`), not actual DB logic.
- `misc/` — pytest-based URL tests (`tests/test_url.py`), configuration template (`config/config.inc.php.dist`), Google reCAPTCHA library, and PDF doc references.
- `.github/` — CI/CD: CodeQL security scanning (JS/Python) and multi-arch Docker image publishing to GHCR, plus bug-report issue templates.

**Runtime flow:** Apache serves PHP; `vulnerabilities/api/.htaccess` rewrites API traffic through `bootstrap.php`; vulnerability pages (e.g., `cryptography/index.php`) include a level-specific source file from `source/`. External dependencies include PHP, MySQL/MariaDB, Apache, Composer, and optional Docker/XAMPP deployments.

## Risks
1. [HIGH] Entire application is intentionally vulnerable by design; deploying outside isolated training environment exposes host and network to exploitation.
2. [HIGH] Default credentials hardcoded: admin/password for app login (root README) and db_user 'dvwa'/db_password 'p@ssw0rd' in misc/config/config.inc.php.dist template.
3. [HIGH] vulnerabilities/ dynamically includes files based on security-level variables; path-traversal risk if level input is tampered with, per sub-report.
4. [HIGH] vulnerabilities/authbypass/change_user_details.php:47 — SQLi: $data->first_name/surname/id concatenated directly into UPDATE query with no escaping or prepared statement
5. [HIGH] login.php:40 — SQLi-adjacent weakness: MD5 password hashing with no salt, trivially cracked via rainbow tables
6. [HIGH] vulnerabilities/api/src/Login.php:10-13 — hardcoded secrets ACCESS_TOKEN_SECRET='12345' and REFRESH_TOKEN_SECRET='98765' used as auth tokens
7. [HIGH] vulnerabilities/api/src/Token.php:11 — hardcoded symmetric key ENCRYPTION_KEY='Paintbrush' compiled into source; compromises all token confidentiality/integrity
8. [HIGH] vulnerabilities/api/src/LoginController.php:79 — hardcoded credentials mrbennett/becareful and client_id/secret 1471.dvwa.digi.ninja/ABigLongSecret using == loose compare (type juggling)
9. [HIGH] vulnerabilities/authbypass/authbypass.js:41-46 — XSS via innerHTML with unescaped user['first_name']/['surname'] from get_user_data.php on non-impossible levels
10. [MEDIUM] database/ branch sub-report could not verify any database-specific logic; only root config files observed — actual responsibility of the branch is unconfirmed (gap).
11. [MEDIUM] dvwa/ sub-report notes root files (package.json, tsconfig.json, README, LICENSE) were not inspected; project setup unverified (gap).
12. [MEDIUM] Potential duplication/conflict: both dvwa/ and database/ sub-reports list root-level package.json, tsconfig.json, README.md, LICENSE as key files — ownership unclear.
13. [MEDIUM] vulnerabilities/ API token endpoints consume raw POST body before content-type validation and lack error handling, logging, or rate limiting.
14. [MEDIUM] dvwa/includes/dvwaPage.inc.php has TODO in messagesPopAllToHtml() indicating incomplete sanitization; depends on externally-defined DVWA_WEB_PAGE_TO_ROOT constant.
15. [MEDIUM] misc/external/recaptcha/recaptchalib.php uses deprecated file_get_contents() for HTTP with no error handling for network failures.
16. [MEDIUM] misc/tests/test_url.py has hardcoded try_count=1 that never retries despite comment claiming 5 attempts, plus TODO for URL-list refactor and dead commented code.
17. [MEDIUM] Ownership of root package.json, tsconfig.json, README.md, LICENSE is ambiguous: both dvwa/ and database/ sub-reports claim them, indicating unclear module boundary at the repo root.
18. [MEDIUM] database/ module has no verified DB logic per sub-report — only Node/TS config files surfaced; the module's stated responsibility does not match observed contents.
19. [MEDIUM] Presence of tsconfig.json / package.json in a PHP/MySQL app signals architectural drift: a JS/TS toolchain exists with no documented role in the runtime flow.
20. [MEDIUM] vulnerabilities/ level-based dynamic include dispatch couples user-controlled level state to filesystem paths; adding a new level or module in 6 months risks path-traversal regressions.
21. [MEDIUM] dvwa/includes/dvwaPage.inc.php depends on externally-defined DVWA_WEB_PAGE_TO_ROOT constant and carries a TODO in messagesPopAllToHtml(); core rendering has implicit global contract.
22. [MEDIUM] vulnerabilities/api/bootstrap.php reads raw POST before content-type validation with no error handling/logging/rate limiting — API periphery lacks the structural guards the per-page modules assume.
23. [LOW] .github CodeQL workflow scans JS and Python with no explicit build step; Autobuild may misbehave for mixed-language DVWA (primarily PHP) setups.
24. [LOW] .github action versions are pinned but no Dependabot/automated update config present; issue templates have no automated field validation.
25. [LOW] Seven README translations in / create ongoing synchronization/maintenance burden; scope of documented vs undocumented vulnerabilities not clearly enumerated.

## Recommendations
1. Refactor vulnerabilities/authbypass/change_user_details.php:47 to use mysqli_prepare with bound parameters for id/first_name/surname (document as intentional DVWA training case if kept vulnerable)
2. Replace hardcoded secrets ACCESS_TOKEN_SECRET/REFRESH_TOKEN_SECRET in vulnerabilities/api/src/Login.php:10-13 and ENCRYPTION_KEY in vulnerabilities/api/src/Token.php:11 with getenv()-based reads and rotate keys
3. Change vulnerabilities/api/src/LoginController.php:79 loose == comparisons to hash_equals() and move credential store out of source into config
4. Refactor vulnerabilities/authbypass/authbypass.js:41-46 to build DOM nodes via createElement/textContent instead of innerHTML concatenation
5. Upgrade login.php:29 password hashing from md5() to password_hash()/password_verify() with bcrypt or argon2id
6. Add a request-validation layer in vulnerabilities/api/bootstrap.php enforcing content-type before body consumption and centralizing error/logging/rate-limiting hooks

## Auditors
- architect          risk=medium
- security_auditor: ERROR (validation failed twice: weaknesses item invalid)
- design_critic: ERROR (validation failed twice: weaknesses item invalid)
- code_reviewer      risk=high
- verdict_confidence: high (votes: [high, high, high])

## Evidence
- repo_report:    audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_report.json
- subreports:     audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_subreports.json
- committee:      audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_committee.json
- telemetry:      audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_telemetry.json
- duration_ms:    278825
- subagent_count: 6
