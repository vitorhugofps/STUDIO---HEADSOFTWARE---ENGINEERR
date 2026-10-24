'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { Drawer } from '@/components/ui/client';
import { Button, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

type Msg = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = ['3 ganchos para um Reel deste cliente', 'Resuma a situação deste cliente em 5 linhas', 'Legenda na fórmula Cena, Corte, Chamada', 'O que falta para publicar o lote do feed?'];

export function AssistantPanel({ open, onClose, screen, clientName, aiEnabled }: { open: boolean; onClose: () => void; screen: string; clientName?: string; aiEnabled: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const next = [...msgs, { role: 'user', content } as Msg];
    setMsgs(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: next, screen }) });
      if (!res.body) throw new Error('Sem resposta');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      setMsgs([...next, { role: 'assistant', content: '' }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs([...next, { role: 'assistant', content: acc }]);
      }
    } catch (e) {
      setMsgs([...next, { role: 'assistant', content: `Não consegui responder agora: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-accent" /> Assistente
        </span>
      }
    >
      <p className="mb-4 text-xs text-ink3">
        Contexto: <span className="text-ink2">{screen}</span>
        {clientName && (
          <>
            {' '}· cliente <span className="text-ink2">{clientName}</span>
          </>
        )}
        {!aiEnabled && <span className="ml-2 rounded-full bg-warn/15 px-2 py-0.5 text-warn">sem chave da IA</span>}
      </p>
      <div className="mb-3 flex min-h-[40vh] flex-col gap-3">
        {msgs.length === 0 && (
          <div className="grid gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="press rounded-xl border border-white/10 px-3 py-2 text-left text-[13px] text-ink2 hover:border-accent/40 hover:text-ink">
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn('max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed', m.role === 'user' ? 'ml-auto bg-accent text-black' : 'bg-white/[0.06] text-ink')}>
            {m.content || <span className="dot dot-rec" />}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Peça uma legenda, um gancho, um resumo…"
          className="min-h-[52px]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button size="icon" onClick={() => send()} disabled={busy} aria-label="Enviar">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </Drawer>
  );
}
