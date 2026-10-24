import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { dataDir } from '@/lib/config';
import { slugify, uid } from '@/lib/utils';

export const runtime = 'nodejs';

function kindFromMime(mime: string, name: string) {
  if (mime.startsWith('video')) return 'video_bruto';
  if (mime.startsWith('image')) return /logo/i.test(name) || /\.(svg|ai|eps)$/i.test(name) ? 'logo' : 'foto';
  if (mime.startsWith('audio')) return 'audio';
  if (/pdf/.test(mime) && /manual|brand|marca/i.test(name)) return 'manual';
  return 'documento';
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });
  const d = await db();
  const ct = req.headers.get('content-type') || '';

  if (ct.includes('application/json')) {
    const body = (await req.json()) as { link: string; client_id?: string; project_id?: string; kind?: string };
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
  const safe = `${Date.now().toString(36)}-${slugify(path.parse(file.name).name).slice(0, 60) || uid().slice(0, 8)}${path.extname(file.name).toLowerCase()}`;
  const rel = path.join('uploads', clientId || 'studio', safe);
  const abs = path.join(dataDir(), rel);

  if (process.env.VERCEL) return new NextResponse('Upload de arquivos indisponível neste ambiente; use link do Google Drive.', { status: 501 });

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(abs, buf);

  const mime = file.type || 'application/octet-stream';
  const asset = await d.insert('assets', {
    client_id: clientId,
    project_id: projectId,
    kind: (fd.get('kind') as string) && fd.get('kind') !== 'arquivo' ? (fd.get('kind') as string) : kindFromMime(mime, file.name),
    name: file.name,
    path: rel,
    url: `/api/files/${rel.split(path.sep).join('/')}`,
    mime,
    size_bytes: buf.length,
    source: 'upload',
    created_by: user.id,
    tags: [],
  } as any);
  return NextResponse.json({ id: asset.id, name: asset.name, url: asset.url, kind: asset.kind, size: buf.length });
}
