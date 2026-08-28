import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import OpenAI, { toFile } from 'openai';
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
function formatInfo(key){ return ({icon:{size:'1024x1024',w:1024,h:1024,label:'ゲームアイコン 1:1'},xheader:{size:'1536x1024',w:1500,h:500,label:'X / Twitter ヘッダー 3:1'},youtube:{size:'1536x1024',w:1280,h:720,label:'YouTube 16:9'},portrait:{size:'1024x1536',w:1024,h:1536,label:'縦長 2:3'}})[key]||({size:'1024x1024',w:1024,h:1024,label:'ゲームアイコン 1:1'}); }
function chooseFormat(body){ return ['icon','xheader','youtube','portrait'].includes(body?.format)?body.format:'icon'; }
function dataImageToBuffer(value){ const m=String(value||'').match(/^data:image\/([^;]+);base64,(.+)$/); if(!m)throw new Error('参考画像を読み込めませんでした。'); const mime=`image/${m[1].toLowerCase()}`; if(!['image/jpeg','image/png','image/webp'].includes(mime))throw new Error('参考画像はJPG・PNG・WebPに対応しています。'); return {buffer:Buffer.from(m[2],'base64'),mime}; }
async function fit(dataUrl,fmt){ const {buffer}=dataImageToBuffer(dataUrl); const out=await sharp(buffer).resize(fmt.w,fmt.h,{fit:'cover',position:'attention'}).jpeg({quality:92}).toBuffer(); return `data:image/jpeg;base64,${out.toString('base64')}`; }
function hasDesignRequest(message){ return /(文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名|ギルド名|入れて|書いて|デザイン|かっこよく|おしゃれ|ロゴ風)/iu.test(String(message||'')); }
function buildDesignPrompt(message,fmt){ return `Create a premium commercial-quality gaming icon/edit from the supplied reference image.\n\nUSER REQUEST:\n${message}\n\nOUTPUT: ${fmt.label}.\n\nDESIGN RULES:\n- Preserve the recognizable subject, face, hair, clothing, pose, important objects and overall composition unless the user explicitly asks to change them.\n- If the request includes a name, word, team/clan/alliance name or logo, treat it as a professionally designed graphic element integrated into the artwork, NOT as a plain pasted caption.\n- Decide the best placement yourself from focal point, negative space, lighting, shapes and visual balance. Do NOT automatically put the text in the center.\n- Choose typography that matches the artwork: appropriate weight, perspective, outline, shadow, glow, metallic/energy texture, emblem treatment or other tasteful effects.\n- Keep faces and important focal details unobstructed when possible.\n- Use the surrounding palette and lighting so the text/logo looks like it belongs to the original artwork.\n- Spell requested text exactly and include it only once.\n- Do not add unrelated text, logos, watermarks or signatures.\n- Make the result look like a finished professional game icon, not an edited screenshot.\n\nReturn one final image only.`; }
function buildGeneratePrompt(message,fmt){ return `Create a premium commercial-quality gaming icon directly from this request.\nUSER REQUEST: ${message}\nOUTPUT: ${fmt.label}.\nIf text or a logo is requested, design its placement, typography, effects and integration yourself based on the composition. Never treat it as a plain pasted caption. Preserve requested spelling exactly and include it only once. Do not add unrelated text, logos, watermarks or signatures.`; }
async function withTimeout(promise,ms,label){ let timer; const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} が ${Math.round(ms/1000)} 秒以内に完了しませんでした。`)),ms);}); try{return await Promise.race([promise,timeout]);}finally{clearTimeout(timer);} }

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({success:false,error:'POSTリクエストのみ対応しています。'});
  let userId=null,consumed=false;
  const started=Date.now();
  try{
    if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY がVercelに設定されていません。');
    console.log('[Iconia] generation start');
    userId=await resolveUser(req,res);
    console.log('[Iconia] user resolved',Date.now()-started,'ms');
    const spent=await withTimeout(rpc('spend_iconia_credit',userId),10000,'クレジット確認');
    if(!spent?.ok)return res.status(402).json({success:false,error:'NO_CREDITS',message:'クレジットがありません。'});
    consumed=true;
    console.log('[Iconia] credit consumed',Date.now()-started,'ms');
    const body=req.body||{};
    const message=String(body.message||'').trim();
    const image=typeof body.image==='string'&&body.image.startsWith('data:image/')?body.image:null;
    const key=chooseFormat(body),fmt=formatInfo(key);
    if(!message&&!image)throw new Error('画像またはメッセージを入力してください。');
    if(image&&image.length>9_500_000)return res.status(413).json({success:false,error:'参考画像が大きすぎます。もう少し小さい画像を使ってください。'});

    // Critical fast path: image + text/logo requests no longer invoke the slow
    // GPT planner first. The image model itself handles composition and typography.
    // This avoids the previous 60-second Vercel Hobby timeout.
    if(image&&hasDesignRequest(message)){
      const {buffer,mime}=dataImageToBuffer(image);
      const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
      console.log('[Iconia] direct design edit',Date.now()-started,'ms');
      const result=await withTimeout(client.images.edit({model:IMAGE_MODEL,image:await toFile(buffer,`reference.${ext}`,{type:mime}),prompt:buildDesignPrompt(message,fmt),size:fmt.size,quality:'low',output_format:'jpeg',output_compression:88,n:1}),50000,'画像生成');
      const b64=result?.data?.[0]?.b64_json;
      if(!b64)throw new Error('画像データがAIから返されませんでした。');
      const output=await withTimeout(fit(`data:image/jpeg;base64,${b64}`,fmt),8000,'画像仕上げ');
      console.log('[Iconia] direct design response ready',Date.now()-started,'ms');
      return res.status(200).json({success:true,image:output,reply:'できました。画像の雰囲気に合わせて文字・ロゴをデザインしました。',plan:{mode:'AI_DESIGN_FAST',format:key,formatLabel:fmt.label}});
    }

    // New images also use a short direct path. Low quality is intentional here:
    // it keeps the request reliably inside the Hobby execution window.
    if(!image){
      console.log('[Iconia] direct image request',Date.now()-started,'ms');
      const result=await withTimeout(client.images.generate({model:IMAGE_MODEL,prompt:buildGeneratePrompt(message,fmt),size:fmt.size,quality:'low',output_format:'jpeg',output_compression:88,n:1}),50000,'画像生成');
      const b64=result?.data?.[0]?.b64_json;
      if(!b64)throw new Error('画像データがAIから返されませんでした。');
      const output=await withTimeout(fit(`data:image/jpeg;base64,${b64}`,fmt),8000,'画像仕上げ');
      console.log('[Iconia] direct response ready',Date.now()-started,'ms');
      return res.status(200).json({success:true,image:output,reply:'できました。',plan:{mode:'FAST_GENERATE',format:key,formatLabel:fmt.label}});
    }

    // Complex image edits keep the full planner path, but only when the request
    // cannot be handled by the fast design path above.
    console.log('[Iconia] full context generation',Date.now()-started,'ms');
    await generateHandler(req,res);
    if(Number(res.statusCode||200)>=400&&consumed){try{await rpc('refund_iconia_credit',userId);}catch{}}
  }catch(error){
    if(consumed&&userId){try{await rpc('refund_iconia_credit',userId);}catch{}}
    console.error('Iconia fast generation error',error);
    if(!res.headersSent)return res.status(503).json({success:false,error:error?.message||'画像生成サービスでエラーが発生しました。'});
  }
}
