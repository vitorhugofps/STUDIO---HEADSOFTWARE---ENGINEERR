'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { brl, num } from '@/lib/utils';

const ACCENT = '#FF5B1F';

function TooltipBox({ active, payload, label, money }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-xl px-3 py-2 text-xs">
      <div className="label mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-ink">
          <span className="dot" style={{ background: p.color || ACCENT }} />
          <span className="text-ink2">{p.name || p.dataKey}</span>
          <span className="num ml-auto text-sm">{money ? brl(p.value) : num(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function AreaTrend({ data, xKey, yKey, money, height = 220, name }: { data: any[]; xKey: string; yKey: string; money?: boolean; height?: number; name?: string }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="ihsArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.45} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={xKey} axisLine={false} tickLine={false} />
          <YAxis axisLine={false} tickLine={false} width={48} tickFormatter={(v) => (money ? `${Math.round(v / 1000)}k` : num(v))} />
          <Tooltip content={<TooltipBox money={money} />} />
          <Area type="monotone" dataKey={yKey} name={name} stroke={ACCENT} strokeWidth={2} fill="url(#ihsArea)" dot={false} activeDot={{ r: 4, fill: ACCENT, stroke: '#0A0A0A', strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Bars({ data, xKey, yKey, money, height = 220, name, highlightLast }: { data: any[]; xKey: string; yKey: string; money?: boolean; height?: number; name?: string; highlightLast?: boolean }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={xKey} axisLine={false} tickLine={false} />
          <YAxis axisLine={false} tickLine={false} width={48} tickFormatter={(v) => (money ? `${Math.round(v / 1000)}k` : num(v))} />
          <Tooltip content={<TooltipBox money={money} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey={yKey} name={name} radius={[6, 6, 2, 2]}>
            {data.map((_, i) => (
              <Cell key={i} fill={highlightLast && i === data.length - 1 ? ACCENT : 'rgba(255,255,255,0.22)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ values, color = ACCENT, height = 36 }: { values: number[]; color?: string; height?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 0, right: 0, top: 2, bottom: 0 }}>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.12} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PainBars({ pain, labels }: { pain: Record<string, number>; labels: Record<string, string> }) {
  const entries = Object.entries(pain).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-2.5">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[120px_1fr_32px] items-center gap-3 text-sm">
          <span className="truncate text-ink2">{labels[k] || k}</span>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${v * 10}%`, background: v >= 7 ? '#FF4D4F' : v >= 5 ? ACCENT : '#3DDC97' }} />
          </div>
          <span className="num text-right text-sm text-ink">{v}</span>
        </div>
      ))}
    </div>
  );
}
