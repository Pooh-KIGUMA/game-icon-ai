import Stripe from 'stripe';
import { supabaseAdmin } from '../_lib/supabase.js';

export const config = { api: { bodyParser: false } };

function planFromPrice(priceId) {
  if (priceId && priceId === process.env.STRIPE_PRO_PRICE_ID) return 'pro';
  if (priceId && priceId === process.env.STRIPE_STANDARD_PRICE_ID) return 'standard';
  return 'free';
}
function creditsFor(plan) { return plan === 'pro' ? 180 : plan === 'standard' ? 60 : 10; }
async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks=[]; for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)); return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: 'STRIPE_WEBHOOK_NOT_CONFIGURED' });
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const event = stripe.webhooks.constructEvent(await rawBody(req), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    const admin = supabaseAdmin();

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const userId = s.metadata?.iconia_user_id || s.client_reference_id;
      if (userId) {
        const plan = s.metadata?.plan || 'standard';
        const r = await admin.from('profiles').upsert({ id:userId, plan, credits:creditsFor(plan), monthly_credits:creditsFor(plan), stripe_customer_id:String(s.customer||''), stripe_subscription_id:String(s.subscription||''), billing_period_start:new Date().toISOString(), billing_period_end:new Date(Date.now()+31*24*60*60*1000).toISOString(), updated_at:new Date().toISOString() });
        if (r.error) throw r.error;
      }
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const sub = event.data.object, userId = sub.metadata?.iconia_user_id;
      if (userId) {
        const plan = (sub.status === 'active' || sub.status === 'trialing') ? (sub.metadata?.plan || planFromPrice(sub.items?.data?.[0]?.price?.id)) : 'free';
        const credits=creditsFor(plan);
        const start=(sub.current_period_start||Date.now()/1000)*1000;
        const end=(sub.current_period_end||Date.now()/1000)*1000;
        const r = await admin.from('profiles').update({ plan, credits, monthly_credits:credits, stripe_customer_id:String(sub.customer||''), stripe_subscription_id:String(sub.id), billing_period_start:new Date(start).toISOString(), billing_period_end:new Date(end).toISOString(), updated_at:new Date().toISOString() }).eq('id',userId);
        if (r.error) throw r.error;
      }
    }

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId = sub.metadata?.iconia_user_id;
        if (userId) {
          const plan = sub.metadata?.plan || planFromPrice(sub.items?.data?.[0]?.price?.id);
          const credits=creditsFor(plan);
          const r = await admin.from('profiles').update({ plan, credits, monthly_credits:credits, billing_period_start:new Date((sub.current_period_start||Date.now()/1000)*1000).toISOString(), billing_period_end:new Date((sub.current_period_end||Date.now()/1000)*1000).toISOString(), updated_at:new Date().toISOString() }).eq('id',userId);
          if (r.error) throw r.error;
        }
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object, userId = sub.metadata?.iconia_user_id;
      if (userId) { const r=await admin.from('profiles').update({ plan:'free', credits:10, monthly_credits:10, stripe_subscription_id:null, updated_at:new Date().toISOString() }).eq('id',userId); if(r.error) throw r.error; }
    }
    return res.status(200).json({ received:true });
  } catch (e) { console.error('stripe webhook',e); return res.status(400).json({ error:'INVALID_WEBHOOK' }); }
}
