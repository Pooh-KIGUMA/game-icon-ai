const PLANS = {
  free: { monthlyCredits: 10, priceJPY: 0 },
  standard: { monthlyCredits: 30, priceJPY: 540 },
  pro: { monthlyCredits: 120, priceJPY: 1620 }
};
const PACKS = { 5: 150, 10: 280, 20: 500, 30: 690, 60: 1200, 120: 2160 };
const json = (res, status, body) => res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
function token(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim(); }
async function auth(req) {
  const t = token(req), url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!t || !url || !key) return null;
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${t}` } });
  return r.ok ? r.json() : null;
}
async function callRpc(name, userId) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_NOT_CONFIGURED');
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_user_id: userId }) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) return json(res,405,{error:'METHOD_NOT_ALLOWED'});
  const user = await auth(req);
  if (!user?.id) return json(res,401,{error:'AUTHENTICATION_REQUIRED'});
  try {
    if (req.method === 'GET') {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceKey) throw new Error('SUPABASE_NOT_CONFIGURED');
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=plan,credits,purchased_credits`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
      if (!r.ok) throw new Error(await r.text());
      const row = (await r.json())[0] || { plan:'free', credits:10, purchased_credits:0 };
      const plan = PLANS[row.plan] || PLANS.free;
      return json(res,200,{plan:row.plan,credits:Number(row.credits||0),purchasedCredits:Number(row.purchased_credits||0),packs:PACKS,...plan});
    }
    const action = String(req.body?.action || 'consume');
    if (action === 'consume') {
      const result = await callRpc('iconia_consume_credit', user.id);
      if (!result?.[0]) return json(res,402,{error:'NO_CREDITS',message:'クレジットがありません。'});
      return json(res,200,{...result[0],consumed:1});
    }
    if (action === 'refund') { const r = await callRpc('iconia_refund_credit',user.id); return json(res,200,r[0] || {}); }
    if (action === 'grant_ad') { const r = await callRpc('iconia_grant_ad_credit',user.id); return json(res,200,r[0] || {}); }
    return json(res,400,{error:'UNKNOWN_ACTION'});
  } catch (e) { console.error('Iconia credits error',e); return json(res,503,{error:'CREDITS_SERVICE_UNAVAILABLE'}); }
}
