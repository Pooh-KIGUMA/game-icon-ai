import crypto from 'crypto';

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function verifySignature(payload, signature, secret) {
  const parts = String(signature || '').split(',').map(x => x.split('='));
  const timestamp = parts.find(([k]) => k === 't')?.[1];
  const received = parts.filter(([k]) => k === 'v1').map(([,v]) => v).filter(Boolean);
  if (!timestamp || !received.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const signed = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return received.some(value => {
    try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(value)); } catch { return false; }
  });
}

async function fetchProfile(supabaseUrl, serviceKey, filter) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const r = await fetch(`${supabaseUrl}/rest/v1/profiles?${filter}&select=id,plan,credits,purchased_credits,monthly_credits,monthly_remaining,stripe_subscription_id,stripe_customer_id`, { headers });
  if (!r.ok) throw new Error(`PROFILE_LOOKUP_FAILED: ${await r.text()}`);
  return (await r.json())?.[0] || null;
}

async function patchProfile(supabaseUrl, serviceKey, userId, patch) {
  const r = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`PROFILE_UPDATE_FAILED: ${await r.text()}`);
}

async function recordPurchase(supabaseUrl, serviceKey, row) {
  const r = await fetch(`${supabaseUrl}/rest/v1/credit_purchases?on_conflict=stripe_session_id`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`PURCHASE_RECORD_FAILED: ${await r.text()}`);
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!webhookSecret || !supabaseUrl || !serviceKey) return json(503, { error: 'Billing is not configured yet.' });

  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (!verifySignature(raw, req.headers['stripe-signature'], webhookSecret)) return json(400, { error: 'Invalid Stripe signature.' });

  let event;
  try { event = JSON.parse(raw); } catch { return json(400, { error: 'Invalid webhook JSON.' }); }
  const object = event.data?.object || {};
  const metadata = object.metadata || {};
  const userId = metadata.user_id;
  const type = metadata.type;
  const credits = Number(metadata.credits || 0);
  const product = metadata.product;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  try {
    // One-time credit purchase: Stripe session -> idempotent purchase record -> credits.
    if (event.type === 'checkout.session.completed' && type === 'credits' && userId && credits > 0) {
      const inserted = await recordPurchase(supabaseUrl, serviceKey, {
        stripe_session_id: object.id,
        user_id: userId,
        pack_id: product,
        credits,
        amount_jpy: Number(object.amount_total || 0),
      });
      // Stripe can retry the same event. If the purchase already exists, do not grant twice.
      if (inserted) {
        const profile = await fetchProfile(supabaseUrl, serviceKey, `id=eq.${encodeURIComponent(userId)}`);
        if (!profile) throw new Error('Profile not found.');
        await patchProfile(supabaseUrl, serviceKey, userId, {
          purchased_credits: Number(profile.purchased_credits || 0) + credits,
          credits: Number(profile.credits || 0) + credits,
        });
      }
      return json(200, { received: true });
    }

    // Initial subscription checkout. Preserve already purchased credits instead of overwriting them.
    if (event.type === 'checkout.session.completed' && type === 'subscription' && userId && credits > 0 && (product === 'standard' || product === 'pro')) {
      const profile = await fetchProfile(supabaseUrl, serviceKey, `id=eq.${encodeURIComponent(userId)}`);
      if (!profile) throw new Error('Profile not found.');
      await patchProfile(supabaseUrl, serviceKey, userId, {
        plan: product,
        monthly_credits: credits,
        monthly_remaining: credits,
        credits: Number(profile.credits || 0) + credits,
        stripe_customer_id: object.customer || null,
        stripe_subscription_id: object.subscription || null,
      });
      return json(200, { received: true });
    }

    // Recurring subscription payment. The checkout code puts user_id/product/credits
    // on the Stripe Subscription so invoice events can be mapped back to the same user.
    if ((event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') && object.subscription) {
      const subscriptionId = String(object.subscription);
      let profile = await fetchProfile(supabaseUrl, serviceKey, `stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`);
      const invoiceMeta = object.subscription_details?.metadata || object.metadata || {};
      const renewalCredits = Number(invoiceMeta.credits || profile?.monthly_credits || 0);
      const renewalPlan = invoiceMeta.product || profile?.plan;
      if (profile && renewalCredits > 0 && (renewalPlan === 'standard' || renewalPlan === 'pro')) {
        const inserted = await recordPurchase(supabaseUrl, serviceKey, {
          stripe_session_id: object.id,
          user_id: profile.id,
          pack_id: `subscription_${renewalPlan}`,
          credits: renewalCredits,
          amount_jpy: Number(object.amount_paid || object.amount_total || 0),
        });
        if (inserted) {
          await patchProfile(supabaseUrl, serviceKey, profile.id, {
            plan: renewalPlan,
            monthly_credits: renewalCredits,
            monthly_remaining: renewalCredits,
            credits: Number(profile.credits || 0) + renewalCredits,
          });
        }
      }
      return json(200, { received: true });
    }

    // Keep the user's remaining credits, but stop future monthly grants after cancellation.
    if (event.type === 'customer.subscription.deleted') {
      const subscriptionId = String(object.id || '');
      if (subscriptionId) {
        const profile = await fetchProfile(supabaseUrl, serviceKey, `stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`);
        if (profile) await patchProfile(supabaseUrl, serviceKey, profile.id, { plan: 'free', monthly_credits: 3, monthly_remaining: 0 });
      }
      return json(200, { received: true });
    }

    return json(200, { received: true });
  } catch (error) {
    // Returning 5xx tells Stripe to retry instead of silently losing a paid credit grant.
    console.error('Iconia Stripe webhook error', error);
    return json(500, { error: 'WEBHOOK_PROCESSING_FAILED' });
  }
}
