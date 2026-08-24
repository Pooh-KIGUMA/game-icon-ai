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

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return json(503, { error: 'Stripe is not configured yet.' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const type = body.type || 'credits';
  const key = String(body.product || body.pack || body.plan || '');
  const product = type === 'subscription' ? PLANS[key] : PACKS[key];
  if (!product) return json(400, { error: 'Invalid product.' });

  const userId = body.userId;
  if (!userId) return json(401, { error: 'Authentication required.' });

  const origin = process.env.APP_URL || `https://${req.headers.host}`;
  const params = new URLSearchParams();
  params.set('mode', type === 'subscription' ? 'subscription' : 'payment');
  params.set('success_url', `${origin}/account.html?checkout=success`);
  params.set('cancel_url', `${origin}/pricing.html?checkout=cancelled`);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'jpy');
  params.set('line_items[0][price_data][unit_amount]', String(product.amount));
  params.set('line_items[0][price_data][product_data][name]', type === 'subscription' ? `Iconia AI ${key}` : `Iconia AI ${product.credits} Credits`);
  if (type === 'subscription') params.set('line_items[0][price_data][recurring][interval]', product.interval);
  params.set('metadata[user_id]', String(userId));
  params.set('metadata[type]', type);
  params.set('metadata[product]', key);
  params.set('metadata[credits]', String(product.credits));

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await response.json();
  if (!response.ok) return json(response.status, { error: data.error?.message || 'Stripe checkout failed.' });
  return json(200, { success: true, url: data.url, sessionId: data.id });
}
