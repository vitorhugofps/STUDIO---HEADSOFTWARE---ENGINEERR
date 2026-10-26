import { NextResponse } from 'next/server';
import { APP_VERSION, isSupabaseMode } from '@/lib/config';
import { hasAIKey } from '@/lib/ai/claude';

export async function GET() {
  return NextResponse.json({ ok: true, app: 'Impacto', version: APP_VERSION, mode: isSupabaseMode() ? 'supabase' : 'local', ai: hasAIKey(), time: new Date().toISOString() });
}
