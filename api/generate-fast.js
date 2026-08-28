import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import sharp from 'sharp';
import generateHandler from './generate.js';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const IMAGE_MODEL = 'gpt-image-2';

function secretKey(){ return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY; }
function publishableKey(){ return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY; }
function cookieSecret(){ return process.env.CREDIT_COOKIE_SECRET || secretKey() || 'iconia-credit-secret'; }
function sign(id){ return crypto.createHmac('sha256', cookieSecret()).update(id).digest('hex'); }
function decodeCookie(value){ const m=String(value||'').match(/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i); if(!m)return null; const expected=sign(m[1]); return crypto.timingSafeEqual(Buffer.from(m[2],'hex'),Buffer.from(expected,'hex'))?m[1]:null; }
function cookie(req,name){ const raw=String(req.headers.cookie||''); const found=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${name}=`)); return found?decodeURIComponent(found.slice(name.length+1)):''; }
function apiHeaders(key,extra={}){ const h={apikey:key,'Content-Type':'application/json',...extra}; if(key&&!String(key).startsWith('sb_'))h.Authorization=`Bearer ${key}`; return h; }
async function createAnonymousUser(){ const url=process.env.SUPABASE_URL,key=publishableKey(); if(!url||!key)throw new Error('SUPABASE_NOT_CONFIGURED'); const supabase=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}}); const {data,error}=await supabase.auth.signInAnonymously({options:{data:{anonymous:true,app:'iconia-ai'}}}); if(error)throw new Error(error.message); return data?.user?.id||null; }
async function ensureProfile(userId){ const url=process.env.SUPABASE_URL,key=secretKey(); if(!url||!key)throw new Error('SUPABASE_NOT_CONFIGURED'); const r=await fetch(`${url}/rest/v1/profiles?on_conflict=id`,{method:'POST',headers:apiHeaders(key,{Prefer:'resolution=ignore-duplicates,return=minimal'}),body:JSON.stringify({id:userId,plan:'free',credits:3,monthly_credits:3,monthly_remaining:3,purchased_credits:0,bonus_credits:0})}); if(!r.ok&&r.status!==409)throw new Error(await r.text()); }
async function resolveUser(req,res){ const existing=decodeCookie(cookie(req,'iconia_uid')); if(existing){await ensureProfile(existing);return existing;} const id=await createAnonymousUser(); if(!id)throw new Error('ANONYMOUS_USER_CREATE_FAILED'); await ensureProfile(id); res.setHeader('Set-Cookie',`iconia_uid=${encodeURIComponent(`${id}.${sign(id)}`)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`); return id; }
async function rpc(name,userId){ const url=process.env.SUPABASE_URL,key=secretKey(); const r=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:apiHeaders(key),body:JSON.stringify({p_user_id:userId})}); if(!r.ok)throw new Error(await r.text()); const data=await r.json(); return Array.isArray(data)?(data[0]||null):data; }

function formatInfo(key){
  return ({icon:{size:'1024x1024',w:1024,h:1024,label:'ゲームアイコン 1:1'},xheader:{size:'1536x1024',w:1500,h:500,label:'X / Twitter ヘッダー 3:1'},youtube:{size:'1536x1024',w:1280,h:720,label:'YouTube 16:9'},portrait:{size:'1024x1536',w:1024,h:1536,label:'縦長 2:3'}})[key]||({size:'1024x1024',w:1024,h:1024,label:'ゲームアイコン 1:1'});
}
function chooseFormat(body){ const key=['icon','xheader','youtube','portrait'].includes(body?.format)?body.format:'icon'; return key; }
async function fit(dataUrl,fmt){ const m=String(dataUrl).match(/^data:image\/[^;]+;base64,(.+)$/); if(!m)throw new Error('画像データを読み込めませんでした。'); const buf=Buffer.from(m[1],'base64'); const out=await sharp(buf).resize(fmt.w,fmt.h,{fit:'cover',position:'attention'}).jpeg({quality:90}).toBuffer(); return `data:image/jpeg;base64,${out.toString('base64')}`; }
function simpleRequest(message,image,history){
  // Initial prompts without a reference image can go directly to the image model.
  // This avoids the extra planner call and prevents mobile Safari from waiting on
  // an unnecessary reasoning stage before image generation starts.
  if(image)return false;
  const t=String(message||'').trim();
  if(!t)return false;
  if(/^(ありがとう|ありがとう！|いい感じ|いいね|最高|完璧|すごい|良いね|良い感じ|助かった|気に入った|ok|okay|了解|うん|そうそう|その調子)$/iu.test(t))return false;
  return t.length<=500;
}

async function withTimeout(promise, ms, label){
  let timer;
  const timeout = new Promise((_, reject)=>{ timer=setTimeout(()=>reject(new Error(`${label} が ${Math.round(ms/1000)} 秒以内に完了しませんでした。`)),ms); });
  try { return await Promise.race([promise,timeout]); }
  finally { clearTimeout(timer); }
}

function buildFastPrompt(message, fmt){
  return `Create a premium commercial-quality gaming icon directly from the user's request below.

USER REQUEST:
${message}

OUTPUT:
${fmt.label}. Strong focal subject, sophisticated composition, cinematic lighting, crisp details, polished professional game-art finish.

IMPORTANT DESIGN RULES:
- Treat every requested name, word, team name, clan name, alliance name, or logo as an intentional graphic-design element, not as plain text pasted on top of the image.
- If the user requests text/logo, decide the best placement yourself based on the composition, focal point, negative space, character face, lighting, and visual balance. Do NOT default to the center.
- Design the typography to belong to the artwork: choose an appropriate type treatment, weight, perspective, outline, glow, shadow, metallic/energy texture, emblem treatment, or other tasteful effects that fit the image.
- The requested text must be spelled exactly. Do not add duplicate copies of the requested text.
- Keep important character faces and focal details unobstructed unless the user explicitly asks for text over them.
- Make the logo/text look intentionally designed as part of a professional game icon, not like a sticker, caption, watermark, or later overlay.
- Use the surrounding colors, lighting, genre, and shapes to make the typography visually integrated with the scene.
- Prefer asymmetrical or composition-aware placement when that creates a stronger result; use the center only when it is genuinely the best design choice.
- Do not add unrelated text, logos, watermarks, signatures, or random lettering.

${message}`;
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({success:false,error:'POSTリクエストのみ対応しています。'});
  let userId=null,consumed=false;
  const started=Date.now();
  try{
    if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY がVercelに設定されていません。');
    console.log('[Iconia] generation start');
    userId=await resolveUser(req,res);
    console.log('[Iconia] user resolved',Date.now()-started,'ms');
    const spent=await withTimeout(rpc('spend_iconia_credit',userId),20000,'クレジット確認');
    if(!spent?.ok)return res.status(402).json({success:false,error:'NO_CREDITS',message:'クレジットがありません。'});
    consumed=true;
    console.log('[Iconia] credit consumed',Date.now()-started,'ms');
    const body=req.body||{};
    const message=String(body.message||'').trim();
    const image=typeof body.image==='string'&&body.image.startsWith('data:image/')?body.image:null;
    const history=Array.isArray(body.history)?body.history:[];
    if(simpleRequest(message,image,history)){
      const key=chooseFormat(body),fmt=formatInfo(key);
      const prompt=buildFastPrompt(message,fmt);
      console.log('[Iconia] fast image request',Date.now()-started,'ms');
      // Medium quality keeps the result visually strong while avoiding the
      // unnecessary latency of high-quality generation for the first draft.
      const result=await withTimeout(client.images.generate({model:IMAGE_MODEL,prompt,size:fmt.size,quality:'medium',output_format:'jpeg',output_compression:88,n:1}),150000,'画像生成');
      console.log('[Iconia] image received',Date.now()-started,'ms');
      const b64=result?.data?.[0]?.b64_json;
      if(!b64)throw new Error('画像データがAIから返されませんでした。');
      const output=await withTimeout(fit(`data:image/jpeg;base64,${b64}`,fmt),30000,'画像仕上げ');
      console.log('[Iconia] response ready',Date.now()-started,'ms');
      return res.status(200).json({success:true,image:output,reply:'できました。',plan:{mode:'FAST_GENERATE',format:key,formatLabel:fmt.label}});
    }
    console.log('[Iconia] full context generation',Date.now()-started,'ms');
    await generateHandler(req,res);
    if(Number(res.statusCode||200)>=400&&consumed){try{await rpc('refund_iconia_credit',userId);}catch{}}
  }catch(error){
    if(consumed&&userId){try{await rpc('refund_iconia_credit',userId);}catch{}}
    console.error('Iconia fast generation error',error);
    if(!res.headersSent)return res.status(503).json({success:false,error:error?.message||'画像生成サービスでエラーが発生しました。'});
  }
}