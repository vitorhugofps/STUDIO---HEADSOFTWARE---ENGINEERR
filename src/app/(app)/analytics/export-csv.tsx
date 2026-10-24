'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/primitives';

/**
 * Baixa uma tabela como CSV direto do navegador (data URL, sem rota nem arquivo no servidor).
 * Separador ponto e vírgula e BOM em UTF-8: o Excel em português abre com acentos e colunas certos.
 */
export function ExportCsv({ filename, rows, label = 'Exportar CSV' }: { filename: string; rows: string[][]; label?: string }) {
  const empty = rows.length < 2;

  function download() {
    const esc = (v: string) => (/[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <Button variant="glass" size="sm" onClick={download} disabled={empty} title={empty ? 'Sem dados para exportar' : undefined}>
      <Download className="h-4 w-4" /> {label}
    </Button>
  );
}
