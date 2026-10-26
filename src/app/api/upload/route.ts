import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { isSupabaseMode } from '@/lib/config';
import { isUploadKey, uploadFolder, uploadKey } from '@/lib/file-keys';
import { fileUrl, putFile, statFile } from '@/lib/storage';

export const runtime = 'nodejs';

function kindFromMime(mime: string, name: string) {
  if (mime.startsWith('video')) return 'video_bruto';
  if (mime.startsWith('image')) return /logo/i.test(name) || /\.(svg|ai|eps)$/i.test(name) ? 'logo' : 'foto';
  if (mime.startsWith('audio')) return 'audio';
  if (/pdf/.test(mime) && /manual|brand|marca/i.test(name)) return 'manual';
  return 'documento';
}

/** `kind` vindo do formulário: "arquivo" (padrão do Dropzone) deixa o servidor decidir pelo tipo. */
const pickKind = (kind: unknown, mime: string, name: string) => (typeof kind === 'string' && kind && kind !== 'arquivo' ? kind : kindFromMime(mime, name));

type JsonBody = {
  link?: string;
  stored?: boolean;
  path?: string;
  name?: string;
  mime?: string;
  size?: number;
  client_id?: string;
  project_id?: string;
  kind?: string;
};

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });
  const d = await db();
  const ct = req.headers.get('content-type') || '';

  if (ct.includes('application/json')) {
    const body = (await req.json()) as JsonBody;

    // Upload direto: o navegador já mandou o arquivo para o Supabase Storage (a Vercel recusa corpo
    // acima de 4,5 MB). Aqui só confirmamos que o objeto existe e registramos o asset.
    if (body.stored) {
      if (!isSupabaseMode()) return new NextResponse('Upload direto só existe no modo Supabase', { status: 400 });
      const clientId = body.client_id || null;
      if (!isUploadKey(body.path) || body.path.split('/')[1] !== uploadFolder(clientId)) return new NextResponse('Caminho inválido', { status: 400 });
      const stat = await statFile(body.path);
      if (!stat) return new NextResponse('Arquivo não encontrado no armazenamento', { status: 400 });
      const name = String(body.name || body.path.split('/').pop()).slice(0, 200);
      const mime = stat.mime || body.mime || 'application/octet-stream';
      const asset = await d.insert('assets', {
        client_id: clientId,
        project_id: body.project_id || null,
        kind: pickKind(body.kind, mime, name),
        name,
        path: body.path,
        url: fileUrl(body.path),
        mime,
        size_bytes: stat.size,
        source: 'upload',
        created_by: user.id,
        tags: [],
      } as any);
      return NextResponse.json({ id: asset.id, name: asset.name, url: asset.url, kind: asset.kind, size: stat.size });
    }

    if (!body.link) return new NextResponse('Link vazio', { status: 400 });
    const isDrive = /drive\.google|docs\.google/.test(body.link);
    const isVideo = /youtube|youtu\.be|vimeo/.test(body.link);
    const asset = await d.insert('assets', {
      client_id: body.client_id || null,
      project_id: body.project_id || null,
      kind: isDrive ? 'drive_link' : isVideo ? 'referencia' : body.kind || 'link',
      name: body.link.replace(/^https?:\/\//, '').slice(0, 80),
      url: body.link,
      mime: 'text/uri-list',
      source: isDrive ? 'google_drive' : 'link',
      created_by: user.id,
      tags: [isDrive ? 'Drive' : 'Link'],
    } as any);
    return NextResponse.json({ id: asset.id, name: asset.name, url: asset.url, kind: asset.kind, size: 0 });
  }

  const fd = await req.formData();
  const file = fd.get('file') as File | null;
  if (!file) return new NextResponse('Arquivo ausente', { status: 400 });
  const clientId = (fd.get('client_id') as string) || null;
  const projectId = (fd.get('project_id') as string) || null;
  const mime = file.type || 'application/octet-stream';
  const buf = Buffer.from(await file.arrayBuffer());

  let stored: { path: string; url: string };
  try {
    stored = await putFile(uploadKey(clientId, file.name), buf, mime);
  } catch (e) {
    return new NextResponse((e as Error).message, { status: 500 });
  }
  const asset = await d.insert('assets', {
    client_id: clientId,
    project_id: projectId,
    kind: pickKind(fd.get('kind'), mime, file.name),
    name: file.name,
    path: stored.path,
    url: stored.url,
    mime,
    size_bytes: buf.length,
    source: 'upload',
    created_by: user.id,
    tags: [],
  } as any);
  return NextResponse.json({ id: asset.id, name: asset.name, url: asset.url, kind: asset.kind, size: buf.length });
}
