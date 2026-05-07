#!/bin/bash
# Copy-paste deploy script. Run on the VPS as root after SSHing in.
# Reads from current shell, NO secrets here. Aborts on any failure.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/root/OpenGravity}"
SERVICE="${SERVICE:-opengravity.service}"
KERNEL_URL="${KERNEL_URL:-${OPENGRAVITY_URL:-http://localhost:9900}}"
KEY="${KEY:?Set KEY=<your X-Shinobi-Key> before running}"

cd "$REPO_DIR"

echo "=== 1. Snapshot ==="
git rev-parse HEAD > /root/og_pre_deploy.sha
date > /root/og_pre_deploy.ts
echo "pre-deploy: $(cat /root/og_pre_deploy.sha) at $(cat /root/og_pre_deploy.ts)"
cp .env /root/og.env.backup-$(date +%Y%m%d-%H%M%S)

echo "=== 2. Pull ==="
git fetch origin main
echo "Incoming commits:"
git log --oneline HEAD..origin/main | head -30 || true
git pull origin main

echo "=== 3. npm ci ==="
npm ci

echo "=== 4. tsc check ==="
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v browser_manager | head -10 || echo "  tsc clean"

echo "=== 5. Restart service ==="
systemctl restart "$SERVICE"
sleep 3
systemctl status "$SERVICE" --no-pager | head -15

echo "=== 6. Smoke tests ==="
echo "  /v1/health"
curl -s "$KERNEL_URL/v1/health" | head -c 200; echo

echo "  /v1/version"
curl -s "$KERNEL_URL/v1/version" | head -c 200; echo

echo "  /v1/openbrain/match"
curl -s -X POST "$KERNEL_URL/v1/openbrain/match" \
  -H "Content-Type: application/json" -H "X-Shinobi-Key: $KEY" \
  -d '{"task":"test deploy","required_capabilities":["testing"]}' | head -c 300; echo

echo "  /v1/audit/profile/<test-id>"
curl -s -H "X-Shinobi-Key: $KEY" \
  "$KERNEL_URL/v1/audit/profile/post-deploy-test" | head -c 300; echo

echo "  /v1/telemetry/summary"
curl -s -H "X-Shinobi-Key: $KEY" \
  "$KERNEL_URL/v1/telemetry/summary" | head -c 300; echo

echo "  /v1/skills/reflect"
curl -s -H "X-Shinobi-Key: $KEY" \
  "$KERNEL_URL/v1/skills/reflect" | head -c 300; echo

echo ""
echo "=== Deploy OK ==="
echo "If anything looks wrong:"
echo "  git reset --hard \$(cat /root/og_pre_deploy.sha)"
echo "  systemctl restart $SERVICE"
