import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '@/lib/config';
import { uid } from '@/lib/utils';
import { TABLES, type DB, type ListOptions, type TableName, type Tables } from './types';

/**
 * Banco local em JSON (.data/db.json). Usado quando o Supabase não está configurado
 * ou para rodar o app sem internet. Em ambientes somente leitura (Vercel) fica em memória.
 */

type Store = { [K in TableName]: Tables[K][] };

const g = globalThis as unknown as { __ihsStore?: Store; __ihsDirty?: boolean };

function emptyStore(): Store {
  return Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Store;
}

function filePath() {
  return path.join(dataDir(), 'db.json');
}

function load(): Store {
  if (g.__ihsStore) return g.__ihsStore;
  let store = emptyStore();
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Store>;
    store = { ...store, ...parsed } as Store;
  } catch {
    /* primeiro uso */
  }
  g.__ihsStore = store;
  return store;
}

let timer: NodeJS.Timeout | null = null;
function persist() {
  if (process.env.VERCEL) return;
  g.__ihsDirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      const tmp = filePath() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(g.__ihsStore));
      fs.renameSync(tmp, filePath());
      g.__ihsDirty = false;
    } catch {
      /* ignore */
    }
  }, 150);
}

function matches(row: Record<string, unknown>, where?: Record<string, unknown>) {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (Array.isArray(v)) return v.includes(row[k]);
    return row[k] === v;
  });
}

export const localDB: DB = {
  mode: 'local',
  async list(table, opts) {
    const o = (opts || {}) as ListOptions<Record<string, unknown>>;
    let rows = (load()[table] as unknown as Record<string, unknown>[]).filter((r) => matches(r, o.where));
    if (o.orderBy) {
      const key = o.orderBy;
      rows = [...rows].sort((a, b) => {
        const av = a[key] as any;
        const bv = b[key] as any;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? -1 : av > bv ? 1 : 0;
      });
      if (o.desc) rows.reverse();
    }
    if (o.limit) rows = rows.slice(0, o.limit);
    return rows as any;
  },
  async get(table, id) {
    return ((load()[table] as any[]).find((r) => r.id === id) as any) || null;
  },
  async insert(table, row) {
    const now = new Date().toISOString();
    const full = { id: (row as any).id || uid(), created_at: now, updated_at: now, ...row } as any;
    (load()[table] as any[]).push(full);
    persist();
    return full;
  },
  async update(table, id, patch) {
    const rows = load()[table] as any[];
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) throw new Error(`Registro não encontrado em ${table}: ${id}`);
    rows[i] = { ...rows[i], ...patch, updated_at: new Date().toISOString() };
    persist();
    return rows[i];
  },
  async remove(table, id) {
    const rows = load()[table] as any[];
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows.splice(i, 1);
    persist();
  },
};

export function localStoreIsEmpty() {
  return load().clients.length === 0;
}
