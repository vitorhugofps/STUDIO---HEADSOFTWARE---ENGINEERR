import type { Role } from '@/lib/db/types';

export type NavItem = { href: string; label: string; icon: string; roles?: Role[]; badgeKey?: string };
export type NavGroup = { label?: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    items: [
      { href: '/', label: 'Dashboard', icon: 'LayoutGrid' },
      { href: '/clientes', label: 'Clientes', icon: 'Users' },
      { href: '/marketing', label: 'Marketing', icon: 'Megaphone' },
      { href: '/aprovacoes', label: 'Aprovações', icon: 'CheckCircle2', badgeKey: 'aprovacoes' },
    ],
  },
  {
    label: 'Operação',
    items: [
      { href: '/projects', label: 'Projects', icon: 'FolderKanban' },
      { href: '/workflow', label: 'Workflow', icon: 'Workflow' },
      { href: '/sites', label: 'Sites', icon: 'Globe' },
      { href: '/pesquisa', label: 'Pesquisa', icon: 'Radar' },
      { href: '/biblioteca', label: 'Biblioteca', icon: 'Library' },
      { href: '/agenda', label: 'Agenda', icon: 'CalendarDays' },
    ],
  },
  {
    label: 'Negócio',
    items: [
      { href: '/vendas', label: 'Vendas', icon: 'Handshake', roles: ['admin', 'comercial'] },
      { href: '/contratos', label: 'Contratos', icon: 'FileSignature', roles: ['admin', 'comercial'] },
      { href: '/financeiro', label: 'Financeiro', icon: 'Wallet', roles: ['admin'] },
      { href: '/analytics', label: 'Analytics', icon: 'BarChart3', roles: ['admin', 'comercial', 'developer'] },
    ],
  },
  {
    label: 'Studio',
    items: [
      { href: '/team', label: 'Team', icon: 'UsersRound' },
      { href: '/settings', label: 'Settings', icon: 'Settings', roles: ['admin', 'developer'] },
    ],
  },
];

export const MARKETING_TABS = [
  { href: '/marketing', label: 'Campanha' },
  { href: '/marketing/brand', label: 'Brand' },
  { href: '/marketing/feed', label: 'Criação de Feed' },
  { href: '/marketing/videos', label: 'Criação de Vídeos' },
  { href: '/marketing/trafego', label: 'Tráfego' },
];

export function canSee(item: NavItem, role: Role) {
  if (!item.roles) return true;
  return role === 'admin' || item.roles.includes(role);
}

export function pageTitle(pathname: string) {
  const all = NAV.flatMap((g) => g.items);
  const exact = all.find((i) => i.href === pathname);
  if (exact) return exact.label;
  const prefix = all.filter((i) => i.href !== '/' && pathname.startsWith(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return prefix?.label || 'IMPACTO';
}
