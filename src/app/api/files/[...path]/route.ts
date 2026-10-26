import { fileResponse } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Entrega um arquivo guardado (disco no modo local; redirecionamento para URL assinada no Supabase). */
export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const rel = parts.join('/');
  if (rel.includes('..')) return new Response('Caminho inválido', { status: 400 });
  return fileResponse(rel);
}
