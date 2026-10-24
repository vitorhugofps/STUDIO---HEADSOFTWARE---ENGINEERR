import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseEnv } from '@/lib/config';
import type { DB, ListOptions } from './types';

/** Cliente Supabase ligado aos cookies da requisição (sessão do usuário). */
export async function supabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const { url, anon } = supabaseEnv();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet: { name: string; value: string; options?: any }[]) {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* chamado a partir de um Server Component: o middleware renova a sessão */
        }
      },
    },
  });
}

export function supabaseDB(client: SupabaseClient): DB {
  return {
    mode: 'supabase',
    async list(table, opts) {
      const o = (opts || {}) as ListOptions<Record<string, unknown>>;
      let q = client.from(table).select('*');
      if (o.where) {
        for (const [k, v] of Object.entries(o.where)) {
          if (v === undefined) continue;
          q = Array.isArray(v) ? q.in(k, v as any[]) : v === null ? q.is(k, null) : q.eq(k, v as any);
        }
      }
      if (o.orderBy) q = q.order(o.orderBy, { ascending: !o.desc, nullsFirst: false });
      if (o.limit) q = q.limit(o.limit);
      const { data, error } = await q;
      if (error) throw new Error(`[supabase] ${table}: ${error.message}`);
      return (data || []) as any;
    },
    async get(table, id) {
      const { data, error } = await client.from(table).select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(`[supabase] ${table}: ${error.message}`);
      return (data as any) || null;
    },
    async insert(table, row) {
      const { data, error } = await client.from(table).insert(row as any).select('*').single();
      if (error) throw new Error(`[supabase] insert ${table}: ${error.message}`);
      return data as any;
    },
    async update(table, id, patch) {
      const { data, error } = await client
        .from(table)
        .update({ ...(patch as any), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new Error(`[supabase] update ${table}: ${error.message}`);
      return data as any;
    },
    async remove(table, id) {
      const { error } = await client.from(table).delete().eq('id', id);
      if (error) throw new Error(`[supabase] delete ${table}: ${error.message}`);
    },
  };
}
