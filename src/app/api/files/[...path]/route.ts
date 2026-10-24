import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '@/lib/config';

export const runtime = 'nodejs';

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.json': 'application/json',
};

export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const rel = parts.join('/');
  if (rel.includes('..')) return new NextResponse('Caminho inválido', { status: 400 });
  const abs = path.join(dataDir(), rel);
  if (!fs.existsSync(abs)) return new NextResponse('Não encontrado', { status: 404 });
  const stat = fs.statSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const stream = fs.createReadStream(abs);
  return new NextResponse(stream as any, {
    headers: { 'content-type': MIME[ext] || 'application/octet-stream', 'content-length': String(stat.size), 'cache-control': 'private, max-age=3600' },
  });
}
