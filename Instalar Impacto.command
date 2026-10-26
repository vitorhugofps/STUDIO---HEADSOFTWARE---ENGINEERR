#!/bin/bash
# Impacto · instalador para macOS
# Dê dois cliques. Ele confere o Node, instala as dependências, gera o build e cria o app em /Applications.
set -e
cd "$(dirname "$0")"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok() { printf "\033[32m✓ %s\033[0m\n" "$1"; }
warn() { printf "\033[33m! %s\033[0m\n" "$1"; }

bold "Impacto · instalação"
echo "Pasta: $(pwd)"
echo

# 1. Node.js >= 20
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  warn "Node.js 20+ não encontrado."
  if command -v brew >/dev/null 2>&1; then
    read -r -p "Instalar o Node pelo Homebrew? [S/n] " r
    if [[ ! "$r" =~ ^[Nn]$ ]]; then brew install node; fi
  else
    echo "Instale o Node LTS em https://nodejs.org e rode este instalador de novo."
    exit 1
  fi
fi
ok "Node $(node -v)"

# 2. Variáveis de ambiente
if [ ! -f .env.local ]; then
  if [ -f env.local ]; then
    cp env.local .env.local
    ok ".env.local criado a partir do env.local (Supabase ligado)."
  else
    cp .env.example .env.local
    warn ".env.local criado a partir do exemplo. Sem Supabase o app roda em modo local (dados de exemplo)."
  fi
fi

# 3. Dependências e build
bold "Instalando dependências do app…"
npm install --no-audit --no-fund
bold "Gerando o build…"
npm run build

# 4. App desktop
bold "Instalando o empacotador do app…"
npm --prefix desktop install --no-audit --no-fund
bold "Empacotando o Impacto.app (pode levar alguns minutos na primeira vez)…"
npm --prefix desktop run dist:dir

APP=$(find desktop/dist -maxdepth 2 -name "Impacto.app" | head -1)
if [ -z "$APP" ]; then
  warn "Não encontrei o .app gerado. Veja os erros acima."
  exit 1
fi

# 5. Copia as variáveis para a pasta de dados do app e instala em /Applications
DATA_DIR="$HOME/Library/Application Support/Impacto"
mkdir -p "$DATA_DIR"
cp .env.local "$DATA_DIR/.env"
rm -rf "/Applications/Impacto.app"
cp -R "$APP" /Applications/
xattr -dr com.apple.quarantine "/Applications/Impacto.app" 2>/dev/null || true
ok "App instalado em /Applications/Impacto.app"
echo
bold "Abrindo…"
open "/Applications/Impacto.app"
echo
echo "Usuários iniciais: VITOR · MARCOS · PEDROPAULO · YURI  (senha inicial: impacto2026)"
echo "Dados e configurações ficam em: $DATA_DIR"
