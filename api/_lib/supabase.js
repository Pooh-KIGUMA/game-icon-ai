import { createClient } from '@supabase/supabase-js';

export function supabasePublic() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw new Error('SUPABASE_CONFIG_MISSING');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
}

export function supabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_ADMIN_CONFIG_MISSING');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
}

export function bearer(req) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

export async function requireUser(req) {
  const token = bearer(req);
  if (!token) { const e = new Error('AUTH_REQUIRED'); e.status = 401; throw e; }
  const { data, error } = await supabasePublic().auth.getUser(token);
  if (error || !data?.user) { const e = new Error('AUTH_INVALID'); e.status = 401; throw e; }
  return data.user;
}
