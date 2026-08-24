import originalHandler from './generate.js';
import { requireUser, supabaseAdmin } from './_lib/supabase.js';

async function consume(userId) {
  const admin = supabaseAdmin();
  let { data: account } = await admin.from('iconia_accounts').select('plan,credits').eq('user_id', userId).maybeSingle();
  if (!account) {
    const created = await admin.from('iconia_accounts').insert({ user_id: userId, plan: 'free', credits: 10 }).select('plan,credits').single();
    if (created.error) throw created.error;
    account = created.data;
  }
  const { data, error } = await admin.rpc('consume_iconia_credit_for_user', { p_user_id: userId });
  if (error) throw error;
  if (!data?.[0]) { const e = new Error('NO_CREDITS'); e.status = 402; throw e; }
  return data[0];
}

async function refund(userId) {
  try { await supabaseAdmin().rpc('refund_iconia_credit_for_user', { p_user_id: userId }); } catch (e) { console.error('credit refund failed', e); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let user;
  try { user = await requireUser(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message || 'AUTH_REQUIRED' }); }
  let charged = false;
  try {
    await consume(user.id);
    charged = true;
    let originalJson = res.json.bind(res);
    let status = 200;
    const originalStatus = res.status.bind(res);
    res.status = (code) => { status = code; return originalStatus(code); };
    const result = await originalHandler(req, res);
    if (status >= 400 && charged) await refund(user.id);
    return result;
  } catch (e) {
    if (charged) await refund(user.id);
    const status = e.status || (e.message === 'NO_CREDITS' ? 402 : 503);
    return res.status(status).json({ error: e.message || 'GENERATION_FAILED' });
  }
}
