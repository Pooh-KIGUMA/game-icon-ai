import { supabaseAdmin, requireUser } from './_lib/supabase.js';

const PLANS = {
  free: { monthlyCredits: 10, priceJPY: 0, ads: true, videoAds: true },
  standard: { monthlyCredits: 60, priceJPY: 540, ads: true, videoAds: false },
  pro: { monthlyCredits: 180, priceJPY: 1620, ads: false, videoAds: false }
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const user = await requireUser(req);
    const admin = supabaseAdmin();
    let { data: account, error } = await admin.from('iconia_accounts').select('user_id,plan,credits,period_start').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (!account) {
      const created = await admin.from('iconia_accounts').insert({ user_id: user.id, plan: 'free', credits: 10 }).select('user_id,plan,credits,period_start').single();
      if (created.error) throw created.error;
      account = created.data;
    }
    if (req.method === 'GET') return res.status(200).json({ plan: account.plan, credits: account.credits, ...(PLANS[account.plan] || PLANS.free) });

    const action = String(req.body?.action || 'consume');
    if (action === 'consume') {
      const { data, error: rpcError } = await admin.rpc('consume_iconia_credit_for_user', { p_user_id: user.id });
      if (rpcError) throw rpcError;
      if (!data?.[0]) return res.status(402).json({ error: 'NO_CREDITS', message: 'No credits remaining.' });
      return res.status(200).json({ plan: data[0].plan, credits: data[0].credits, ...(PLANS[data[0].plan] || PLANS.free) });
    }
    if (action === 'refund') {
      const { data, error: rpcError } = await admin.rpc('refund_iconia_credit_for_user', { p_user_id: user.id });
      if (rpcError) throw rpcError;
      return res.status(200).json({ credits: data });
    }
    if (action === 'grant_ad') {
      const { data, error: rpcError } = await admin.rpc('grant_iconia_ad_reward_for_user', { p_user_id: user.id });
      if (rpcError) throw rpcError;
      if (data === null || data === undefined) return res.status(403).json({ error: 'AD_REWARD_UNAVAILABLE' });
      return res.status(200).json({ plan: 'free', credits: data, reward: 3 });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(e.status || 503).json({ error: e.message || 'CREDITS_SERVICE_UNAVAILABLE' });
  }
}
