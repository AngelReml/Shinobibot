# Audit: digininja/DVWA@33e364c5

Generated: 2026-05-06T21:58:42.597Z
Source:    https://github.com/digininja/DVWA
Commit:    33e364c556e91473a5e979a4db16ee3b393d05ba
Verdict:   FAIL  (overall_risk = high)

## Purpose
DVWA (Damn Vulnerable Web Application) is a deliberately vulnerable PHP/MySQL web app for security professionals to practice penetration testing and for developers to learn secure coding via tiered security-level exercises.

## Architecture
DVWA is a PHP/MySQL web application organized around per-category vulnerability demonstration modules. The `vulnerabilities/` tree hosts training modules (API, cryptography, auth, injection, XSS, CSRF) with low/medium/high/impossible difficulty tiers, dispatched dynamically based on a configured security level. The `dvwa/` folder provides the shared runtime: `includes/dvwaPage.inc.php` handles sessions, authentication, and page rendering, while `includes/Parsedown.php` provides Markdown parsing, and `css/` holds styling. Configuration is bootstrapped from `misc/config/config.inc.php.dist` with DB, reCAPTCHA, and security-level defaults. `misc/` also contains Python-based URL link tests, a reCAPTCHA integration library, and docs. `.github/` supplies CI (CodeQL analysis for JS/Python, multi-arch Docker image publishing to GHCR) plus issue templates. A `database/` folder exists but sub-report inspection only surfaced Node/TS config files, with actual DB code not evident. Multilingual READMEs (en/ar/es/fr/zh/ko/pt) are maintained at the root. External runtime stack: PHP, MySQL/MariaDB, Apache, with Docker/Compose, XAMPP, and Composer supported for deployment.

## Risks
1. [HIGH] Application is intentionally vulnerable by design; deploying to production or internet-facing servers is dangerous and explicitly discouraged.
2. [HIGH] config.inc.php.dist template ships hardcoded default credentials (db_user 'dvwa', db_password 'p@ssw0rd') and admin/password login is easily guessable.
3. [HIGH] Dynamic file inclusion driven by security-level variables across vulnerability modules risks path traversal if the level getter is compromised.
4. [HIGH] vulnerabilities/authbypass/change_user_details.php:46 concatenates $data->first_name, surname, id directly into UPDATE SQL — classic SQL injection via JSON body
5. [HIGH] vulnerabilities/authbypass/change_user_details.php:11 lacks any auth check at low/medium/high levels — authorization bypass allowing any user to modify records
6. [HIGH] vulnerabilities/authbypass/authbypass.js:42-46 injects user['first_name']/surname into innerHTML without escaping — stored XSS via the change_user_details endpoint
7. [HIGH] vulnerabilities/api/src/Token.php:11 hardcodes ENCRYPTION_KEY='Paintbrush' and Login.php:10-13 hardcodes token secrets '12345'/'98765' — trivially guessable crypto secrets
8. [HIGH] vulnerabilities/api/src/LoginController.php:76 hardcodes credentials mrbennett/becareful and client_id/secret '1471.dvwa.digi.ninja'/'ABigLongSecret' using loose == comparison
9. [HIGH] login.php:38 hashes password with unsalted md5() — weak crypto vulnerable to rainbow tables and collision attacks
10. [MEDIUM] 'database/' branch is labeled database but only Node/TS root config files were surfaced; actual DB code/modules not verified — gap in inspection.
11. [MEDIUM] Stack conflict: dvwa/ sub-report reports Node.js/TypeScript package.json and tsconfig.json at root while misc/ and vulnerabilities/ are PHP; relationship unclear.
12. [MEDIUM] dvwa/ root files (package.json, tsconfig.json, README, LICENSE) were not inspectable per sub-report, leaving build/runtime setup unverified.
13. [MEDIUM] API endpoints read raw POST bodies before validating CONTENT_TYPE; no visible rate limiting, request validation, or centralized error handling/logging.
14. [MEDIUM] dvwaPage.inc.php contains intentional weaknesses (session fixation at lower levels) and a TODO in message sanitization; depends on external DVWA_WEB_PAGE_TO_ROOT constant.
15. [MEDIUM] misc/external/recaptchalib.php uses deprecated file_get_contents() for HTTP and lacks error handling for network failures.
16. [MEDIUM] Stack conflict: `dvwa/` sub-report surfaces `package.json`/`tsconfig.json` while `vulnerabilities/` and `misc/` are PHP; ownership and build graph of the Node/TS layer are undefined.
17. [MEDIUM] `database/` module is declared in the tree but sub-report only found Node/TS configs — the module boundary exists in name only, with no verifiable DB schema/migration owner.
18. [MEDIUM] Security-level dispatch in `vulnerabilities/*/index.php` uses dynamic include paths driven by a global getter; any module compromising that getter breaks every other module's isolation.
19. [MEDIUM] `vulnerabilities/api/bootstrap.php` reads raw POST bodies before CONTENT_TYPE validation and lacks centralized error/logging, so each API vuln module re-implements request handling.
20. [MEDIUM] `dvwa/includes/dvwaPage.inc.php` depends on externally-defined `DVWA_WEB_PAGE_TO_ROOT` constant set by callers — inverted control flow makes the include non-portable across new entry points.
21. [MEDIUM] `misc/external/recaptchalib.php` is bundled in-tree rather than via Composer, coupling runtime to a deprecated `file_get_contents()` HTTP path with no upgrade seam.
22. [LOW] misc/tests/test_url.py has TODO for URL list refactoring, dead/commented broken_urls code, and broken retry logic (try_count=1 never retries).
23. [LOW] CodeQL Autobuild may fail for Python since no explicit build step is configured; Docker workflow only publishes from master with no tag/release pipeline.
24. [LOW] Seven README translations (en/ar/es/fr/zh/ko/pt) create synchronization/maintenance burden; scope of documented vs undocumented vulnerabilities not clearly enumerated.

## Recommendations
1. Refactor vulnerabilities/authbypass/change_user_details.php:46 to use mysqli prepared statements with bound parameters for first_name, surname, and id
2. Add dvwaCurrentUser()=='admin' auth check at top of vulnerabilities/authbypass/change_user_details.php matching the pattern in source/impossible.php
3. Change vulnerabilities/authbypass/authbypass.js:42-46 to use textContent or createElement+setAttribute instead of innerHTML with user-controlled data
4. Move ENCRYPTION_KEY in vulnerabilities/api/src/Token.php and ACCESS/REFRESH_TOKEN_SECRET in Login.php to environment variables loaded via getenv() with 32+ byte random values
5. Replace md5($pass) at login.php:38 with password_hash()/password_verify() using PASSWORD_BCRYPT or ARGON2ID
6. Replace loose == comparisons in vulnerabilities/api/src/LoginController.php:76,92 with hash_equals() for constant-time credential comparison

## Auditors
- architect          risk=medium
- security_auditor: ERROR (validation failed twice: weaknesses item invalid)
- design_critic: ERROR (validation failed twice: strengths item invalid)
- code_reviewer      risk=high
- verdict_confidence: high (votes: [high, high, high])

## Evidence
- repo_report:    audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_report.json
- subreports:     audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_subreports.json
- committee:      audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_committee.json
- telemetry:      audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_telemetry.json
- duration_ms:    345439
- subagent_count: 6
