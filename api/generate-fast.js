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
function buildDesignPrompt(message,fmt){ return `Create a premium commercial-quality gaming icon/edit from the supplied reference image.

USER REQUEST:
${message}

OUTPUT: ${fmt.label}.

ACT AS A PROFESSIONAL GAME-ICON ART DIRECTOR. Do not simply place text on top of the image. Before rendering, make a deliberate composition decision as if this were a paid esports/team-logo commission.

DESIGN DECISION PROCESS:
1. Inspect the entire reference and identify the primary focal point, secondary focal point, strongest negative-space zones, existing frame/rim geometry, dominant color palette, light direction, energy effects, perspective and visual balance.
2. Create 3 possible mental logo placements and choose the strongest one. Do not use a fixed template and do not default to the center. The best placement may be a lower arc, upper arc, left/right negative space, inside or along the frame, beside the subject, or another compositionally strong location.
3. Protect the subject. Never cover the eyes, face, head silhouette, weapon tip, or other defining focal detail merely to make room for text. If the only available area is crowded, reduce the wordmark or integrate it into the frame instead.
4. Decide the wordmark's scale from the composition. It should be prominent and readable at small game-icon size, but it must not dominate the character. Avoid the common mistake of making a short word huge just because it is the requested text.
5. Build a custom logo treatment specifically for this image. Select letterform character, width, tracking, slant/perspective, bevel, depth, outline, shadow, glow, texture, highlights and emblem geometry based on the reference. The treatment should look intentionally designed, not like a default font.
6. Integrate the logo into the scene's physical design language. Existing circles, armor, blades, lightning, flames, smoke, magical energy, borders and other shapes may become part of the logo's frame or supporting ornament. Match the scene's lighting so reflections, highlights, shadows and glow feel physically consistent.
7. Use controlled overlap only when it improves the composition. A logo can partially intersect a frame, energy ring or non-critical background element, but it should not obscure the face or main subject.
8. Establish hierarchy: SUBJECT first, CUSTOM WORDMARK second, SUPPORTING EFFECTS third. The finished image should still look strong if the viewer sees it for one second.
9. If the requested text is short, such as AxLF, treat it as a premium esports wordmark or emblem. Give the letters distinctive character and spacing rather than rendering them as a generic caption.
10. Before finalizing, visually check the result for balance, readability, safe margins and whether the logo genuinely looks like it belongs to the original artwork.

ANTI-PATTERN RULES:
- Do NOT automatically center the requested text.
- Do NOT automatically put the text across the character's face or muzzle.
- Do NOT automatically use a giant metallic fantasy font at the bottom.
- Do NOT use generic caption styling, plain text, sticker-like text or a pasted-on appearance.
- Do NOT force the same placement, font treatment or color treatment across different images.
- Do NOT add unrelated decorative text, fake brand names, watermarks or signatures.
- Do NOT redesign the character just to accommodate the wordmark.

IDENTITY RULES:
- Preserve the recognizable subject, face, hair, clothing, pose, important objects and overall composition unless the user explicitly asks to change them.
- Preserve the reference's strongest visual identity while improving only what the request requires.
- Keep faces and defining focal details unobstructed whenever possible.

TEXT RULES:
- Spell every requested word exactly.
- Include the requested text only once unless the user explicitly asks for repetition.
- Treat requested text as an integrated professional logo/wordmark, never as a plain pasted caption.
- No unrelated text, logos, watermarks or signatures.

FINAL QUALITY BAR:
The result should look like a finished commercial game icon that a professional designer intentionally composed around the reference image—not an AI image with text pasted onto it.

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

    // Fast design path: image + text/logo requests go directly to the image model.
    // The prompt performs image-specific art direction before rendering.
    if(image&&hasDesignRequest(message)){
      const {buffer,mime}=dataImageToBuffer(image);
      const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
      console.log('[Iconia] direct design edit',Date.now()-started,'ms');
      const result=await withTimeout(client.images.edit({model:IMAGE_MODEL,image:await toFile(buffer,`reference.${ext}`,{type:mime}),prompt:buildDesignPrompt(message,fmt),size:fmt.size,quality:'low',output_format:'jpeg',output_compression:88,n:1}),50000,'画像生成');
      const b64=result?.data?.[0]?.b64_json;
      if(!b64)throw new Error('画像データがAIから返されませんでした。');
      const output=await withTimeout(fit(`data:image/jpeg;base64,${b64}`,fmt),8000,'画像仕上げ');
      console.log('[Iconia] direct design response ready',Date.now()-started,'ms');
      return res.status(200).json({success:true,image:output,reply:'できました。画像全体を分析して、この画像専用の文字・ロゴ構成にしました。',plan:{mode:'AI_DESIGN_FAST',format:key,formatLabel:fmt.label}});
    }

    if(!image){
      console.log('[Iconia] direct image request',Date.now()-started,'ms');
      const result=await withTimeout(client.images.generate({model:IMAGE_MODEL,prompt:buildGeneratePrompt(message,fmt),size:fmt.size,quality:'low',output_format:'jpeg',output_compression:88,n:1}),50000,'画像生成');
      const b64=result?.data?.[0]?.b64_json;
      if(!b64)throw new Error('画像データがAIから返されませんでした。');
      const output=await withTimeout(fit(`data:image/jpeg;base64,${b64}`,fmt),8000,'画像仕上げ');
      console.log('[Iconia] direct response ready',Date.now()-started,'ms');
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
