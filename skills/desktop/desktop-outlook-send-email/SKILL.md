---
name: desktop-outlook-send-email
description: Composes and sends an email through the local Outlook desktop client (Outlook.Application COM). Use when the user asks to send mail from their already-configured Outlook account, with optional attachments and CC/BCC.
license: MIT
compatibility: Requires Microsoft Outlook installed and a default profile configured. Windows only.
metadata:
  shinobi.engine: node-mjs
  shinobi.runtime_helper: scripts/send.ps1
  shinobi.requires_app: Outlook
---

# desktop-outlook-send-email

Sends an email from the user's configured Outlook account using COM automation.

## Parameters

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `to` | string | yes | Comma- or `;`-separated recipients |
| `subject` | string | yes | |
| `body` | string | yes | Plain text by default |
| `html` | boolean | no | If true, `body` is HTML |
| `cc` | string | no | Comma-separated |
| `bcc` | string | no | |
| `attachments` | string[] | no | Absolute file paths |
| `display` | boolean | no | If true, show the compose window without sending (preview) |

## Output

```json
{ "success": true, "sent": true, "message_id": "<...>", "to": "...", "subject": "..." }
```

When `display=true`, returns `sent:false` and surfaces only the draft id.

## Implementation

[`scripts/skill.mjs`](scripts/skill.mjs) spawns `scripts/send.ps1`, which uses `New-Object -ComObject Outlook.Application`, builds a `MailItem`, attaches files, then either `.Send()` or `.Display()`.

## Edge cases

- Outlook not installed: COM throws; helper reports `error: Outlook not available`.
- Profile not configured: COM call still succeeds in displaying but `.Send()` returns an exception captured into `error`.
- Attachment path missing: returned as `errors: [...]` per file; the rest still send.
- Sensitive content: the skill never logs `body`.

## Safety

This skill SENDS real email. The agent should confirm with the user before invoking unless `display=true`.
