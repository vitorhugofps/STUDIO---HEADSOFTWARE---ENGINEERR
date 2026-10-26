# Impacto

Sistema operacional do **Studio Impacto** (Uberlândia, MG): CRM, marketing, tráfego, marca, vídeo, sites, vendas, contratos e financeiro no mesmo lugar, operado por agentes de IA com aprovação humana.

Visual: base preta, barras de vidro, laranja como único destaque, tipografia condensada em caixa alta (referência SYNQ × identidade do Studio).

## Abrir no Mac (app)

1. Dê dois cliques em **`Instalar Impacto.command`**.
2. O instalador confere o Node, instala dependências, gera o build e cria `/Applications/Impacto.app`.
3. Entre com um dos usuários do time: **VITOR · MARCOS · PEDROPAULO · YURI** (senha inicial `impacto2026`, troque em *User*).

Para desenvolver com recarga automática: **`Abrir em desenvolvimento.command`** (ou `npm run dev` + `npm run app:dev`).

## Modos de dados

| Modo | Quando | Onde ficam os dados |
| --- | --- | --- |
| **Supabase** | `.env.local` com `SUPABASE_URL` e `SUPABASE_ANON_KEY` | Projeto `impacto-headsoftware` (São Paulo). Esquema em `supabase/migrations/0001_init.sql`. Usuários no Supabase Auth (`username@headsoftware.studioimpacto.com.br`). |
| **Local** | sem as variáveis | `.data/db.json` (dev) ou `~/Library/Application Support/Impacto/data` (app). Dados de exemplo e os 4 usuários. |

Uploads ficam em `data/uploads` no modo local e no bucket `files` do Supabase Storage no modo Supabase. Vídeos muito grandes: use link do Google Drive.

## Vercel

Na Vercel o app roda em modo Supabase. As funções têm disco somente leitura (só `/tmp`, volátil) e recusam corpo de requisição acima de 4,5 MB. Por isso:

- **Variáveis de ambiente** (Project Settings → Environment Variables): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`. As duas `NEXT_PUBLIC_*` precisam existir já no build, porque o navegador as usa para enviar arquivos direto ao Supabase. Opcionais: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `META_ACCESS_TOKEN`, `RESEND_API_KEY`, `APIFY_TOKEN` (valem quando a chave não foi salva em Settings).
- **Arquivos**: o navegador envia direto ao bucket privado `files` do Supabase Storage em `uploads/<cliente|studio>/<arquivo>` e só avisa `/api/upload` para registrar o asset (sem o limite de 4,5 MB). `/api/files/…` responde 302 para uma URL assinada de 1 hora, então vídeos tocam direto do Supabase. As imagens geradas por IA vão para o mesmo bucket. O limite por arquivo é o do projeto Supabase (Dashboard → Storage → Settings): no projeto atual é de 50 MB, apesar de o bucket aceitar mais; acima disso o envio é recusado com um aviso na fila e o caminho é o link do Google Drive (ou subir o limite global do projeto).
- **Configuração compartilhada**: as chaves e os dados do Studio salvos em **Settings** ficam na tabela `app_config` (linha `main`), valem para o time inteiro e sobrevivem a novos deploys. Todo usuário logado lê; **só o admin grava** (os outros papéis recebem o aviso na tela). As instâncias atualizam o cache a cada 30 s.
- **Banco**: o bucket `files`, as políticas e a tabela `app_config` estão em `supabase/migrations/0002_arquivos_e_config.sql` (o projeto do time já a tem; aplique em qualquer outro projeto Supabase antes de publicar).
- No app desktop sem as variáveis `NEXT_PUBLIC_*` no build, o envio continua passando pelo servidor local (`/api/upload`).

## IA

Em **Settings → Integrações** cole a chave da API da Anthropic. Sem chave, toda geração sai marcada como **exemplo** e o app continua funcionando. Modelos: Opus 5.5 para estratégia e revisão, Sonnet 5.5 para copy e roteiros, Haiku 5.5 para tarefas leves. Custos ficam em *Financeiro → IA* (a partir de `agent_runs`).

**ChatGPT (OpenAI) é usado somente para criar imagens** (moodboards da Brand, imagens de apoio e variações). Todo texto, estratégia e roteiro ficam no Claude: não existe modo de texto nem reserva do Claude na OpenAI. No card **ChatGPT · Imagens** (Settings → Integrações, ou a variável `OPENAI_API_KEY`) você cola a chave e escolhe o modelo de imagem: `gpt-image-1` (padrão), `gpt-image-1-mini` ou `dall-e-3`. *Testar conexão* confere se a chave acessa o modelo escolhido e, se não acessar, lista os modelos de imagem que ela pode usar. As imagens saem em *Biblioteca → Gerar imagem* e em *Marketing → Brand → Gerar moodboard*, e entram na Biblioteca com a tag IA. Sem a chave da OpenAI, só a geração de imagens fica indisponível.

## Estrutura

```
src/app/(app)/…         páginas (Dashboard, Clientes, Marketing, Projects, Workflow, Sites, Pesquisa, Biblioteca, Agenda, Vendas, Contratos, Financeiro, Analytics, Team, Settings, User, Aprovações)
src/app/aprovar/[token] portal público de aprovação do cliente
src/lib/db              tipos, banco local (JSON) e adaptador Supabase
src/lib/ai              Claude (generateJSON/generateText/stream), prompts do Método Impacto e geração de imagens (ChatGPT, só imagens)
src/lib/questionnaire   questionário de diagnóstico (10 blocos + nichos)
src/lib/actions         server actions por módulo
src/components          design system (primitives, client, charts, kanban, dropzone) e layout (sidebar, topbar, assistente)
desktop/                app Electron (vidro nativo do macOS, servidor Next embutido)
supabase/               migrações do esquema (tabelas, arquivos e configuração compartilhada)
```

## Comandos

```bash
npm run dev          # http://127.0.0.1:3741
npm run build        # build standalone + cópia de estáticos
npm run start        # servidor de produção
npm run typecheck
npm run app:dev      # janela do app apontando para o dev server
npm run app:build    # build + Impacto.app (dmg e dir em desktop/dist)
```

## Próximas fases

Publicação no Instagram e criação de campanhas pela Marketing API da Meta (exige App Review), envio de relatórios por Resend (domínio verificado), assinatura eletrônica, cobrança Pix/boleto, NFS-e, worker de render de vídeo (ffmpeg/Remotion/HyperFrames) e agente local no Mac do editor.
