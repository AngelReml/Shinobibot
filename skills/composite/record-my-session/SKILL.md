---
name: record-my-session
description: Composite skill — wraps desktop-obs-record-self and desktop-obs-stop-and-save behind a single tool with action=start|stop. Use when the agent or user wants to bracket an arbitrary session with recording.
license: MIT
compatibility: Requires OBS Studio 28+ with obs-websocket plugin enabled.
metadata:
  shinobi.engine: node-mjs
  shinobi.composes:
    - desktop-obs-record-self
    - desktop-obs-stop-and-save
---

# record-my-session

Pairs nicely with the `/record` CLI command (see `scripts/shinobi.ts`).

## Parameters

| Name | Type | Required | Default | Notes |
|------|------|----------|---------|-------|
| `action` | enum `start`/`stop` | yes | — | |
| `with_microphone` | boolean | no | `false` | Forwarded to start |
| `host` | string | no | `127.0.0.1` | |
| `port` | number | no | `4455` | |
| `password` | string | no | `''` | |

## Output

`start`:
```json
{ "success": true, "action": "start", "scene": "Shinobi Self-Recording", "started_at": "...", "recording": true }
```

`stop`:
```json
{ "success": true, "action": "stop", "output_path": "C:\\...mp4", "size_bytes": 1234 }
```

## Implementation

`scripts/skill.mjs` imports the H1 and H2 skill modules directly, dispatches based on `action`. No new networking — both child skills already share `ObsClient`.
