'use client';

import { useCallback, useRef, useState } from 'react';
import { UploadCloud, FileVideo, FileImage, FileText, File as FileIcon, X, Link2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { FILES_BUCKET, uploadKey } from '@/lib/file-keys';
import { Button, Input } from './primitives';

type Uploaded = { id: string; name: string; url: string; kind: string; size: number };

/**
 * Com as variáveis públicas do Supabase no build, o navegador envia o arquivo direto ao Storage
 * (bucket "files") e só avisa o servidor para registrar o asset: a Vercel recusa corpo acima de 4,5 MB
 * nas funções. Sem elas (app desktop, modo local), o arquivo segue por /api/upload como antes.
 */
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const DIRECT = Boolean(SB_URL && SB_ANON);

let browserSb: ReturnType<typeof createBrowserClient> | null = null;
const sbBrowser = () => (browserSb ||= createBrowserClient(SB_URL, SB_ANON));

/** Token da sessão no navegador. Null se não houver sessão: aí o envio cai no caminho pelo servidor. */
async function accessToken() {
  try {
    const { data } = await sbBrowser().auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

function storageError(status: number, body: string) {
  let msg = body;
  try {
    msg = (JSON.parse(body) as { message?: string }).message || body;
  } catch {
    /* corpo não é JSON */
  }
  if (status === 413 || /maximum allowed size|exceeded/i.test(msg)) return 'Arquivo maior que o limite do armazenamento. Use o link do Google Drive.';
  if (status === 401 || status === 403) return 'Sessão expirada ou sem permissão. Entre de novo e tente outra vez.';
  return msg || `Falha no upload (${status})`;
}

/** Envio pelo servidor (multipart para /api/upload), com progresso. */
function sendViaServer(f: File, fields: Record<string, string | undefined>, onPct: (pct: number) => void) {
  return new Promise<Uploaded>((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', f);
    for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(xhr.responseText || 'Falha no upload')));
    xhr.onerror = () => reject(new Error('Falha de rede no upload'));
    xhr.send(fd);
  });
}

/** Envio direto ao Supabase Storage (XHR para ter progresso) e registro do asset no servidor. */
async function sendDirect(f: File, token: string, fields: { client_id?: string; project_id?: string; kind: string }, onPct: (pct: number) => void) {
  const key = uploadKey(fields.client_id, f.name);
  const mime = f.type || 'application/octet-stream';
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SB_URL}/storage/v1/object/${FILES_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', SB_ANON);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.setRequestHeader('cache-control', 'max-age=3600');
    xhr.setRequestHeader('content-type', mime);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(storageError(xhr.status, xhr.responseText))));
    xhr.onerror = () => reject(new Error('Falha de rede no upload'));
    xhr.send(f);
  });
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stored: true, path: key, name: f.name, mime, size: f.size, ...fields }),
  });
  if (!res.ok) {
    // Não deixa o arquivo órfão no bucket se o registro falhou.
    sbBrowser().storage.from(FILES_BUCKET).remove([key]).catch(() => {});
    throw new Error((await res.text()) || 'Falha ao registrar o arquivo');
  }
  return (await res.json()) as Uploaded;
}

export function Dropzone({
  clientId,
  projectId,
  kind = 'arquivo',
  onUploaded,
  compact,
  accept,
  allowLinks = true,
}: {
  clientId?: string;
  projectId?: string;
  kind?: string;
  onUploaded?: (files: Uploaded[]) => void;
  compact?: boolean;
  accept?: string;
  allowLinks?: boolean;
}) {
  const [drag, setDrag] = useState(false);
  const [queue, setQueue] = useState<{ name: string; pct: number; done?: boolean; error?: string }[]>([]);
  const [link, setLink] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const results: Uploaded[] = [];
      for (const f of list) {
        setQueue((q) => [...q, { name: f.name, pct: 0 }]);
        const onPct = (pct: number) => setQueue((q) => q.map((it) => (it.name === f.name ? { ...it, pct } : it)));
        try {
          const token = DIRECT ? await accessToken() : null;
          const res = token ? await sendDirect(f, token, { client_id: clientId, project_id: projectId, kind }, onPct) : await sendViaServer(f, { client_id: clientId, project_id: projectId, kind }, onPct);
          results.push(res);
          setQueue((q) => q.map((it) => (it.name === f.name ? { ...it, pct: 100, done: true } : it)));
        } catch (e) {
          setQueue((q) => q.map((it) => (it.name === f.name ? { ...it, error: (e as Error).message } : it)));
          toast.error(`Não foi possível enviar ${f.name}`);
        }
      }
      if (results.length) {
        onUploaded?.(results);
        router.refresh();
        setTimeout(() => setQueue((q) => q.filter((it) => !it.done)), 1500);
      }
    },
    [clientId, projectId, kind, onUploaded, router],
  );

  async function addLink() {
    if (!link.trim()) return;
    const res = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ link: link.trim(), client_id: clientId, project_id: projectId, kind }) });
    if (!res.ok) return toast.error('Não foi possível salvar o link');
    const data = (await res.json()) as Uploaded;
    onUploaded?.([data]);
    setLink('');
    toast.success('Link adicionado');
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        className={cn(
          'focus-ring grid cursor-pointer place-items-center rounded-2xl border border-dashed border-white/[0.14] bg-white/[0.02] text-center transition-colors hover:border-accent/50 hover:bg-accent/[0.03]',
          drag && 'border-accent bg-accent/[0.06]',
          compact ? 'px-4 py-6' : 'px-6 py-12',
        )}
      >
        <input ref={inputRef} type="file" multiple accept={accept} className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
        <UploadCloud className={cn('mb-2 text-accent', compact ? 'h-5 w-5' : 'h-7 w-7')} />
        <div className="text-sm font-medium text-ink">Arraste e solte logos, fotos, vídeos, PDFs e áudios</div>
        <div className="mt-1 text-xs text-ink3">ou clique para escolher. Vídeos grandes: use o link do Google Drive abaixo.</div>
      </div>
      {allowLinks && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink3" />
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Cole um link do Google Drive, YouTube ou pasta" className="pl-9" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLink())} />
          </div>
          <Button variant="subtle" onClick={addLink}>
            Adicionar link
          </Button>
        </div>
      )}
      {queue.length > 0 && (
        <ul className="space-y-1.5">
          {queue.map((q) => (
            <li key={q.name} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2 text-xs">
              <FileIcon className="h-3.5 w-3.5 text-ink3" />
              <span className="flex-1 truncate text-ink">{q.name}</span>
              {q.error ? <span className="text-err">{q.error}</span> : <span className="num text-ink2">{q.pct}%</span>}
              {q.done && <span className="text-ok">ok</span>}
              <button onClick={() => setQueue((x) => x.filter((i) => i !== q))} aria-label="Remover">
                <X className="h-3 w-3 text-ink3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FileKindIcon({ mime, className }: { mime?: string | null; className?: string }) {
  const c = cn('h-4 w-4', className);
  if (mime?.startsWith('video')) return <FileVideo className={c} />;
  if (mime?.startsWith('image')) return <FileImage className={c} />;
  if (mime?.includes('pdf') || mime?.startsWith('text')) return <FileText className={c} />;
  return <FileIcon className={c} />;
}
