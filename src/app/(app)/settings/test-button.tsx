'use client';

import { useState, useTransition } from 'react';
import { Loader2, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { testIntegrationAction, type Provider } from '@/lib/actions/integrations';
import { cn } from '@/lib/utils';

/** Botão "Testar conexão": faz uma chamada real ao provedor com o token salvo e mostra o resultado. */
export function IntegrationTest({ provider, disabled }: { provider: Provider; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || pending}
        onClick={() =>
          start(async () => {
            setResult(null);
            setResult(await testIntegrationAction(provider));
          })
        }
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
        {pending ? 'Testando…' : 'Testar conexão'}
      </Button>
      {result && (
        <p className={cn('rounded-xl px-3 py-2 text-xs leading-relaxed', result.ok ? 'bg-ok/10 text-ok' : 'bg-err/10 text-err')} role="status">
          {result.detail}
        </p>
      )}
    </div>
  );
}
