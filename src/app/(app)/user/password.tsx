'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { Button, Field, Input } from '@/components/ui/primitives';
import { changePasswordAction } from '@/lib/actions/settings';

const MIN = 8;

/** Troca de senha. O navegador confere o básico; o servidor confere de novo e valida a senha atual. */
export function PasswordForm() {
  const [show, setShow] = useState(false);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const type = show ? 'text' : 'password';
  const short = nova.length > 0 && nova.length < MIN;
  const mismatch = confirmar.length > 0 && nova !== confirmar;

  return (
    <ActionForm
      className="space-y-3"
      success="Senha alterada"
      action={async (fd) => {
        if (nova.length < MIN) return { ok: false as const, error: `A nova senha precisa de pelo menos ${MIN} caracteres.` };
        if (nova !== confirmar) return { ok: false as const, error: 'A confirmação não confere com a nova senha.' };
        const r = await changePasswordAction(fd);
        if (r.ok) {
          setAtual('');
          setNova('');
          setConfirmar('');
          setShow(false);
        }
        return r;
      }}
    >
      <Field label="Senha atual" required>
        <Input type={type} name="atual" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" required />
      </Field>
      <Field label="Nova senha" required hint={`Pelo menos ${MIN} caracteres.`} error={short ? `Faltam ${MIN - nova.length} caracteres.` : undefined}>
        <Input type={type} name="nova" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" minLength={MIN} required />
      </Field>
      <Field label="Confirmar nova senha" required error={mismatch ? 'A confirmação não confere.' : undefined}>
        <Input type={type} name="confirmar" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" required />
      </Field>
      <div className="flex items-center justify-between gap-3 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setShow((s) => !s)} aria-pressed={show}>
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {show ? 'Ocultar' : 'Mostrar'}
        </Button>
        <SubmitButton>Trocar senha</SubmitButton>
      </div>
    </ActionForm>
  );
}
