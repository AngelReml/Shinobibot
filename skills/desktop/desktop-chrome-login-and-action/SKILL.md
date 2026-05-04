---
name: desktop-chrome-login-and-action
description: Drives the user's existing Chrome profile via Chrome DevTools Protocol (CDP) — navigate, fill forms, click, screenshot, extract DOM. Use when the user already has sessions/logins they want reused (not for headless cold starts).
license: MIT
compatibility: Requires Google Chrome installed. Spawns Chrome with `--remote-debugging-port` against the user's existing profile so logged-in sessions are preserved.
metadata:
  shinobi.engine: node-mjs
  shinobi.requires_app: Chrome
  shinobi.protocol: chrome-devtools-protocol
---

# desktop-chrome-login-and-action

Spawns Chrome with `--remote-debugging-port=<port>` pointing at the user's standard `User Data` directory, then attaches via CDP and executes a list of step actions: `goto`, `wait`, `click`, `type`, `eval`, `screenshot`, `extract`. Each step is logged.

## Parameters

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `actions` | array | yes | List of step objects — see schema below |
| `port` | number | no | CDP port (default 9222) |
| `profile_dir` | string | no | Override `User Data` path (default: detect Chrome default) |
| `keep_open` | boolean | no | Leave Chrome running after the run (default false) |
| `timeout_ms` | number | no | Total budget across actions (default 60000) |

### Step shapes

```json
[
  { "type": "goto", "url": "https://example.com" },
  { "type": "wait", "selector": "input[name=email]", "ms": 5000 },
  { "type": "type", "selector": "input[name=email]", "text": "alice@x.com" },
  { "type": "click", "selector": "button[type=submit]" },
  { "type": "extract", "selector": "h1", "as": "headline" },
  { "type": "screenshot", "path": "C:\\out.png" }
]
```

## Output

```json
{ "success": true, "steps": 6, "extracts": { "headline": "Welcome" }, "screenshots": ["C:\\out.png"] }
```

## Implementation

[`scripts/skill.mjs`](scripts/skill.mjs):
1. Locates `chrome.exe` in standard install paths.
2. Spawns it (detached) with `--remote-debugging-port=<port>` and `--user-data-dir=<profile>`.
3. Polls `http://127.0.0.1:<port>/json/version` until ready (≤8s).
4. Picks the first page target, opens a WebSocket to its `webSocketDebuggerUrl`.
5. Executes each step via CDP commands (`Page.navigate`, `Runtime.evaluate`, `Input.dispatchKeyEvent`, `Page.captureScreenshot`).
6. Closes the WS (and Chrome unless `keep_open`).

The CDP wire is implemented inline (no `chrome-remote-interface` dep) using only native `WebSocket` + `fetch`.

## Edge cases

- Port already in use: error `port busy`.
- Chrome not installed: error `chrome.exe not found`.
- Selector not found within `wait.ms`: step fails, run aborts unless `optional: true` is set on the step.

## Safety

This skill operates on the user's logged-in browser. Never invoke without explicit user confirmation. Never log selector text that could include passwords (we redact `type` actions whose selector matches `[type="password"]`).
