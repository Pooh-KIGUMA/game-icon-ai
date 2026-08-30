import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import generateHandler from './generate-v2.js';

function secretKey() { return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY; }
function publishableKey() { return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY; }
function cookieSecret() { return process.env.CREDIT_COOKIE_SECRET || secretKey() || 'iconia-credit-secret'; }
function sign(id) { return crypto.createHmac('sha256', cookieSecret()).update(id).digest('hex'); }
function decodeCookie(value) {
  const m = String(value || '').match(/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i);
  if (!m) return null;
  const expected = sign(m[1]);
  return crypto.timingSafeEqual(Buffer.from(m[2], 'hex'), Buffer.from(expected, 'hex')) ? m[1] : null;
}
function cookie(req, name) {
  const raw = String(req.headers.cookie || '');
  const found = raw.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : '';
}
function apiHeaders(key, extra = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json', ...extra };
  if (key && !String(key).startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}
async function createAnonymousUser() {
  const url = process.env.SUPABASE_URL, key = publishableKey();
  if (!url || !key) throw new Error('SUPABASE_NOT_CONFIGURED');
  const supabase = createClient(url, key, { auth: { autoRefreshToken:false, persistSession:false, detectSessionInUrl:false } });
  const { data, error } = await supabase.auth.signInAnonymously({ options:{ data:{ anonymous:true, app:'iconia-ai' } } });
  if (error) throw new Error(error.message);
  return data?.user?.id || null;
}
async function ensureProfile(userId) {
  const url = process.env.SUPABASE_URL, key = secretKey();
  if (!url || !key) throw new Error('SUPABASE_NOT_CONFIGURED');
  const r = await fetch(`${url}/rest/v1/profiles?on_conflict=id`, {
    method:'POST', headers:apiHeaders(key,{Prefer:'resolution=ignore-duplicates,return=minimal'}),
    body:JSON.stringify({id:userId,plan:'free',credits:3,monthly_credits:3,monthly_remaining:3,purchased_credits:0,bonus_credits:0})
  });
  if (!r.ok && r.status !== 409) throw new Error(await r.text());
}
async function resolveUser(req,res) {
  const existing = decodeCookie(cookie(req,'iconia_uid'));
  if (existing) { await ensureProfile(existing); return existing; }
  const id = await createAnonymousUser();
  if (!id) throw new Error('ANONYMOUS_USER_CREATE_FAILED');
  await ensureProfile(id);
  res.setHeader('Set-Cookie', `iconia_uid=${encodeURIComponent(`${id}.${sign(id)}`)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
  return id;
}
async function rpc(name,userId) {
  const url=process.env.SUPABASE_URL,key=secretKey();
  const r=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:apiHeaders(key),body:JSON.stringify({p_user_id:userId})});
  if(!r.ok) throw new Error(await r.text());
  const data=await r.json();
  return Array.isArray(data) ? (data[0] || null) : data;
}

export default async function handler(req,res) {
  let userId=null, consumed=false;
  try {
    userId=await resolveUser(req,res);
    const spent=await rpc('spend_iconia_credit',userId);
    if(!spent?.ok){
      return res.status(402).setHeader('Content-Type','application/json').send(JSON.stringify({success:false,error:'NO_CREDITS',message:'クレジットがありません。'}));
    }
    consumed=true;
    await generateHandler(req,res);
    if(Number(res.statusCode||200)>=400 && consumed){
      try{await rpc('refund_iconia_credit',userId);}catch{}
    }
  } catch(error) {
    if(consumed && userId){try{await rpc('refund_iconia_credit',userId);}catch{}}
    console.error('Iconia gated generation error',error);
    if(!res.headersSent) return res.status(503).setHeader('Content-Type','application/json').send(JSON.stringify({success:false,error:'GENERATION_SERVICE_UNAVAILABLE',message:'画像生成サービスでエラーが発生しました。'}));
  }
}
