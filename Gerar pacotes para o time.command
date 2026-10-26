#!/bin/bash
# Gera os pacotes do Impacto para distribuir ao time (Apple Silicon e Intel),
# já conectados ao Supabase do Studio. Saída em desktop/dist/*.zip. Compartilhe pelo Drive ou WhatsApp.
set -e
cd "$(dirname "$0")"
bold() { printf "\033[1m%s\033[0m\n" "$1"; }

[ -f .env.local ] || { echo "Falta o .env.local (rode o instalador antes)."; exit 1; }
bold "Build do app…"
npm run build
bold "Conexão do time (runtime.env a partir do .env.local, só as variáveis públicas do Supabase)…"
grep -E '^(SUPABASE_URL|SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY)=' .env.local > desktop/runtime.env
[ -d desktop/node_modules ] || npm --prefix desktop install --no-audit --no-fund
bold "Empacotando (Apple Silicon + Intel)…"
cd desktop && npx electron-builder --mac zip --arm64 --x64 --config electron-builder.yml
echo
bold "Pacotes prontos em desktop/dist:"
ls -1 dist/*.zip
echo
echo "Quem receber precisa, após copiar para Aplicativos, rodar uma vez no Terminal:"
echo '  xattr -cr "/Applications/Impacto.app" && codesign --force --deep --sign - "/Applications/Impacto.app"'
echo "(ou Ajustes do Sistema → Privacidade e Segurança → Abrir mesmo assim). Para eliminar esse passo, assine o app com um Apple Developer ID."
