import { supabaseAdmin, requireUser } from './_lib/supabase.js';

const PLANS = {
  free: { monthlyCredits: 10, priceJPY: 0, ads: true, videoAds: true },
  standard: { monthlyCredits: 60, priceJPY: 540, ads: true, videoAds: false },
  pro: { monthlyCredits: 180, priceJPY: 1620, ads: false, videoAds: false }
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const user = await requireUser(req);
    const admin = supabaseAdmin();
    let { data: account, error } = await admin.from('profiles').select('id,plan,credits,monthly_credits,billing_period_start,billing_period_end,stripe_customer_id,stripe_subscription_id').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (!account) {
      const created = await admin.from('profiles').insert({ id: user.id }).select('id,plan,credits,monthly_credits,billing_period_start,billing_period_end,stripe_customer_id,stripe_subscription_id').single();
      if (created.error) throw created.error;
      account = created.data;
    }
    const plan = PLANS[account.plan] || PLANS.free;
    return res.status(200).json({ user: { id: user.id, email: user.email }, account: { user_id: account.id, ...account, ...plan } });
  } catch (e) {
    return res.status(e.status || 503).json({ error: e.message || 'ACCOUNT_SERVICE_UNAVAILABLE' });
  }
}
