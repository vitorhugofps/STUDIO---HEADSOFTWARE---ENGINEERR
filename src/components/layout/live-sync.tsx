'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { toast } from 'sonner';

/**
 * Tempo real do time.
 * - Supabase Realtime: qualquer inserção, edição ou exclusão em qualquer tabela recarrega os dados da tela
 *   (router.refresh, sem perder a página) e mostra um aviso com quem mudou o quê.
 * - Se a pessoa estiver digitando, a tela não recarrega sozinha: aparece um aviso com o botão "Atualizar"
 *   e o recarregamento acontece quando ela sai do campo.
 * - Nova versão publicada (deploy na Vercel ou app atualizado): aviso com "Recarregar".
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const TABLE_LABEL: Record<string, string> = {
  clients: 'Clientes',
  client_contexts: 'Contexto do cliente',
  questionnaire_responses: 'Questionário',
  diagnoses: 'Diagnóstico',
  assets: 'Arquivos',
  brand_kits: 'BrandKit',
  projects: 'Projetos',
  tasks: 'Tarefas',
  content_plans: 'Plano de conteúdo',
  content_items: 'Peças do feed',
  video_projects: 'Vídeos',
  campaigns: 'Campanhas',
  ad_kits: 'Anúncios',
  deals: 'Vendas',
  quotes: 'Orçamentos',
  contracts: 'Contratos',
  invoices: 'Financeiro',
  expenses: 'Despesas',
  events: 'Agenda',
  approvals: 'Aprovações',
  approval_batches: 'Aprovações',
  competitors: 'Pesquisa',
  research_reports: 'Pesquisa',
  sites: 'Sites',
  profiles: 'Time',
  app_config: 'Configurações',
  integrations: 'Integrações',
};
// Tabelas de bastidor: atualizam a tela, mas não geram aviso próprio.
const QUIET = new Set(['activity_log', 'agent_runs', 'notifications', 'jobs']);

const isEditing = () => {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

export function LiveSync({ userId }: { userId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);

  // Dados em tempo real (somente no modo Supabase: app do time e web)
  useEffect(() => {
    if (!SB_URL || !SB_ANON) return;
    const sb = createBrowserClient(SB_URL, SB_ANON);
    let stopped = false;
    let channel: ReturnType<typeof sb.channel> | null = null;

    const refreshNow = () => {
      pending.current = false;
      router.refresh();
    };
    const scheduleRefresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (isEditing()) {
          pending.current = true;
          toast('Há novidades nesta tela', {
            id: 'live-pending',
            description: 'Alguém do time mudou dados. A tela atualiza quando você sair do campo.',
            action: { label: 'Atualizar', onClick: refreshNow },
            duration: 8000,
          });
        } else refreshNow();
      }, 700);
    };
    const onBlur = () => {
      if (pending.current) setTimeout(() => !isEditing() && refreshNow(), 200);
    };
    document.addEventListener('focusout', onBlur);

    (async () => {
      const { data } = await sb.auth.getSession();
      if (stopped) return;
      if (data.session?.access_token) sb.realtime.setAuth(data.session.access_token);
      channel = sb
        .channel('impacto-live')
        .on('postgres_changes', { event: '*', schema: 'public' }, (payload: any) => {
          const table: string = payload.table;
          if (table === 'activity_log' && payload.eventType === 'INSERT') {
            const row = payload.new || {};
            if (row.actor_id && row.actor_id === userId) return; // a própria pessoa já vê o resultado
            toast(`${row.actor_name || 'Alguém do time'} ${row.action || 'atualizou dados'}`, {
              id: `live-act-${row.id || Date.now()}`,
              description: 'Atualizado em tempo real',
              duration: 6000,
            });
            return;
          }
          if (!QUIET.has(table) && TABLE_LABEL[table]) {
            const row = payload.new || payload.old || {};
            const mine = row.created_by === userId || row.updated_by === userId || row.actor_id === userId;
            if (!mine) {
              const verb = payload.eventType === 'INSERT' ? 'novo item' : payload.eventType === 'DELETE' ? 'item removido' : 'atualizado';
              toast(`${TABLE_LABEL[table]}: ${verb}`, {
                id: `live-${table}`,
                description: 'A tela foi atualizada automaticamente.',
                duration: 4000,
              });
            }
          }
          scheduleRefresh();
        })
        .subscribe((status: string) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            toast.error('Conexão em tempo real caiu. Tentando de novo…', { id: 'live-status', duration: 4000 });
          }
        });
    })();

    // Token renovado: repassa ao canal para não perder a assinatura
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (session?.access_token) sb.realtime.setAuth(session.access_token);
    });

    return () => {
      stopped = true;
      document.removeEventListener('focusout', onBlur);
      if (timer.current) clearTimeout(timer.current);
      sub.subscription.unsubscribe();
      if (channel) sb.removeChannel(channel);
    };
  }, [router, userId]);

  // Nova versão publicada
  useEffect(() => {
    let first: string | null = null;
    let warned = false;
    const check = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        const j = await r.json();
        if (!j?.build) return;
        if (first === null) first = j.build;
        else if (j.build !== first && !warned) {
          warned = true;
          toast('Nova versão do Impacto publicada', {
            id: 'live-version',
            description: 'Recarregue para usar a versão mais recente.',
            action: { label: 'Recarregar', onClick: () => window.location.reload() },
            duration: Infinity,
          });
        }
      } catch {
        /* offline: tenta no próximo ciclo */
      }
    };
    check();
    const id = setInterval(check, 60_000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return null;
}
