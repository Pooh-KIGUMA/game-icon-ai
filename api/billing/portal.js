import Stripe from 'stripe';
import { supabaseAdmin, requireUser } from '../_lib/supabase.js';

const APP_URL = process.env.APP_URL || 'https://game-icon-ai.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'STRIPE_NOT_CONFIGURED' });

  try {
    const user = await requireUser(req);
    const admin = supabaseAdmin();
    const { data: account, error } = await admin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!account?.stripe_customer_id) {
      return res.status(400).json({ error: 'NO_STRIPE_CUSTOMER' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripe_customer_id,
      return_url: APP_URL
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'BILLING_PORTAL_FAILED' });
  }
}
