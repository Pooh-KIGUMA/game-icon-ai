import crypto from 'node:crypto';

const PLANS = {
  free: { monthlyCredits: 3, priceJPY: 0 },
  standard: { monthlyCredits: 30, priceJPY: 540 },
  pro: { monthlyCredits: 120, priceJPY: 1620 }
};
const PACKS = { 5: 150, 10: 280, 20: 500, 30: 690, 60: 1200, 120: 2160 };
const json = (res, status, body) => res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
const cookieName = 'iconia_uid';
function token(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim(); }
function cookie(req, name) {
  const raw = String(req.headers.cookie || '');
  const found = raw.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : '';
}
function secretKey() { return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY; }
function publishableKey() { return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY; }
function cookieSecret() { return process.env.CREDIT_COOKIE_SECRET || secretKey() || 'iconia-credit-secret'; }
function sign(id) { return crypto.createHmac('sha256', cookieSecret()).update(id).digest('hex'); }
function encodeCookie(id) { return `${id}.${sign(id)}`; }
function decodeCookie(value) {
  const m = String(value || '').match(/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i);
  if (!m) return null;
  const expected = sign(m[1]);
  return crypto.timingSafeEqual(Buffer.from(m[2], 'hex'), Buffer.from(expected, 'hex')) ? m[1] : null;
}
function setUserCookie(res, id) {
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(encodeCookie(id))}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
}
function apiHeaders(key, extra = {}) { return { apikey: key, 'Content-Type': 'application/json', ...extra }; }
async function auth(req) {
  const t = token(req), url = process.env.SUPABASE_URL, key = publishableKey();
  if (!t || !url || !key) return null;
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${t}` } });
  return r.ok ? r.json() : null;
}
async function createAnonymousUser() {
  const url = process.env.SUPABASE_URL, key = secretKey();
  if (!url || !key) throw new Error('SUPABASE_NOT_CONFIGURED');
  const email = `anonymous-${crypto.randomUUID()}@iconia-ai.local`;
  const password = crypto.randomBytes(32).toString('hex');
  const headers = apiHeaders(key, { Authorization: `Bearer ${key}` });
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST', headers,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { anonymous: true } })
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).id;
}
async function ensureProfile(userId) {
  const url = process.env.SUPABASE_URL, key = secretKey();
  if (!url || !key) throw new Error('SUPABASE_NOT_CONFIGURED');
  const r = await fetch(`${url}/rest/v1/profiles?on_conflict=id`, {
    method: 'POST',
    headers: apiHeaders(key, { Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify({ id:userId, plan:'free', credits:3, monthly_credits:3, monthly_remaining:3, purchased_credits:0, bonus_credits:0 })
  });
  if (!r.ok && r.status !== 409) throw new Error(await r.text());
}
async function resolveUser(req, res) {
  const loggedIn = await auth(req);
  if (loggedIn?.id) { await ensureProfile(loggedIn.id); return loggedIn.id; }
  const existing = decodeCookie(cookie(req, cookieName));
  if (existing) { await ensureProfile(existing); return existing; }
  const id = await createAnonymousUser();
  await ensureProfile(id);
  setUserCookie(res, id);
  return id;
}
async function callRpc(name, userId) {
  const url = process.env.SUPABASE_URL, key = secretKey();
  if (!url || !key) throw new Error('SUPABASE_NOT_CONFIGURED');
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: apiHeaders(key), body: JSON.stringify({ p_user_id: userId })
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
function rpcRow(result) { return Array.isArray(result) ? (result[0] || null) : (result && typeof result === 'object' ? result : null); }
export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) return json(res,405,{error:'METHOD_NOT_ALLOWED'});
  try {
    const userId = await resolveUser(req, res);
    if (req.method === 'GET') {
      const key = secretKey();
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan,credits,purchased_credits,monthly_remaining,bonus_credits`, { headers: apiHeaders(key) });
      if (!r.ok) throw new Error(await r.text());
      const row = (await r.json())[0] || { plan:'free', credits:3, purchased_credits:0, monthly_remaining:3, bonus_credits:0 };
      const plan = PLANS[row.plan] || PLANS.free;
      return json(res,200,{plan:row.plan,credits:Number(row.credits ?? 3),purchasedCredits:Number(row.purchased_credits ?? 0),monthlyRemaining:Number(row.monthly_remaining ?? 0),bonusCredits:Number(row.bonus_credits ?? 0),packs:PACKS,...plan});
    }
    const action = String(req.body?.action || 'consume');
    if (action === 'consume') {
      const result = rpcRow(await callRpc('spend_iconia_credit', userId));
      if (!result?.ok) return json(res,402,{error:'NO_CREDITS',message:'クレジットがありません。'});
      return json(res,200,{...result,consumed:1});
    }
    if (action === 'refund') {
      const result = rpcRow(await callRpc('refund_iconia_credit', userId));
      if (!result?.ok) return json(res,503,{error:'REFUND_FAILED'});
      return json(res,200,result);
    }
    if (action === 'grant_ad') {
      const result = rpcRow(await callRpc('iconia_grant_ad_credit', userId));
      if (!result) return json(res,429,{error:'AD_REWARD_UNAVAILABLE',message:'広告報酬は現在利用できません。'});
      return json(res,200,{...result,granted:1});
    }
    return json(res,400,{error:'UNKNOWN_ACTION'});
  } catch (e) {
    console.error('Iconia credits error',e);
    return json(res,503,{error:'CREDITS_SERVICE_UNAVAILABLE'});
  }
}
