import Stripe from 'stripe';
import { supabaseAdmin } from '../_lib/supabase.js';

function planFromPrice(priceId) {
  if (priceId && priceId === process.env.STRIPE_PRO_PRICE_ID) return 'pro';
  if (priceId && priceId === process.env.STRIPE_STANDARD_PRICE_ID) return 'standard';
  return 'free';
}

function creditsFor(plan) {
  return plan === 'pro' ? 180 : plan === 'standard' ? 60 : 10;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: 'STRIPE_WEBHOOK_NOT_CONFIGURED' });
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const signature = req.headers['stripe-signature'];
    const raw = req.body && typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const event = stripe.webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET);
    const admin = supabaseAdmin();

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const userId = s.metadata?.iconia_user_id || s.client_reference_id;
      if (userId) {
        const plan = s.metadata?.plan || 'standard';
        await admin.from('iconia_accounts').upsert({ user_id: userId, plan, credits: creditsFor(plan), stripe_customer_id: String(s.customer || ''), stripe_subscription_id: String(s.subscription || ''), period_start: new Date().toISOString(), updated_at: new Date().toISOString() });
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
      const sub = event.data.object;
      const userId = sub.metadata?.iconia_user_id;
      if (userId) {
        const plan = sub.status === 'active' || sub.status === 'trialing' ? (sub.metadata?.plan || planFromPrice(sub.items?.data?.[0]?.price?.id)) : 'free';
        await admin.from('iconia_accounts').update({ plan, credits: creditsFor(plan), stripe_customer_id: String(sub.customer || ''), stripe_subscription_id: String(sub.id), period_start: new Date((sub.current_period_start || Date.now()/1000)*1000).toISOString(), updated_at: new Date().toISOString() }).eq('user_id', userId);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const userId = sub.metadata?.iconia_user_id;
      if (userId) await admin.from('iconia_accounts').update({ plan: 'free', credits: 10, stripe_subscription_id: null, updated_at: new Date().toISOString() }).eq('user_id', userId);
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('stripe webhook', e);
    return res.status(400).json({ error: 'INVALID_WEBHOOK' });
  }
}
