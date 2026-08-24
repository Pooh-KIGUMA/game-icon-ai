import Stripe from 'stripe';
import { supabaseAdmin, requireUser } from '../_lib/supabase.js';

const PRICE_ENV = { standard: 'STRIPE_STANDARD_PRICE_ID', pro: 'STRIPE_PRO_PRICE_ID' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'STRIPE_NOT_CONFIGURED' });
  try {
    const user = await requireUser(req);
    const plan = String(req.body?.plan || '').toLowerCase();
    if (!PRICE_ENV[plan]) return res.status(400).json({ error: 'INVALID_PLAN' });
    const price = process.env[PRICE_ENV[plan]];
    if (!price) return res.status(503).json({ error: `${PRICE_ENV[plan]}_MISSING` });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const admin = supabaseAdmin();
    const { data: account } = await admin.from('iconia_accounts').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      customer: account?.stripe_customer_id || undefined,
      customer_email: account?.stripe_customer_id ? undefined : user.email,
      client_reference_id: user.id,
      metadata: { iconia_user_id: user.id, plan },
      subscription_data: { metadata: { iconia_user_id: user.id, plan } },
      success_url: `${process.env.APP_URL || 'https://example.com'}?billing=success`,
      cancel_url: `${process.env.APP_URL || 'https://example.com'}?billing=cancelled`,
      allow_promotion_codes: true
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'CHECKOUT_FAILED' });
  }
}
