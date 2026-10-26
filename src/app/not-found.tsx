import { Button } from '@/components/ui/primitives';

/** 404 global. Tela de entrada: é o único lugar do arquivo com névoa. */
export default function NotFound() {
  return (
    <main className="nevoa relative grid min-h-screen place-items-center overflow-hidden p-6">
      <div className="relative z-10 w-full max-w-[460px]">
        <div className="mb-10 flex items-center gap-3">
          <span className="relative grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-black/50">
            <span className="h-3 w-3 rounded-full bg-accent" />
          </span>
          <div className="leading-none">
            <div className="display text-[22px] text-ink">Impacto</div>
            <div className="label mt-1">Sistema do Studio Impacto</div>
          </div>
        </div>

        <div className="label mb-3">Erro 404</div>
        <h1 className="display twotone text-[52px] leading-[0.92] text-ink">
          Esse ponto
          <br />
          <em>não existe.</em>
        </h1>
        <p className="mt-4 max-w-sm text-sm text-ink2">O endereço mudou, foi apagado ou nunca existiu. Volte ao início e siga de lá.</p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button href="/" size="lg">
            Voltar ao início
          </Button>
          <Button href="/clientes" variant="ghost" size="lg">
            Ir para Clientes
          </Button>
        </div>
      </div>
    </main>
  );
}
