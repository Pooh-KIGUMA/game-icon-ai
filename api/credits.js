import { sql } from '@vercel/postgres';

const PLANS = {
  free: { monthlyCredits: 10, priceJPY: 0 },
  standard: { monthlyCredits: 60, priceJPY: 540 },
  pro: { monthlyCredits: 180, priceJPY: 1620 }
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
      period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

    await sql`INSERT INTO iconia_accounts(user_id, plan, credits)
      VALUES(${id}, 'free', 10)
      ON CONFLICT (user_id) DO NOTHING`;

    if (req.method === 'GET') {
      const r = await sql`SELECT plan, credits, period_start FROM iconia_accounts WHERE user_id=${id}`;
      const account = r.rows[0];
      const plan = PLANS[account.plan] || PLANS.free;
      return json(res, 200, { plan: account.plan, credits: account.credits, ...plan });
    }

    const action = String(req.body?.action || 'consume');
    if (action === 'consume') {
      const r = await sql`UPDATE iconia_accounts
        SET credits = credits - 1, updated_at = now()
        WHERE user_id=${id} AND credits > 0
        RETURNING plan, credits`;
      if (!r.rows[0]) return json(res, 402, { error: 'NO_CREDITS', message: 'クレジットがありません。' });
      const plan = PLANS[r.rows[0].plan] || PLANS.free;
      return json(res, 200, { plan: r.rows[0].plan, credits: r.rows[0].credits, ...plan });
    }

    if (action === 'refund') {
      const r = await sql`UPDATE iconia_accounts
        SET credits = credits + 1, updated_at = now()
        WHERE user_id=${id}
        RETURNING plan, credits`;
      return json(res, 200, { plan: r.rows[0].plan, credits: r.rows[0].credits, refunded: 1 });
    }

    if (action === 'grant_ad') {
      const r = await sql`UPDATE iconia_accounts
        SET credits = credits + 3, updated_at = now()
        WHERE user_id=${id} AND plan='free'
        RETURNING plan, credits`;
      if (!r.rows[0]) return json(res, 403, { error: 'AD_REWARD_UNAVAILABLE' });
      return json(res, 200, { plan: 'free', credits: r.rows[0].credits, reward: 3 });
    }

    return json(res, 400, { error: 'UNKNOWN_ACTION' });
  } catch (error) {
    console.error('Iconia credits error', error);
    return json(res, 503, { error: 'CREDITS_SERVICE_UNAVAILABLE' });
  }
}
