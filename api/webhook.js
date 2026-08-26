import crypto from 'node:crypto';

export const config = { api: { bodyParser: false } };

function send(res, status, body) { return res.status(status).json(body); }
async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
function verifySignature(payload, signature, secret) {
  const parts = String(signature || '').split(',').map(x => x.split('='));
  const timestamp = parts.find(([k]) => k === 't')?.[1];
  const received = parts.filter(([k]) => k === 'v1').map(([, v]) => v).filter(Boolean);
  if (!timestamp || !received.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return received.some(value => {
    try { return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(value, 'utf8')); } catch { return false; }
  });
}
async function fetchWithTimeout(url, options = {}, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function ensureProfile(url, key, userId) {
  const r = await fetchWithTimeout(`${url}/rest/v1/profiles?on_conflict=id`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ id:userId, plan:'free', credits:3, monthly_credits:3, monthly_remaining:3, purchased_credits:0, bonus_credits:0 })
  });
  if (!r.ok && r.status !== 409) throw new Error(`PROFILE_CREATE_FAILED: ${await r.text()}`);
}
async function fetchProfile(url, key, filter) {
  const r = await fetchWithTimeout(`${url}/rest/v1/profiles?${filter}&select=id,plan,credits,purchased_credits,monthly_credits,monthly_remaining,stripe_subscription_id,stripe_customer_id,bonus_credits`, { headers: { apikey:key } });
  if (!r.ok) throw new Error(`PROFILE_LOOKUP_FAILED: ${await r.text()}`);
  return (await r.json())?.[0] || null;
}
async function patchProfile(url, key, userId, patch) {
  const r = await fetchWithTimeout(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method:'PATCH', headers:{apikey:key,'Content-Type':'application/json',Prefer:'return=minimal'},
    body:JSON.stringify({...patch,updated_at:new Date().toISOString()})
  });
  if (!r.ok) throw new Error(`PROFILE_UPDATE_FAILED: ${await r.text()}`);
}
async function recordPurchase(url, key, row) {
  const r = await fetchWithTimeout(`${url}/rest/v1/credit_purchases?on_conflict=stripe_session_id`, {
    method:'POST', headers:{apikey:key,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=representation'},
    body:JSON.stringify(row)
  });
  if (!r.ok) throw new Error(`PURCHASE_RECORD_FAILED: ${await r.text()}`);
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error:'POST only' });
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!webhookSecret || !supabaseUrl || !serviceKey) return send(res, 503, { error:'Billing is not configured yet.' });

  try {
    const raw = await readRawBody(req);
    if (!verifySignature(raw, req.headers['stripe-signature'], webhookSecret)) return send(res, 400, { error:'Invalid Stripe signature.' });
    const event = JSON.parse(raw);
    const object = event.data?.object || {};
    const metadata = object.metadata || {};
    const userId = metadata.user_id;
    const type = metadata.type;
    const credits = Number(metadata.credits || 0);
    const product = metadata.product;

    if (event.type === 'checkout.session.completed' && type === 'credits' && userId && credits > 0) {
      await ensureProfile(supabaseUrl, serviceKey, userId);
      const inserted = await recordPurchase(supabaseUrl, serviceKey, { stripe_session_id:object.id,user_id:userId,pack_id:product,credits,amount_jpy:Number(object.amount_total||0) });
      if (inserted) {
        const profile = await fetchProfile(supabaseUrl, serviceKey, `id=eq.${encodeURIComponent(userId)}`);
        if (!profile) throw new Error('Profile not found after creation.');
        await patchProfile(supabaseUrl, serviceKey, userId, { purchased_credits:Number(profile.purchased_credits||0)+credits, credits:Number(profile.credits||0)+credits });
      }
      return send(res, 200, { received:true });
    }

    if (event.type === 'checkout.session.completed' && type === 'subscription' && userId && credits > 0 && (product === 'standard' || product === 'pro')) {
      await ensureProfile(supabaseUrl, serviceKey, userId);
      const profile = await fetchProfile(supabaseUrl, serviceKey, `id=eq.${encodeURIComponent(userId)}`);
      if (!profile) throw new Error('Profile not found after creation.');
      await patchProfile(supabaseUrl, serviceKey, userId, {
        plan:product, monthly_credits:credits, monthly_remaining:credits,
        credits:Number(profile.purchased_credits||0)+Number(profile.bonus_credits||0)+credits,
        stripe_customer_id:object.customer||null, stripe_subscription_id:object.subscription||null
      });
      return send(res, 200, { received:true });
    }

    if ((event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') && object.subscription) {
      const subscriptionId = String(object.subscription);
      const profile = await fetchProfile(supabaseUrl, serviceKey, `stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`);
      const invoiceMeta = object.subscription_details?.metadata || object.metadata || {};
      const renewalCredits = Number(invoiceMeta.credits || profile?.monthly_credits || 0);
      const renewalPlan = invoiceMeta.product || profile?.plan;
      if (profile && renewalCredits > 0 && (renewalPlan === 'standard' || renewalPlan === 'pro')) {
        const inserted = await recordPurchase(supabaseUrl, serviceKey, { stripe_session_id:object.id,user_id:profile.id,pack_id:`subscription_${renewalPlan}`,credits:renewalCredits,amount_jpy:Number(object.amount_paid||object.amount_total||0) });
        if (inserted) {
          await patchProfile(supabaseUrl, serviceKey, profile.id, { plan:renewalPlan,monthly_credits:renewalCredits,monthly_remaining:renewalCredits,credits:renewalCredits+Number(profile.purchased_credits||0)+Number(profile.bonus_credits||0) });
        }
      }
      return send(res, 200, { received:true });
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscriptionId = String(object.id || '');
      if (subscriptionId) {
        const profile = await fetchProfile(supabaseUrl, serviceKey, `stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`);
        if (profile) await patchProfile(supabaseUrl, serviceKey, profile.id, { plan:'free',monthly_credits:3,monthly_remaining:0,credits:Number(profile.purchased_credits||0)+Number(profile.bonus_credits||0) });
      }
    }
    return send(res, 200, { received:true });
  } catch (error) {
    console.error('Iconia Stripe webhook error', error);
    return send(res, 500, { error:'WEBHOOK_PROCESSING_FAILED' });
  }
}
