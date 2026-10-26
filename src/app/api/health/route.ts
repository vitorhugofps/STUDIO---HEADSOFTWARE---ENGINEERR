import { NextResponse } from 'next/server';
import { APP_VERSION, isSupabaseMode } from '@/lib/config';
import { hasAIKey } from '@/lib/ai/claude';

export const dynamic = 'force-dynamic';

/** Identificador da versão publicada: muda a cada deploy na Vercel (commit) ou a cada build local. */
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || process.env.VERCEL_DEPLOYMENT_ID || process.env.IHS_BUILD || APP_VERSION;

export async function GET() {
  return NextResponse.json(
    { ok: true, app: 'Impacto', version: APP_VERSION, build: BUILD, mode: isSupabaseMode() ? 'supabase' : 'local', ai: hasAIKey(), time: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
