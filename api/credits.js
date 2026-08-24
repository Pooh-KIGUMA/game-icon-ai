import { sql } from '@vercel/postgres';

const PLANS = {
  free: { monthlyCredits: 10, priceJPY: 0, ads: true, videoAds: true },
  standard: { monthlyCredits: 60, priceJPY: 540, ads: true, videoAds: false },
  pro: { monthlyCredits: 180, priceJPY: 1620, ads: false, videoAds: false }
};

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
}

function userId(req) {
  return String(req.headers['x-iconia-user-id'] || '').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const id = userId(req);
  if (!id || id.length > 128) return json(res, 401, { error: 'Authentication required' });

  try {
    await sql`CREATE TABLE IF NOT EXISTS iconia_accounts (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'free',
      credits INTEGER NOT NULL DEFAULT 10,
      period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

    const existing = await sql`SELECT user_id, plan, credits, period_start FROM iconia_accounts WHERE user_id=${id}`;
    let account = existing.rows[0];
    if (!account) {
      await sql`INSERT INTO iconia_accounts(user_id, plan, credits) VALUES(${id}, 'free', 10)`;
      account = { user_id: id, plan: 'free', credits: 10 };
    }

    if (req.method === 'GET') {
      const plan = PLANS[account.plan] || PLANS.free;
      return json(res, 200, { plan: account.plan, credits: account.credits, ...plan });
    }

    const action = String(req.body?.action || 'consume');
    if (action === 'consume') {
      const updated = await sql`UPDATE iconia_accounts SET credits=credits-1, updated_at=now() WHERE user_id=${id} AND credits > 0 RETURNING plan, credits`;
      if (!updated.rows[0]) return json(res, 402, { error: 'NO_CREDITS', message: 'No credits remaining.' });
      const plan = PLANS[updated.rows[0].plan] || PLANS.free;
      return json(res, 200, { plan: updated.rows[0].plan, credits: updated.rows[0].credits, ...plan });
    }

    if (action === 'grant_ad') {
      const updated = await sql`UPDATE iconia_accounts SET credits=credits+3, updated_at=now() WHERE user_id=${id} AND plan='free' RETURNING plan, credits`;
      if (!updated.rows[0]) return json(res, 403, { error: 'AD_REWARD_UNAVAILABLE' });
      return json(res, 200, { plan: 'free', credits: updated.rows[0].credits, reward: 3 });
    }

    return json(res, 400, { error: 'Unknown action' });
  } catch (error) {
    console.error('credits error', error);
    return json(res, 503, { error: 'CREDITS_SERVICE_UNAVAILABLE' });
  }
}
