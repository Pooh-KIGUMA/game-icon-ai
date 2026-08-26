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
const json = (status, body, extraHeaders = {}) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });
const redirect = (url, extraHeaders = {}) => ({ statusCode: 303, headers: { Location: url, ...extraHeaders }, body: '' });
const cookieName = 'iconia_uid';

function cookie(req, name) {
  const raw = String(req.headers.cookie || '');
  const found = raw.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : '';
}
function cookieSecret() { return process.env.CREDIT_COOKIE_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'iconia-credit-secret'; }
function sign(id) { return crypto.createHmac('sha256', cookieSecret()).update(id).digest('hex'); }
function decodeCookie(value) {
  const m = String(value || '').match(/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i);
  if (!m) return null;
  const expected = sign(m[1]);
  return crypto.timingSafeEqual(Buffer.from(m[2], 'hex'), Buffer.from(expected, 'hex')) ? m[1] : null;
}
function setCookie(id) {
  return `${cookieName}=${encodeURIComponent(`${id}.${sign(id)}`)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}
function resolveAnonymousId(req) {
  return decodeCookie(cookie(req, cookieName)) || crypto.randomUUID();
}

async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export default async function handler(req) {
  if (!['GET', 'POST'].includes(req.method)) return json(405, { error: 'GET or POST only' });
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return json(503, { error: 'Stripe is not configured yet.' });

  let body = {};
  try {
    if (req.method === 'POST') body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    else body = req.query || {};
  } catch { return json(400, { error: 'Invalid request' }); }

  const type = body.type === 'subscription' ? 'subscription' : 'credits';
  const key = String(body.product || body.pack || body.plan || '');
  const product = type === 'subscription' ? PLANS[key] : PACKS[key];
  if (!product) return json(400, { error: 'Invalid product.' });

  try {
    const userId = resolveAnonymousId(req);
    const origin = process.env.APP_URL || `https://${req.headers.host}`;
    const params = new URLSearchParams();
    params.set('mode', type === 'subscription' ? 'subscription' : 'payment');
    params.set('success_url', `${origin}/pricing.html?checkout=success`);
    params.set('cancel_url', `${origin}/pricing.html?checkout=cancelled`);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', 'jpy');
    params.set('line_items[0][price_data][unit_amount]', String(product.amount));
    params.set('line_items[0][price_data][product_data][name]', type === 'subscription' ? `Iconia AI ${key}` : `Iconia AI ${product.credits} Credits`);
    params.set('metadata[user_id]', userId);
    params.set('metadata[type]', type);
    params.set('metadata[product]', key);
    params.set('metadata[credits]', String(product.credits));

    if (type === 'subscription') {
      params.set('line_items[0][price_data][recurring][interval]', product.interval);
      params.set('subscription_data[metadata][user_id]', userId);
      params.set('subscription_data[metadata][type]', type);
      params.set('subscription_data[metadata][product]', key);
      params.set('subscription_data[metadata][credits]', String(product.credits));
    }

    const r = await fetchWithTimeout('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    }, 15000);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json(r.status, { error: data.error?.message || 'Stripe checkout failed.' });

    const headers = { 'Set-Cookie': setCookie(userId) };
    // GET is used by the pricing buttons so the browser can navigate directly
    // to Stripe without waiting on a client-side fetch request.
    if (req.method === 'GET' && data.url) return redirect(data.url, headers);
    return json(200, { success: true, url: data.url, sessionId: data.id }, headers);
  } catch (e) {
    console.error('Iconia checkout error', e);
    if (e?.name === 'AbortError') return json(504, { error: '決済サービスへの接続がタイムアウトしました。もう一度お試しください。' });
    return json(503, { error: 'CHECKOUT_SERVICE_UNAVAILABLE' });
  }
}
