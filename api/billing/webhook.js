import crypto from 'crypto';

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function verifySignature(payload, signature, secret) {
  const parts = Object.fromEntries(String(signature || '').split(',').map(x => x.split('=')));
  const timestamp = parts.t;
  const received = parts.v1;
  if (!timestamp || !received) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const signed = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!webhookSecret || !supabaseUrl || !serviceKey) return json(503, { error: 'Billing is not configured yet.' });

  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (!verifySignature(raw, req.headers['stripe-signature'], webhookSecret)) return json(400, { error: 'Invalid Stripe signature.' });

  const event = JSON.parse(raw);
  const object = event.data?.object || {};
  const metadata = object.metadata || {};
  const userId = metadata.user_id;
  const type = metadata.type;
  const credits = Number(metadata.credits || 0);
  const product = metadata.product;
  if (event.type !== 'checkout.session.completed' || !userId) return json(200, { received: true });

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  if (type === 'credits' && credits > 0) {
    const purchase = await fetch(`${supabaseUrl}/rest/v1/credit_purchases?on_conflict=stripe_session_id`, {
      method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ stripe_session_id: object.id, user_id: userId, pack_id: product, credits, amount_jpy: Number(object.amount_total || 0) }),
    });
    if (!purchase.ok) return json(500, { error: 'Could not record purchase.' });

    const profile = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=purchased_credits,credits`, { headers });
    const rows = await profile.json();
    const current = rows?.[0];
    if (!current) return json(500, { error: 'Profile not found.' });
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ purchased_credits: Number(current.purchased_credits || 0) + credits, credits: Number(current.credits || 0) + credits, updated_at: new Date().toISOString() }),
    });
  }

  if (type === 'subscription' && (product === 'standard' || product === 'pro')) {
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ plan: product, monthly_credits: credits, monthly_remaining: credits, credits: credits, stripe_customer_id: object.customer || null, stripe_subscription_id: object.subscription || null, updated_at: new Date().toISOString() }),
    });
  }
  return json(200, { received: true });
}
