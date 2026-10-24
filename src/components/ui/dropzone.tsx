'use client';

import { useCallback, useRef, useState } from 'react';
import { UploadCloud, FileVideo, FileImage, FileText, File as FileIcon, X, Link2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button, Input } from './primitives';

type Uploaded = { id: string; name: string; url: string; kind: string; size: number };

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
        try {
          const fd = new FormData();
          fd.append('file', f);
          if (clientId) fd.append('client_id', clientId);
          if (projectId) fd.append('project_id', projectId);
          fd.append('kind', kind);
          const res = await new Promise<Uploaded>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload');
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) setQueue((q) => q.map((it) => (it.name === f.name ? { ...it, pct: Math.round((e.loaded / e.total) * 100) } : it)));
            };
            xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(xhr.responseText || 'Falha no upload')));
            xhr.onerror = () => reject(new Error('Falha de rede no upload'));
            xhr.send(fd);
          });
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
