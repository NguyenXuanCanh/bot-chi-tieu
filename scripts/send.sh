#!/bin/sh
# Giả lập Telegram gọi webhook: ./scripts/send.sh "phở 45k" [message_id]
ID=${2:-$(date +%s)}
TEXT=$(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')
curl -s -X POST http://localhost:8787/webhook \
  -H 'Content-Type: application/json' \
  -H "X-Telegram-Bot-Api-Secret-Token: ${SECRET:-local-secret}" \
  -d "{\"message\":{\"message_id\":$ID,\"date\":0,\"chat\":{\"id\":${CHAT:-111}},\"text\":$TEXT}}"
echo
