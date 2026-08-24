import { sql } from '@vercel/postgres';

const PLANS = {
  free: { monthlyCredits: 10, priceJPY: 0 },
  standard: { monthlyCredits: 30, priceJPY: 540 },
  pro: { monthlyCredits: 120, priceJPY: 1620 }
};

const PACKS = {
  5: 150,
  10: 280,
  20: 500,
  30: 690,
  60: 1200,
  120: 2160
};

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
}

function userId(req) {
  return String(req.headers['x-iconia-user-id'] || '').trim().slice(0, 128);
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  const id = userId(req);
  if (!id) return json(res, 401, { error: 'AUTHENTICATION_REQUIRED' });

  try {
    await sql`CREATE TABLE IF NOT EXISTS iconia_accounts (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'free',
      credits INTEGER NOT NULL DEFAULT 10 CHECK (credits >= 0),
      purchased_credits INTEGER NOT NULL DEFAULT 0 CHECK (purchased_credits >= 0),
      period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

    await sql`ALTER TABLE iconia_accounts ADD COLUMN IF NOT EXISTS purchased_credits INTEGER NOT NULL DEFAULT 0`;

    await sql`INSERT INTO iconia_accounts(user_id, plan, credits, purchased_credits)
      VALUES(${id}, 'free', 10, 0)
      ON CONFLICT (user_id) DO NOTHING`;

    if (req.method === 'GET') {
      const r = await sql`SELECT plan, credits, purchased_credits, period_start FROM iconia_accounts WHERE user_id=${id}`;
      const account = r.rows[0];
      const plan = PLANS[account.plan] || PLANS.free;
      return json(res, 200, {
        plan: account.plan,
        credits: account.credits,
        purchasedCredits: account.purchased_credits,
        packs: PACKS,
        ...plan
      });
    }

    const action = String(req.body?.action || 'consume');

    if (action === 'consume') {
      const r = await sql`UPDATE iconia_accounts
        SET credits = credits - 1, updated_at = now()
        WHERE user_id=${id} AND credits > 0
        RETURNING plan, credits, purchased_credits`;
      if (!r.rows[0]) return json(res, 402, { error: 'NO_CREDITS', message: 'クレジットがありません。' });
      const plan = PLANS[r.rows[0].plan] || PLANS.free;
      return json(res, 200, { plan: r.rows[0].plan, credits: r.rows[0].credits, purchasedCredits: r.rows[0].purchased_credits, ...plan });
    }

    if (action === 'refund') {
      const r = await sql`UPDATE iconia_accounts
        SET credits = credits + 1, updated_at = now()
        WHERE user_id=${id}
        RETURNING plan, credits, purchased_credits`;
      return json(res, 200, { plan: r.rows[0].plan, credits: r.rows[0].credits, purchasedCredits: r.rows[0].purchased_credits, refunded: 1 });
    }

    if (action === 'grant_ad') {
      const r = await sql`UPDATE iconia_accounts
        SET credits = credits + 3, updated_at = now()
        WHERE user_id=${id} AND plan='free'
        RETURNING plan, credits, purchased_credits`;
      if (!r.rows[0]) return json(res, 403, { error: 'AD_REWARD_UNAVAILABLE' });
      return json(res, 200, { plan: 'free', credits: r.rows[0].credits, purchasedCredits: r.rows[0].purchased_credits, reward: 3 });
    }

    if (action === 'add_purchased') {
      const amount = Number(req.body?.amount);
      if (!Number.isInteger(amount) || !Object.prototype.hasOwnProperty.call(PACKS, amount)) {
        return json(res, 400, { error: 'INVALID_CREDIT_PACK', packs: PACKS });
      }
      const r = await sql`UPDATE iconia_accounts
        SET credits = credits + ${amount}, purchased_credits = purchased_credits + ${amount}, updated_at = now()
        WHERE user_id=${id}
        RETURNING plan, credits, purchased_credits`;
      return json(res, 200, { plan: r.rows[0].plan, credits: r.rows[0].credits, purchasedCredits: r.rows[0].purchased_credits, added: amount, priceJPY: PACKS[amount] });
    }

    return json(res, 400, { error: 'UNKNOWN_ACTION' });
  } catch (error) {
    console.error('Iconia credits error', error);
    return json(res, 503, { error: 'CREDITS_SERVICE_UNAVAILABLE' });
  }
}
