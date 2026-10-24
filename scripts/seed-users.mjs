// Cria os 4 usuários do time no Supabase Auth usando a service role key.
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-users.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const DOMAIN = 'headsoftware.studioimpacto.com.br';
const PASSWORD = process.env.IHS_DEFAULT_PASSWORD || 'impacto2026';
const TEAM = [
  { username: 'VITOR', full_name: 'Vitor Filgueiras', role: 'admin', title: 'Head de Marketing e Engenharia' },
  { username: 'MARCOS', full_name: 'Marcos', role: 'developer', title: 'System Developer' },
  { username: 'PEDROPAULO', full_name: 'Pedro Paulo', role: 'comercial', title: 'Sales' },
  { username: 'YURI', full_name: 'Yuri', role: 'editor', title: 'Video Editor' },
];
for (const t of TEAM) {
  const email = `${t.username.toLowerCase()}@${DOMAIN}`;
  const { data, error } = await sb.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: t });
  if (error) console.warn(t.username, '→', error.message);
  else console.log(t.username, 'criado', data.user.id);
}
