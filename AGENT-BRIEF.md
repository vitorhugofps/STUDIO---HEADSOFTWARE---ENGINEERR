# Brief para agentes de módulo · IMPACTO HEADSOFTWARE

Repositório: `/home/claude/studio---headsoftware---engineerr` (Next.js 15 App Router, React 19, TypeScript estrito, Tailwind 3, Supabase/local DB). Idioma de toda a interface: português do Brasil.

## Leia antes de escrever (nesta ordem, só estes)
1. `src/lib/db/types.ts` (tabelas, tipos e labels)
2. `src/components/ui/primitives.tsx` e `src/components/ui/client.tsx` (componentes prontos)
3. `src/app/(app)/clientes/[id]/page.tsx` e `src/lib/actions/clients.ts` (padrão de página + server actions)
4. `src/lib/ai/claude.ts` e `src/lib/ai/prompts.ts` (IA com fallback de exemplo)
5. `src/lib/active-client.ts`, `src/lib/actions/common.ts`, `src/components/ui/kanban.tsx`, `src/components/ui/charts.tsx`, `src/components/ui/dropzone.tsx`

## Regras de código
- Páginas são Server Components: `const user = await requireUser(); const d = await db();` e leia com `d.list(table, { where, orderBy, desc, limit })`, `d.get`, `d.insert`, `d.update`, `d.remove`.
- Mutations em arquivos `'use server'` dentro de `src/lib/actions/<seu-modulo>.ts`. Assinatura: `async function xAction(fd: FormData)` ou `(id, patch)`; sempre `getSession()` para checar usuário; retornar `{ ok: true, ... }` ou `{ ok: false, error }`; `revalidatePath` nas rotas afetadas; `logActivity(d, {...})` em ações relevantes.
- Formulários: `<ActionForm action={minhaAction} success="…">` com `<SubmitButton>`; botões de ação: `<ActionButton action={acao.bind(null, id)} confirm="…">`. Para passar args de server action a client component use `.bind`.
- Interatividade (estado, drag, modais) em client components `'use client'` pequenos, em arquivo separado na mesma pasta da página.
- IA: `generateJSON({ agent, tier: 'copy'|'strategy'|'light', system: STUDIO_SYSTEM, user: PROMPTS.x(...), example, db: d, clientId })`. Sem chave, volta `isExample=true`: salve com `is_example`/marque com `<Example show />`. Nunca bloqueie a tela por falta de IA.
- `searchParams` e `params` são Promises no Next 15: `const sp = await searchParams`.
- Sem dependências novas. Ícones: `lucide-react`. Datas/moeda: helpers de `src/lib/utils.ts` (`brl`, `fmtDate`, `relTime`, `num`, `pct`, `sum`, `groupBy`, `monthKey`).
- Cliente ativo (Marketing, Tráfego, Sites): `const active = await getActiveClient();` (pode ser null).
- Não edite arquivos fora da sua lista. Não rode `next build` nem `npm install`. Ao terminar rode `npx tsc --noEmit -p tsconfig.json` e corrija só os erros dos seus arquivos.

## Contrato de design (modo Operate, referência SYNQ × Studio Impacto)
- Fundo preto, barras de vidro, laranja `accent` como único destaque (ação principal, foco, status). Classes prontas: `card`, `glass`, `glass-strong`, `display` (título condensado em caixa alta), `num` (números), `label` (rótulo pequeno), `nevoa` (névoa laranja, só em tela de entrada ou cabeçalho-herói de 1 por página), `twotone` + `<em>` para headline em duas cores, `press` (resposta ao toque), `hairline`.
- Estrutura de página: `<PageHeader kicker title subtitle actions />` no topo, depois `PillTabs` quando houver sub-visões, depois grid `lg:grid-cols-3` com conteúdo principal em `lg:col-span-2` e coluna lateral com ações/resumo.
- Uma ação principal por tela (botão `primary`); o resto `subtle`/`ghost`/`glass`.
- Status com "o ponto": `<Dot state="rec|done|wave|err|idle" />` (rec = processando, done = concluído, wave = aguardando aprovação).
- Estados vazios com `<EmptyState title text action />`. Nada de "lorem ipsum": use dados reais do seed e textos úteis.
- Evite grades genéricas de 3 cards iguais sem motivo, glow decorativo, emojis em UI, setas coladas em botões. Tabelas densas para listas (`Table/TH/TD`), kanban para fluxo, drawer/modal para detalhe.
- Texto de marca sem travessão; frases curtas; número no lugar de adjetivo.
