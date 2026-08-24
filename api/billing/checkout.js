import crypto from 'node:crypto';

const PACKS = {
  credits_5: { credits: 5, amount: 150 },
  credits_10: { credits: 10, amount: 280 },
  credits_20: { credits: 20, amount: 500 },
  credits_30: { credits: 30, amount: 690 },
  credits_60: { credits: 60, amount: 1200 },
  credits_120: { credits: 120, amount: 2160 },
};
const PLANS = {
  standard: { credits: 30, amount: 540, interval: 'month' },
  pro: { credits: 120, amount: 1620, interval: 'month' },
};
const json = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const cookieName = 'iconia_uid';
function cookie(req, name) {
  const raw = String(req.headers.cookie || '');
  const found = raw.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : '';
}
function cookieSecret() { return process.env.CREDIT_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'iconia-credit-secret'; }
function sign(id) { return crypto.createHmac('sha256', cookieSecret()).update(id).digest('hex'); }
function decodeCookie(value) {
  const m = String(value || '').match(/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i);
  if (!m) return null;
  const expected = sign(m[1]);
  return crypto.timingSafeEqual(Buffer.from(m[2], 'hex'), Buffer.from(expected, 'hex')) ? m[1] : null;
}
async function getAuthenticatedUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!token || !supabaseUrl || !anonKey) return null;
  const r = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}
async function ensureProfile(userId) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_NOT_CONFIGURED');
  const r = await fetch(`${url}/rest/v1/profiles?on_conflict=id`, {
    method: 'POST',
    headers: { apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json', Prefer:'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ id:userId, plan:'free', credits:3, monthly_credits:3, monthly_remaining:3, purchased_credits:0, bonus_credits:0 })
  });
  if (!r.ok && r.status !== 409) throw new Error(await r.text());
}
async function createAnonymousUser() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_NOT_CONFIGURED');
  const email = `anonymous-${crypto.randomUUID()}@iconia-ai.local`;
  const password = crypto.randomBytes(32).toString('hex');
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method:'POST', headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({email,password,email_confirm:true,user_metadata:{anonymous:true}})
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).id;
}
function setCookie(id) {
  return `${cookieName}=${encodeURIComponent(`${id}.${sign(id)}`)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}
async function resolveUser(req) {
  const loggedIn = await getAuthenticatedUser(req);
  if (loggedIn?.id) { await ensureProfile(loggedIn.id); return { id:loggedIn.id, setCookie:null }; }
  const existing = decodeCookie(cookie(req, cookieName));
  if (existing) { await ensureProfile(existing); return { id:existing, setCookie:null }; }
  const id = await createAnonymousUser();
  await ensureProfile(id);
  return { id, setCookie:setCookie(id) };
}
export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return json(503, { error: 'Stripe is not configured yet.' });
  let body; try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch { return json(400, { error:'Invalid JSON' }); }
  const type = body.type === 'subscription' ? 'subscription' : 'credits';
  const key = String(body.product || body.pack || body.plan || '');
  const product = type === 'subscription' ? PLANS[key] : PACKS[key];
  if (!product) return json(400, { error:'Invalid product.' });
  try {
    const user = await resolveUser(req);
    const origin = process.env.APP_URL || `https://${req.headers.host}`;
    const params = new URLSearchParams();
    params.set('mode', type === 'subscription' ? 'subscription' : 'payment');
    params.set('success_url', `${origin}/pricing.html?checkout=success`);
    params.set('cancel_url', `${origin}/pricing.html?checkout=cancelled`);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', 'jpy');
    params.set('line_items[0][price_data][unit_amount]', String(product.amount));
    params.set('line_items[0][price_data][product_data][name]', type === 'subscription' ? `Iconia AI ${key}` : `Iconia AI ${product.credits} Credits`);
    params.set('metadata[user_id]', user.id);
    params.set('metadata[type]', type);
    params.set('metadata[product]', key);
    params.set('metadata[credits]', String(product.credits));
    if (type === 'subscription') {
      params.set('line_items[0][price_data][recurring][interval]', product.interval);
      // Keep the purchaser identity on the Stripe Subscription so future
      // recurring invoice events can be mapped back to the same Iconia user.
      params.set('subscription_data[metadata][user_id]', user.id);
      params.set('subscription_data[metadata][type]', type);
      params.set('subscription_data[metadata][product]', key);
      params.set('subscription_data[metadata][credits]', String(product.credits));
    }
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method:'POST', headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/x-www-form-urlencoded'}, body:params });
    const data = await r.json();
    if (!r.ok) return json(r.status, { error:data.error?.message || 'Stripe checkout failed.' });
    const headers = { 'Content-Type':'application/json' };
    if (user.setCookie) headers['Set-Cookie'] = user.setCookie;
    return { statusCode:200, headers, body:JSON.stringify({success:true,url:data.url,sessionId:data.id}) };
  } catch (e) {
    console.error('Iconia checkout error', e);
    return json(503, { error:'CHECKOUT_SERVICE_UNAVAILABLE' });
  }
}
