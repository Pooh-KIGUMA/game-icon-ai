import { supabaseAdmin, requireUser } from './_lib/supabase.js';
import generateHandler from './generate.js';

function makeCapture() {
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
      p_metadata: { source: 'generate-gated' }
    });
  } catch (e) {
    console.error('credit refund failed', e);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });
  let user;
  try {
    user = await requireUser(req);
    const admin = supabaseAdmin();
    const body = req.body || {};
    await consume(admin, user.id, body.message);

    const capture = makeCapture();
    try {
      await generateHandler(req, capture);
    } catch (error) {
      await refund(admin, user.id, 'generation_exception');
      throw error;
    }

    const result = capture.state.body;
    const isChat = Boolean(result?.chat);
    const failed = capture.state.statusCode >= 400 || result?.success === false;
    if (isChat || failed) await refund(admin, user.id, isChat ? 'chat_message' : 'generation_failed');

    Object.entries(capture.state.headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(capture.state.statusCode).json(result);
  } catch (error) {
    const status = Number(error?.status) || 500;
    const code = error?.message === 'NO_CREDITS' ? 'NO_CREDITS' : 'GENERATION_GATE_ERROR';
    return res.status(status).json({ success: false, error: code, message: error?.message || 'Generation failed.' });
  }
}
