'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui/primitives';

/**
 * Erro dentro do app. O menu lateral e o topo continuam de pé; só a tela cai.
 * Mostramos apenas o código (digest). A mensagem real fica no log do servidor.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-10">
      <EmptyState
        icon={<TriangleAlert className="h-5 w-5" />}
        title="Algo travou aqui"
        text={
          <>
            A tela não carregou. Tente de novo. Se repetir, mande o código abaixo para o time.
            {error.digest && (
              <span className="mt-3 block font-mono text-[12px] text-ink3">
                Código: <span className="select-all text-ink2">{error.digest}</span>
              </span>
            )}
          </>
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => reset()}>Tentar de novo</Button>
            <Button href="/" variant="ghost">
              Voltar ao início
            </Button>
          </div>
        }
      />
    </div>
  );
}
