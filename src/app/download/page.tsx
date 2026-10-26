import fs from 'node:fs';
import path from 'node:path';

export const metadata = { title: 'Baixar o Impacto' };
export const dynamic = 'force-static';

const FILE = '/download/Impacto-Instalador-Windows.exe';

function sizeLabel() {
  try {
    const b = fs.statSync(path.join(process.cwd(), 'public', FILE)).size;
    return b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
  } catch {
    return '';
  }
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="num grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/15 text-[13px] text-ink">{n}</span>
      <div>
        <div className="text-[15px] font-medium text-ink">{title}</div>
        <div className="mt-1 text-sm leading-relaxed text-ink2">{children}</div>
      </div>
    </li>
  );
}

export default function DownloadPage() {
  const size = sizeLabel();
  return (
    <main className="nevoa relative min-h-screen overflow-hidden px-6 py-16">
      <div className="relative z-10 mx-auto w-full max-w-[880px]">
        <a href="/login" className="mb-12 flex items-center gap-3">
          <span className="relative grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-black/50">
            <span className="h-3 w-3 rounded-full bg-accent shadow-[0_0_24px_rgba(255,91,31,1)]" />
          </span>
          <span className="leading-none">
            <span className="display block text-[22px] text-ink">Impacto</span>
            <span className="label mt-1 block">Sistema do Studio Impacto</span>
          </span>
        </a>

        <h1 className="display twotone text-[56px] leading-[0.92] text-ink">
          Baixar o Impacto
          <br />
          <em>para o seu computador.</em>
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink2">
          O app abre a plataforma do Studio numa janela própria, sem barra de endereço, com o mesmo login, os mesmos dados e a atualização em tempo real.
        </p>

        <section className="glass-strong mt-10 rounded-3xl p-7">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <div className="label">Windows 10 e 11</div>
              <div className="display mt-1 text-3xl text-ink">Instalador do Windows</div>
              <p className="mt-1 text-sm text-ink2">Usa o Microsoft Edge que já vem no Windows. Não pede senha de administrador.{size ? ` ${size}.` : ''}</p>
            </div>
            <a
              href={FILE}
              download
              className="press inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-7 text-[15px] font-medium text-black shadow-[0_8px_30px_-12px_rgba(255,91,31,0.7)] hover:bg-[#ff6b36]"
            >
              Baixar para Windows
            </a>
          </div>
          <div className="hairline my-7" />
          <ol className="space-y-5">
            <Step n={1} title="Abra o arquivo baixado">
              Dê dois cliques em <b className="text-ink">Impacto-Instalador-Windows.exe</b> (na pasta Downloads).
            </Step>
            <Step n={2} title="Se aparecer &quot;O Windows protegeu o computador&quot;">
              Clique em <b className="text-ink">Mais informações</b> e depois em <b className="text-ink">Executar assim mesmo</b>. O aviso aparece porque o instalador ainda não tem assinatura digital paga.
            </Step>
            <Step n={3} title="Pronto">
              O ícone <b className="text-ink">Impacto</b> aparece na Área de Trabalho e no Menu Iniciar, e o app abre sozinho. Entre com seu usuário e senha.
            </Step>
          </ol>
        </section>

        <section className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="card rounded-3xl p-6">
            <div className="label">Sem instalar nada</div>
            <div className="display mt-1 text-2xl text-ink">Pelo navegador</div>
            <p className="mt-2 text-sm leading-relaxed text-ink2">
              No <b className="text-ink">Edge</b>: menu <b className="text-ink">⋯</b> → <b className="text-ink">Apps</b> → <b className="text-ink">Instalar este site como um aplicativo</b>.
              <br />
              No <b className="text-ink">Chrome</b>: menu <b className="text-ink">⋮</b> → <b className="text-ink">Transmitir, salvar e compartilhar</b> → <b className="text-ink">Instalar página como app</b>.
            </p>
            <a href="/login" className="mt-4 inline-block text-sm text-accent underline-offset-4 hover:underline">
              Abrir o Impacto no navegador
            </a>
          </div>
          <div className="card rounded-3xl p-6">
            <div className="label">macOS</div>
            <div className="display mt-1 text-2xl text-ink">No Mac</div>
            <p className="mt-2 text-sm leading-relaxed text-ink2">
              Peça ao Vitor o <b className="text-ink">Impacto.app</b> (Apple Silicon ou Intel). Depois de arrastar para Aplicativos, rode uma vez no Terminal:
            </p>
            <code className="mt-3 block rounded-xl bg-white/[0.05] p-3 font-mono text-[11px] leading-relaxed text-ink2">
              xattr -cr &quot;/Applications/Impacto.app&quot; &amp;&amp; codesign --force --deep --sign - &quot;/Applications/Impacto.app&quot;
            </code>
            <p className="mt-3 text-sm text-ink2">Ou instale pelo Chrome, como no Windows.</p>
          </div>
        </section>

        <p className="mt-10 text-[11px] text-ink3">Studio Impacto · Uberlândia, MG · Dúvidas: (34) 99899-0606</p>
      </div>
    </main>
  );
}
