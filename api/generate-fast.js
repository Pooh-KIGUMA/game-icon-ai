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
function dataImageToBuffer(value){ const m=String(value||'').match(/^data:image\/([^;]+),base64,(.+)$/); if(!m)throw new Error('参考画像を読み込めませんでした。'); const mime=`image/${m[1].toLowerCase()}`; if(!['image/jpeg','image/png','image/webp'].includes(mime))throw new Error('参考画像はJPG・PNG・WebPに対応しています。'); return {buffer:Buffer.from(m[2],'base64'),mime}; }

// Vercel Functions have a 4.5 MB response payload limit. Returning a full
// base64 JPEG at high quality can exceed that limit and Safari reports it as
// "Load failed" even when the function itself completed with HTTP 200.
// Keep the exact requested canvas size, but compress the JPEG until the data
// URL is comfortably below the platform limit.
async function fit(dataUrl,fmt){
  const {buffer}=dataImageToBuffer(dataUrl);
  const qualities=[82,76,70,64,58,52];
  for(const quality of qualities){
    const out=await sharp(buffer)
      .resize(fmt.w,fmt.h,{fit:'cover',position:'attention'})
      .jpeg({quality,progressive:true,mozjpeg:true})
      .toBuffer();
    const encoded=`data:image/jpeg;base64,${out.toString('base64')}`;
    if(encoded.length<=3_700_000)return encoded;
  }
  const out=await sharp(buffer)
    .resize(fmt.w,fmt.h,{fit:'cover',position:'attention'})
    .jpeg({quality:45,progressive:true,mozjpeg:true})
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

function hasDesignRequest(message){ return /(文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名|ギルド名|入れて|書いて|デザイン|かっこよく|おしゃれ|ロゴ風)/iu.test(String(message||'')); }
function designVariant(message='',image=''){
  const variants=[
    'FRAME CREST: build the wordmark into the circular/frame geometry. Prefer an upper arc or lower side arc, with a compact emblem and generous breathing room around the face. Do not span the entire width.',
    'SIDE EMBLEM: place the wordmark in a strong left or right negative-space lane, slightly angled to follow the subject. Use a compact badge/insignia treatment rather than a banner across the character.',
    'TOP ARC: use the upper third or upper arc of the composition. Let the wordmark echo the existing rim/energy shape, keeping the face and head silhouette completely clear.',
    'LOWER CORNER: use one lower corner or lower-side pocket of negative space. Keep the wordmark medium-sized and integrate a small emblem with the existing effects instead of a giant title.',
    'INTERLOCK: create a compact custom wordmark that interlocks with a non-critical frame, weapon, energy ring or ornament. The letters may overlap the frame but must remain away from eyes and facial features.',
    'ASYMMETRIC BADGE: deliberately avoid symmetry. Choose the visually quieter side of the image and build a small premium esports badge/wordmark there, using the image palette and lighting.'
  ];
  const imageSeed=String(image||'').slice(0,220000);
  const seed=crypto.createHash('sha256').update(String(message||'')).update('|').update(imageSeed).digest().readUInt32BE(0);
  return variants[seed%variants.length];
}
function buildDesignPrompt(message,fmt,variant){ return `Create a premium commercial-quality gaming icon/edit from the supplied reference image.

USER REQUEST:
${message}

OUTPUT: ${fmt.label}.

ACT AS A PROFESSIONAL GAME-ICON ART DIRECTOR. This is a real logo-composition task, not a text-overlay task. Analyze the whole reference before rendering.

ART-DIRECTION PASS — DO THIS BEFORE DRAWING:
1. Identify the primary focal point, face/eyes, subject silhouette, secondary focal points, negative space, frame/rim geometry, dominant palette, light direction, energy effects, perspective, safe margins and visual balance.
2. Mentally test at least three genuinely different logo compositions against THIS reference image. Compare them for hierarchy, readability, balance and obstruction risk, then choose the strongest one.
3. REQUIRED COMPOSITION DIRECTION FOR THIS VERSION:
${variant}
4. The composition choice must be driven by the actual reference image. Do not force the chosen direction if it would fight the subject; adapt its position, angle and scale to the image's real negative space.
5. The subject remains first in the hierarchy. The custom wordmark is second. Supporting effects are third.
6. Never cover eyes, face, head silhouette or defining focal details just to fit the text. If space is tight, reduce the wordmark and integrate it into the frame instead.
7. The requested wordmark must be readable at small game-icon size, but short text must NOT become an oversized title. Use the smallest scale that still gives the logo strong presence.
8. Build a custom wordmark specifically for this image: distinctive letter silhouette, controlled tracking, intentional width/slant, palette-matched material, bevel/depth, selective outline, shadow, highlights and restrained glow. Avoid ordinary fonts and avoid a pasted sticker appearance.
9. Integrate the lettering with existing physical design language: frame, blades, armor, lightning, flames, smoke, magical energy, particles and ornaments can influence the logo's geometry and effects. Match the scene lighting and perspective.
10. Use asymmetry or controlled overlap when it improves the design, but never obscure defining facial details.
11. Before finalizing, zoom out mentally to thumbnail size and check that the subject is still immediately recognizable and the requested wordmark is still legible. Remove any decorative detail that reduces clarity.

ANTI-PATTERNS — DO NOT DO THESE:
- Do not automatically center the text.
- Do not automatically put the text across the face or muzzle.
- Do not automatically put a giant metallic wordmark across the entire bottom.
- Do not reuse the same placement, font treatment or composition as a generic template.
- Do not use plain sans-serif/caption text, sticker text or UI-like typography.
- Do not add unrelated text, fake brand names, watermarks or signatures.
- Do not redesign the character just to accommodate the logo.

IDENTITY RULES:
- Preserve the recognizable subject, face, hair, clothing, pose, important objects and overall composition unless the user explicitly asks to change them.
- Preserve the reference's strongest visual identity.
- Keep defining focal details unobstructed.

TEXT RULES:
- Spell every requested word exactly.
- Include requested text only once unless repetition is explicitly requested.
- Treat requested text as a custom professional wordmark/emblem, never as a plain caption.
- No unrelated text, logos, watermarks or signatures.

QUALITY BAR:
The final result should look like a finished commercial game icon that a professional designer intentionally composed around this exact reference. The logo should feel native to the artwork, not pasted on afterward.

Return one final image only.`; }
function buildGeneratePrompt(message,fmt){ return `Create a premium commercial-quality gaming icon directly from this request.
USER REQUEST: ${message}
OUTPUT: ${fmt.label}.

Act as a professional game-icon art director. First analyze the requested subject and mentally test multiple composition options. If text or a logo is requested, deliberately choose the best placement from the actual composition rather than using a fixed center/bottom template. Protect faces and defining focal details. Decide the wordmark's scale, orientation, spacing, letterform character, depth, outline, shadow, glow, texture, color and emblem treatment from the image's visual language. Integrate the wordmark with existing geometry, lighting and effects so it feels native to the artwork.

The final composition must have a clear hierarchy: subject first, custom wordmark second, supporting effects third. Short requested words such as AxLF should become distinctive premium esports-style wordmarks, not generic captions. Do not use giant default metallic text, sticker-like text, plain captions, unrelated text, watermarks or signatures. Preserve requested spelling exactly and include requested text only once.`; }
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

    if(image&&hasDesignRequest(message)){
      const {buffer,mime}=dataImageToBuffer(image);
      const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
      const variant=designVariant(message,image);
      console.log('[Iconia] direct design edit',Date.now()-started,'ms',variant);
      const result=await withTimeout(client.images.edit({model:IMAGE_MODEL,image:await toFile(buffer,`reference.${ext}`,{type:mime}),prompt:buildDesignPrompt(message,fmt,variant),size:fmt.size,quality:'medium',output_format:'jpeg',output_compression:90,n:1}),120000,'画像生成');
      const b64=result?.data?.[0]?.b64_json;
      if(!b64)throw new Error('画像データがAIから返されませんでした。');
      const output=await withTimeout(fit(`data:image/jpeg;base64,${b64}`,fmt),8000,'画像仕上げ');
      console.log('[Iconia] direct design response ready',Date.now()-started,'ms',Math.round(output.length/1024),'KB');
      return res.status(200).json({success:true,image:output,reply:'できました。画像全体を分析し、今回の画像に合うロゴ構成・文字デザインで仕上げました。',plan:{mode:'AI_DESIGN_MEDIUM',format:key,formatLabel:fmt.label,designVariant:variant}});
    }

    if(!image){
      console.log('[Iconia] direct image request',Date.now()-started,'ms');
      const result=await withTimeout(client.images.generate({model:IMAGE_MODEL,prompt:buildGeneratePrompt(message,fmt),size:fmt.size,quality:'low',output_format:'jpeg',output_compression:88,n:1}),50000,'画像生成');
      const b64=result?.data?.[0]?.b64_json;
      if(!b64)throw new Error('画像データがAIから返されませんでした。');
      const output=await withTimeout(fit(`data:image/jpeg;base64,${b64}`,fmt),8000,'画像仕上げ');
      console.log('[Iconia] direct response ready',Date.now()-started,'ms',Math.round(output.length/1024),'KB');
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
