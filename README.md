# IMPACTO HEADSOFTWARE

Sistema operacional do **Studio Impacto** (Uberlândia, MG): CRM, marketing, tráfego, marca, vídeo, sites, vendas, contratos e financeiro no mesmo lugar, operado por agentes de IA com aprovação humana.

Visual: base preta, barras de vidro, laranja como único destaque, tipografia condensada em caixa alta (referência SYNQ × identidade do Studio).

## Abrir no Mac (app)

1. Dê dois cliques em **`Instalar IMPACTO HEADSOFTWARE.command`**.
2. O instalador confere o Node, instala dependências, gera o build e cria `/Applications/IMPACTO HEADSOFTWARE.app`.
3. Entre com um dos usuários do time: **VITOR · MARCOS · PEDROPAULO · YURI** (senha inicial `impacto2026`, troque em *User*).

Para desenvolver com recarga automática: **`Abrir em desenvolvimento.command`** (ou `npm run dev` + `npm run app:dev`).

## Modos de dados

| Modo | Quando | Onde ficam os dados |
| --- | --- | --- |
| **Supabase** | `.env.local` com `SUPABASE_URL` e `SUPABASE_ANON_KEY` | Projeto `impacto-headsoftware` (São Paulo). Esquema em `supabase/migrations/0001_init.sql`. Usuários no Supabase Auth (`username@headsoftware.studioimpacto.com.br`). |
| **Local** | sem as variáveis | `.data/db.json` (dev) ou `~/Library/Application Support/IMPACTO HEADSOFTWARE/data` (app). Dados de exemplo e os 4 usuários. |

Uploads ficam em `data/uploads`. Vídeos grandes: use link do Google Drive.

## IA

Em **Settings → Integrações** cole a chave da API da Anthropic. Sem chave, toda geração sai marcada como **exemplo** e o app continua funcionando. Modelos: Opus 5.5 para estratégia e revisão, Sonnet 5.5 para copy e roteiros, Haiku 5.5 para tarefas leves. Custos ficam em *Financeiro → IA* (a partir de `agent_runs`).

## Estrutura

```
src/app/(app)/…         páginas (Dashboard, Clientes, Marketing, Projects, Workflow, Sites, Pesquisa, Biblioteca, Agenda, Vendas, Contratos, Financeiro, Analytics, Team, Settings, User, Aprovações)
src/app/aprovar/[token] portal público de aprovação do cliente
src/lib/db              tipos, banco local (JSON) e adaptador Supabase
src/lib/ai              Claude (generateJSON/generateText/stream) e prompts do Método Impacto
src/lib/questionnaire   questionário de diagnóstico (10 blocos + nichos)
src/lib/actions         server actions por módulo
src/components          design system (primitives, client, charts, kanban, dropzone) e layout (sidebar, topbar, assistente)
desktop/                app Electron (vidro nativo do macOS, servidor Next embutido)
supabase/               migração do esquema
```

## Comandos

```bash
npm run dev          # http://127.0.0.1:3741
npm run build        # build standalone + cópia de estáticos
npm run start        # servidor de produção
npm run typecheck
npm run app:dev      # janela do app apontando para o dev server
npm run app:build    # build + IMPACTO HEADSOFTWARE.app (dmg e dir em desktop/dist)
```

## Próximas fases

Publicação no Instagram e criação de campanhas pela Marketing API da Meta (exige App Review), envio de relatórios por Resend (domínio verificado), assinatura eletrônica, cobrança Pix/boleto, NFS-e, worker de render de vídeo (ffmpeg/Remotion/HyperFrames) e agente local no Mac do editor.
