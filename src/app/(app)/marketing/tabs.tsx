'use client';

import { usePathname } from 'next/navigation';
import { MARKETING_TABS } from '@/lib/nav';
import { PillTabs } from '@/components/ui/primitives';

export function MarketingTabs() {
  const pathname = usePathname();
  const current = MARKETING_TABS.filter((t) => pathname === t.href || (t.href !== '/marketing' && pathname.startsWith(t.href))).sort((a, b) => b.href.length - a.href.length)[0]?.href || '/marketing';
  return <PillTabs tabs={MARKETING_TABS} current={current} />;
}
