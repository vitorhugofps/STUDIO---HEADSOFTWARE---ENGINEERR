import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasAIKey } from '@/lib/ai/claude';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { logoutAction, markNotificationsReadAction, setActiveClientAction } from '@/lib/actions/common';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const d = await db();
  const store = await cookies();
  const activeClientId = store.get('ihs_client')?.value || null;

  const [clients, notifications, pendingItems] = await Promise.all([
    d.list('clients', { orderBy: 'company' }),
    d.list('notifications', { where: { user_id: user.id }, orderBy: 'created_at', desc: true, limit: 20 }),
    d.list('content_items', { where: { status: 'em_aprovacao' } }),
  ]);

  return (
    <div className="min-h-screen">
      <Sidebar user={user} badges={{ aprovacoes: pendingItems.length }} logoutAction={logoutAction} />
      <div className="app-main pr-3 transition-[padding] duration-300">
        <Topbar
          clients={clients.map((c) => ({ id: c.id, company: c.company, contact_name: c.contact_name, brand_color: c.brand_color, logo_url: c.logo_url, status: c.status }))}
          activeClientId={activeClientId}
          notifications={notifications}
          setActiveClient={setActiveClientAction}
          markRead={markNotificationsReadAction}
          aiEnabled={hasAIKey()}
        />
        <main className="pb-16">{children}</main>
      </div>
    </div>
  );
}
