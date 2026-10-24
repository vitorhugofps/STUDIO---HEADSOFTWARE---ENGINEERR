import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasAIKey, streamChat } from '@/lib/ai/claude';
import { PROMPTS } from '@/lib/ai/prompts';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });
  const { messages, screen } = (await req.json()) as { messages: { role: 'user' | 'assistant'; content: string }[]; screen: string };

  const d = await db();
  const store = await cookies();
  const activeId = store.get('ihs_client')?.value;
  let context = `Usuário: ${user.name} (${user.role}).`;
  if (activeId) {
    const c = await d.get('clients', activeId);
    if (c) {
      const [ctx] = await d.list('client_contexts', { where: { client_id: c.id }, orderBy: 'version', desc: true, limit: 1 });
      const [diag] = await d.list('diagnoses', { where: { client_id: c.id }, orderBy: 'created_at', desc: true, limit: 1 });
      const [kit] = await d.list('brand_kits', { where: { client_id: c.id }, orderBy: 'version', desc: true, limit: 1 });
      context += ` Cliente ativo: ${c.company || c.contact_name} (${c.segment}). ${c.who_is || ''}`;
      if (ctx) context += ` Contexto: ${JSON.stringify(ctx.blocks)}.`;
      if (diag) context += ` Diagnóstico: ${diag.summary}.`;
      if (kit) context += ` Marca: ${JSON.stringify({ strategy: kit.strategy, verbal: kit.verbal, tokens: kit.tokens })}.`;
    }
  }

  if (!hasAIKey()) {
    const text = `[exemplo] A chave da API da Anthropic ainda não foi configurada em Configurações → Integrações.\n\nQuando estiver ligada, respondo aqui com o contexto da tela (${screen})${activeId ? ' e do cliente ativo' : ''}: legendas, ganchos, roteiros, resumos e próximos passos, prontos para copiar.`;
    return new NextResponse(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const stream = await streamChat(PROMPTS.assistant(screen, context), messages.slice(-12));
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') controller.enqueue(encoder.encode(ev.delta.text));
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n[erro] ${(e as Error).message}`));
      } finally {
        controller.close();
      }
    },
  });
  return new NextResponse(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' } });
}
