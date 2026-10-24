'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutGrid, Users, Megaphone, CheckCircle2, FolderKanban, Workflow, Globe, Radar, Library, CalendarDays, Handshake, FileSignature, Wallet, BarChart3,
  UsersRound, Settings, ChevronsLeft, ChevronsRight, LogOut, type LucideIcon,
} from 'lucide-react';
import { NAV, canSee } from '@/lib/nav';
import type { Role } from '@/lib/db/types';
import { ROLE_LABEL } from '@/lib/db/types';
import { cn } from '@/lib/utils';
import { Avatar, Badge } from '@/components/ui/primitives';

const ICONS: Record<string, LucideIcon> = {
  LayoutGrid, Users, Megaphone, CheckCircle2, FolderKanban, Workflow, Globe, Radar, Library, CalendarDays, Handshake, FileSignature, Wallet, BarChart3, UsersRound, Settings,
};

export function Sidebar({ user, badges, logoutAction }: { user: { name: string; username: string; role: Role; title?: string | null; avatar_url?: string | null }; badges: Record<string, number>; logoutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('ihs.sidebar') === '1');
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'open';
  }, [collapsed]);
  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem('ihs.sidebar', c ? '0' : '1');
      } catch {}
      return !c;
    });
  }

  return (
    <aside className={cn('glass fixed left-3 top-3 bottom-3 z-40 flex flex-col rounded-3xl transition-[width] duration-300 ease-out', collapsed ? 'w-[72px]' : 'w-[248px]')}>
      {/* Marca */}
      <div className={cn('drag-region flex items-center gap-3 px-4 pt-5 pb-3', collapsed && 'justify-center px-0')}>
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-black/40">
          <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_18px_rgba(255,91,31,0.9)]" />
        </span>
        {!collapsed && (
          <div className="no-drag leading-none">
            <div className="display text-[17px] tracking-tight text-ink">Impacto</div>
            <div className="label mt-1 text-[9px]">Headsoftware</div>
          </div>
        )}
      </div>

      {/* Navegação */}
      <nav className="mt-1 flex-1 space-y-3 overflow-y-auto px-2.5 pb-2">
        {NAV.map((group, gi) => {
          const items = group.items.filter((i) => canSee(i, user.role));
          if (!items.length) return null;
          return (
            <div key={gi}>
              {group.label && !collapsed && <div className="label px-3 pb-1.5 pt-1">{group.label}</div>}
              {group.label && collapsed && <div className="mx-auto my-2 h-px w-6 bg-white/10" />}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const Icon = ICONS[item.icon] || LayoutGrid;
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  const badge = item.badgeKey ? badges[item.badgeKey] : 0;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          'press group relative flex items-center gap-3 rounded-xl px-3 py-[7px] text-[13.5px] transition-colors',
                          active ? 'bg-white/[0.08] text-ink' : 'text-ink2 hover:bg-white/[0.05] hover:text-ink',
                          collapsed && 'justify-center px-0',
                        )}
                      >
                        {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />}
                        <Icon className={cn('h-[17px] w-[17px] shrink-0', active ? 'text-accent' : 'text-ink3 group-hover:text-ink2')} strokeWidth={1.8} />
                        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                        {!collapsed && badge ? <Badge tone="accent">{badge}</Badge> : null}
                        {collapsed && badge ? <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" /> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Usuário */}
      <div className="border-t border-white/[0.07] p-2.5">
        <Link href="/user" className={cn('press flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-white/[0.05]', collapsed && 'justify-center px-0')}>
          <Avatar name={user.name} src={user.avatar_url} size={34} />
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13px] font-medium text-ink">{user.name}</div>
              <div className="truncate text-[11px] text-ink3">{user.title || ROLE_LABEL[user.role]}</div>
            </div>
          )}
        </Link>
        <div className={cn('mt-1 flex items-center gap-1', collapsed ? 'flex-col' : 'justify-between px-1')}>
          <button onClick={toggle} className="press rounded-lg p-1.5 text-ink3 hover:bg-white/[0.06] hover:text-ink" aria-label={collapsed ? 'Expandir' : 'Recolher'}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
          <form action={logoutAction}>
            <button className="press rounded-lg p-1.5 text-ink3 hover:bg-white/[0.06] hover:text-err" aria-label="Sair" title="Sair">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
