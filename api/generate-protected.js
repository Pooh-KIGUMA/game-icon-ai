import originalHandler from './generate.js';
import { requireUser, supabaseAdmin } from './_lib/supabase.js';

function captureResponse() {
  const state = { statusCode: 200, headers: {}, body: null };
  return {
    state,
    status(code) { state.statusCode = code; return this; },
    setHeader(key, value) { state.headers[key] = value; return this; },
    json(body) { state.body = body; return this; },
    send(body) { state.body = body; return this; }
  };
}

async function consume(admin, userId, message) {
  const { data, error } = await admin.rpc('consume_credit', {
    p_user_id: userId,
    p_reason: 'image_generation',
    p_metadata: { message: String(message || '').slice(0, 300) }
  });
  if (error) {
    if (String(error.message || '').includes('INSUFFICIENT_CREDITS')) {
      const e = new Error('NO_CREDITS'); e.status = 402; throw e;
    }
    throw error;
  }
  return Number(data);
}

async function refund(admin, userId, reason) {
  try {
    await admin.rpc('refund_credit', {
      p_user_id: userId,
      p_reason: reason,
      p_metadata: { source: 'generate-protected' }
    });
  } catch (e) { console.error('credit refund failed', e); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let user;
  try { user = await requireUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message || 'AUTH_REQUIRED' }); }

  const admin = supabaseAdmin();
  let charged = false;
  try {
    await consume(admin, user.id, req.body?.message);
    charged = true;

    const capture = captureResponse();
    await originalHandler(req, capture);
    const result = capture.state.body;
    const isChat = Boolean(result?.chat);
    const failed = capture.state.statusCode >= 400 || result?.success === false;
    if (isChat || failed) await refund(admin, user.id, isChat ? 'chat_message' : 'generation_failed');

    Object.entries(capture.state.headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(capture.state.statusCode).json(result);
  } catch (e) {
    if (charged) await refund(admin, user.id, 'generation_exception');
    return res.status(e.status || (e.message === 'NO_CREDITS' ? 402 : 503)).json({ error: e.message || 'GENERATION_FAILED' });
  }
}
