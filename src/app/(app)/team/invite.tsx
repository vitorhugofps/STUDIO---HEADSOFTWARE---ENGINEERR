'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { CopyButton, Modal } from '@/components/ui/client';
import { Badge, Button } from '@/components/ui/primitives';

const METADATA = `{
  "username": "NOME",
  "full_name": "Nome Completo",
  "role": "editor",
  "title": "Video Editor"
}`;

/**
 * Convidar não cria ninguém aqui: o acesso nasce no Supabase Auth.
 * O modal só explica o caminho, com o domínio de e-mail e o JSON prontos para copiar.
 */
export function InviteButton({ domain, supabase, roles }: { domain: string; supabase: boolean; roles: { key: string; label: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" /> Convidar
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Convidar para o Studio">
        <div className="space-y-5">
          <p className="text-sm text-ink2">O acesso nasce no Supabase. Esta tela não cria usuário e não envia e-mail.</p>

          {!supabase && (
            <div className="flex items-start gap-3 rounded-2xl bg-white/[0.04] p-4 text-sm text-ink2">
              <Badge tone="warn">modo local</Badge>
              <span>Este ambiente usa o banco local, só com o time do seed. Conecte o Supabase em Settings, Integrações, para criar pessoas novas.</span>
            </div>
          )}

          <ol className="space-y-4 text-sm text-ink2">
            <li className="flex gap-3">
              <span className="num w-5 shrink-0 text-ink3">1</span>
              <span>
                No painel do Supabase, abra <span className="text-ink">Authentication</span>, depois <span className="text-ink">Users</span>, e clique em <span className="text-ink">Add user</span>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="num w-5 shrink-0 text-ink3">2</span>
              <span className="min-w-0">
                Use o e-mail <span className="break-all font-mono text-[12px] text-ink">usuario@{domain}</span>. O usuário que a pessoa digita no login é a parte antes do @.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="num w-5 shrink-0 text-ink3">3</span>
              <span>
                Defina uma senha provisória e marque <span className="text-ink">Auto Confirm User</span>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="num w-5 shrink-0 text-ink3">4</span>
              <span className="min-w-0 flex-1">
                Em <span className="text-ink">User Metadata</span>, cole o JSON abaixo. O perfil nasce sozinho. Sem ele, o papel padrão é comercial.
              </span>
            </li>
          </ol>

          <div>
            <pre className="whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3 font-mono text-[12px] leading-relaxed text-ink2">{METADATA}</pre>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {roles.map((r) => (
                  <Badge key={r.key}>
                    <span className="font-mono">{r.key}</span>
                  </Badge>
                ))}
              </div>
              <CopyButton text={METADATA} label="Copiar JSON" />
            </div>
          </div>

          <div className="flex gap-3 text-sm text-ink2">
            <span className="num w-5 shrink-0 text-ink3">5</span>
            <span>A pessoa entra com usuário e senha provisória e troca a senha na página User.</span>
          </div>

          <div className="flex justify-end">
            <Button variant="subtle" onClick={() => setOpen(false)}>
              Entendi
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
