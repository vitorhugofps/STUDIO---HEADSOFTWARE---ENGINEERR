#!/bin/bash
# Abre o IMPACTO HEADSOFTWARE em modo desenvolvimento (recarrega ao salvar arquivos) dentro da janela do app.
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund
[ -d desktop/node_modules ] || npm --prefix desktop install --no-audit --no-fund
[ -f .env.local ] || cp .env.example .env.local
echo "Servidor em http://127.0.0.1:3741 · Ctrl+C encerra"
npm run dev &
DEV=$!
sleep 6
IHS_DEV_URL=http://127.0.0.1:3741 npm --prefix desktop run start
kill $DEV 2>/dev/null || true
