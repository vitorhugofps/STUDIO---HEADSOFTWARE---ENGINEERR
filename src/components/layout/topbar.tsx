'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Plus, Search, Sun, Moon, Sparkles, ChevronDown, Check } from 'lucide-react';
import { pageTitle, NAV } from '@/lib/nav';
import type { Client, Notification } from '@/lib/db/types';
import { cn, relTime } from '@/lib/utils';
import { Button, Kbd, Avatar } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/client';
import { AssistantPanel } from './assistant';

export function Topbar({
  clients,
  activeClientId,
  notifications,
  setActiveClient,
  markRead,
  aiEnabled,
}: {
  clients: Pick<Client, 'id' | 'company' | 'contact_name' | 'brand_color' | 'logo_url' | 'status'>[];
  activeClientId?: string | null;
  notifications: Notification[];
  setActiveClient: (id: string) => Promise<void>;
  markRead: () => Promise<void>;
  aiEnabled: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState(false);
  const [notif, setNotif] = useState(false);
  const [pick, setPick] = useState(false);
  const [assist, setAssist] = useState(false);
  const [, start] = useTransition();
  const active = clients.find((c) => c.id === activeClientId);
  const unread = notifications.filter((n) => !n.read_at).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch((s) => !s);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setAssist((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function toggleTheme() {
    const el = document.documentElement;
    const light = el.classList.toggle('light');
    try {
      localStorage.setItem('ihs.theme', light ? 'light' : 'dark');
    } catch {}
  }

  const crumbs = useMemo(() => {
    const parts = pathname.split('/').filter(Boolean);
    return parts.length ? parts : [''];
  }, [pathname]);

  return (
    <>
      <header className="glass drag-region sticky top-3 z-30 mb-6 flex h-14 items-center gap-3 rounded-2xl px-3 pl-4">
        <div className="no-drag min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="display text-base text-ink">{pageTitle(pathname)}</span>
            {crumbs.length > 1 && <span className="truncate text-ink3">/ {crumbs.slice(1).join(' / ')}</span>}
          </div>
        </div>

        {/* Cliente ativo */}
        <button
          onClick={() => setPick(true)}
          className={cn('no-drag press flex h-9 items-center gap-2 rounded-full border border-white/10 pl-1.5 pr-3 text-[13px] hover:bg-white/[0.06]', active && 'border-white/15')}
          title="Cliente ativo (Marketing, Tráfego e Sites trabalham neste cliente)"
        >
          {active ? (
            <>
              <span className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-black" style={{ background: active.brand_color || '#FF5B1F' }}>
                {(active.company || active.contact_name).slice(0, 2).toUpperCase()}
              </span>
              <span className="max-w-[160px] truncate text-ink">{active.company || active.contact_name}</span>
            </>
          ) : (
            <>
              <span className="ml-1.5 h-2 w-2 rounded-full bg-ink3" />
              <span className="text-ink2">Escolher cliente</span>
            </>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-ink3" />
        </button>

        <button onClick={() => setSearch(true)} className="no-drag press hidden h-9 items-center gap-2 rounded-full border border-white/10 px-3 text-[13px] text-ink3 hover:bg-white/[0.06] md:flex">
          <Search className="h-3.5 w-3.5" />
          <span>Buscar</span>
          <Kbd>⌘K</Kbd>
        </button>

        <Button variant="ghost" size="icon" onClick={() => setAssist(true)} className="no-drag relative" title="Assistente Impacto (⌘J)">
          <Sparkles className={cn('h-4 w-4', aiEnabled ? 'text-accent' : 'text-ink3')} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="no-drag relative"
          onClick={() => {
            setNotif(true);
            if (unread) start(() => markRead());
          }}
          aria-label="Notificações"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />}
        </Button>

        <Button variant="ghost" size="icon" onClick={toggleTheme} className="no-drag" aria-label="Tema">
          <Sun className="hidden h-4 w-4 [html.light_&]:block" />
          <Moon className="h-4 w-4 [html.light_&]:hidden" />
        </Button>

        <Button href="/clientes/novo" size="sm" className="no-drag">
          <Plus className="h-4 w-4" /> Novo
        </Button>
      </header>

      {/* Busca ⌘K */}
      <Modal open={search} onClose={() => setSearch(false)} title="Ir para">
        <CommandList clients={clients} onGo={(href) => { setSearch(false); router.push(href); }} />
      </Modal>

      {/* Cliente ativo */}
      <Modal open={pick} onClose={() => setPick(false)} title="Cliente ativo">
        <p className="mb-3 text-sm text-ink2">Marketing, Tráfego, Sites e o Assistente trabalham no cliente escolhido aqui.</p>
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
          {clients.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => {
                  setPick(false);
                  start(async () => {
                    await setActiveClient(c.id);
                    router.refresh();
                  });
                }}
                className="press flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/[0.06]"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-semibold text-black" style={{ background: c.brand_color || '#FF5B1F' }}>
                  {(c.company || c.contact_name).slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1">
                  <span className="block text-sm text-ink">{c.company || c.contact_name}</span>
                  <span className="block text-xs text-ink3">{c.status}</span>
                </span>
                {c.id === activeClientId && <Check className="h-4 w-4 text-accent" />}
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      {/* Notificações */}
      <Modal open={notif} onClose={() => setNotif(false)} title="Notificações">
        {notifications.length === 0 ? (
          <p className="text-sm text-ink2">Nada por aqui.</p>
        ) : (
          <ul className="space-y-1">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    setNotif(false);
                    if (n.link) router.push(n.link);
                  }}
                  className="press flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.06]"
                >
                  <span className={cn('mt-1.5 dot', n.read_at ? 'bg-white/20' : 'bg-accent')} />
                  <span className="flex-1">
                    <span className="block text-sm text-ink">{n.title}</span>
                    <span className="block text-xs text-ink3">{relTime(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <AssistantPanel open={assist} onClose={() => setAssist(false)} screen={pathname} clientName={active?.company || active?.contact_name} aiEnabled={aiEnabled} />
    </>
  );
}

function CommandList({ clients, onGo }: { clients: Pick<Client, 'id' | 'company' | 'contact_name'>[]; onGo: (href: string) => void }) {
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const nav = NAV.flatMap((g) => g.items).map((i) => ({ label: i.label, href: i.href, group: 'Páginas' }));
    const cl = clients.map((c) => ({ label: c.company || c.contact_name, href: `/clientes/${c.id}`, group: 'Clientes' }));
    const all = [...nav, ...cl, { label: 'Novo cliente', href: '/clientes/novo', group: 'Ações' }, { label: 'Brand do cliente ativo', href: '/marketing/brand', group: 'Ações' }, { href: '/marketing/trafego', label: 'Nova campanha de tráfego', group: 'Ações' }];
    const t = q.trim().toLowerCase();
    return t ? all.filter((i) => i.label.toLowerCase().includes(t)) : all;
  }, [q, clients]);
  return (
    <div>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Digite para buscar páginas e clientes…" className="focus-ring mb-3 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-ink placeholder:text-ink3" onKeyDown={(e) => e.key === 'Enter' && items[0] && onGo(items[0].href)} />
      <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
        {items.slice(0, 30).map((i) => (
          <li key={i.href + i.label}>
            <button onClick={() => onGo(i.href)} className="press flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-white/[0.06]">
              <span className="text-ink">{i.label}</span>
              <span className="label">{i.group}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UserChip({ name }: { name: string }) {
  return <Avatar name={name} size={24} />;
}
