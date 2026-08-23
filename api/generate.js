import OpenAI, { toFile } from "openai";
import sharp from "sharp";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-image-2";
const clean = (v, max = 7000) => String(v ?? "").trim().slice(0, max);
function imageBuffer(dataUrl) { const m = String(dataUrl || "").match(/^data:image\/[^;]+;base64,(.+)$/); if (!m) throw new Error("画像データを読み込めませんでした。"); return Buffer.from(m[1], "base64"); }
function detectSize(text) { const t = String(text || "").toLowerCase(); if (/(x|twitter).*(ヘッダー|header)|ヘッダー|banner|バナー|横長/.test(t)) return "1536x1024"; if (/縦長|portrait|ストーリー|story|tiktok/.test(t)) return "1024x1536"; return "1024x1024"; }
function wantsHighQuality(text) { return /高品質|高画質|最高|細かく|超高精細|精密|high quality|high-res/i.test(String(text || "")); }

function extractRequestedText(message) {
  const t = String(message || "").trim();
  const quoted = t.match(/[「『“](.{1,60})[」』”]/);
  if (quoted?.[1]) return quoted[1].trim();
  const patterns = [
    /(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名)\s*(?:は|：|:|=)\s*[「『“]?([A-Za-z0-9._-]{1,40})[」』”]?/i,
    /[「『“]?([A-Za-z][A-Za-z0-9._-]{0,39})[」』”]?\s*(?:の文字|という文字)/i,
    /[「『“]?([A-Za-z][A-Za-z0-9._-]{0,39})[」』”]?\s*(?:だけ(?:を|に)?|のみ(?:を|に)?)/i,
    /[「『“]?([A-Za-z][A-Za-z0-9._-]{0,39})[」』”]?\s*を\s*(?:入れて|追加して|入れたい|入れてください)/i,
  ];
  for (const re of patterns) { const m = t.match(re); if (m?.[1]) return m[1].trim(); }
  // Natural requests such as "元画像そのまま + AxLFだけ".
  if (/(?:文字|ロゴ|名前|クラン|チーム|同盟)|原画|元画像|そのまま|だけ|追加/.test(t)) {
    const tokens = t.match(/\b[A-Za-z][A-Za-z0-9._-]{1,39}\b/g) || [];
    const stop = new Set(["AI","SNS","X","Twitter","Instagram","LINE"]);
    const candidate = tokens.find(v => !stop.has(v) && /[A-Z]/.test(v) && /[a-z]/.test(v));
    if (candidate) return candidate;
  }
  return null;
}

function isTextOnlyRequest(message, hasImage) {
  if (!hasImage) return false;
  const t = String(message || "");
  const text = extractRequestedText(t);
  if (!text) return false;
  const hasOtherEdit = /背景(?:だけ|のみ|を変更|を変え)|ポーズ(?:だけ|のみ|を変更|を変え)|髪(?:だけ|型だけ|のみ|を変更|を変え)|服(?:だけ|装だけ|のみ|を変更|を変え)/.test(t);
  return !hasOtherEdit && /文字|テキスト|ロゴ|名前|クラン|チーム|同盟|そのまま|原画|元画像|だけ|のみ|追加|入れ|入れて|\+/.test(t);
}
function editMode(message, hasImage) {
  if (!hasImage) return "ORIGINAL";
  if (isTextOnlyRequest(message, true)) return "TEXT_ONLY";
  const t = String(message || "");
  if (/背景だけ|背景のみ|背景を変更|背景を変え/.test(t)) return "BACKGROUND_ONLY";
  if (/ポーズだけ|ポーズのみ|ポーズを変更|ポーズを変え/.test(t)) return "POSE_ONLY";
  if (/髪だけ|髪型だけ|髪のみ|髪を変更|髪を変え/.test(t)) return "HAIR_ONLY";
  if (/服だけ|衣装だけ|服装だけ|衣装を変更|服を変更/.test(t)) return "CLOTHING_ONLY";
  if (/ほぼそのまま|ほとんどそのまま|原画のまま|原画をそのまま|できるだけそのまま|極力そのまま|原型を残|原画維持|原画を維持|元画像.*そのまま/.test(t)) return "FAITHFUL";
  return "TARGETED_EDIT";
}
function svgEscape(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&apos;"); }

function textStyle(message, width, height) {
  const t = String(message || ""), min = Math.min(width,height); let style="esports";
  if (/高級|高級感|ブランド|ラグジュアリー|luxury|premium|elegant/i.test(t)) style="luxury"; else if (/サイバー|サイバーパンク|ネオン|未来|cyber|neon|sci-fi/i.test(t)) style="cyber"; else if (/和風|和|日本|筆|墨|侍|忍者|japanese|brush/i.test(t)) style="japanese"; else if (/可愛い|かわいい|キュート|cute|ゆめかわ/i.test(t)) style="cute"; else if (/ゴシック|ダーク|闇|冷酷|悪|gothic|dark/i.test(t)) style="gothic"; else if (/シンプル|上品|minimal|minimalist/i.test(t)) style="minimal"; else if (/メタル|金属|メタリック|metal|chrome/i.test(t)) style="metal";
  const palettes={esports:["#FFFFFF","#6BC7FF","#5A35FF"],luxury:["#FFF7C7","#F2B63D","#7A470A"],cyber:["#EFFFFF","#28DFFF","#7447FF"],japanese:["#FFFFFF","#FF4A4A","#7A0714"],cute:["#FFF5FC","#FF79C6","#8D63FF"],gothic:["#FFFFFF","#B79BFF","#29134F"],minimal:["#FFFFFF","#D9E2EC","#657487"],metal:["#FFFFFF","#B8C4D0","#3E4855"]};
  let colors=palettes[style]; if(/金|ゴールド|gold/i.test(t))colors=["#FFF8C8","#F2B63D","#8A5A14"]; else if(/紫|パープル|purple/i.test(t))colors=["#F4E9FF","#A76BFF","#5120A8"]; else if(/青|ブルー|blue/i.test(t))colors=["#F0FFFF","#39B9FF","#1E4FFF"]; else if(/赤|レッド|red/i.test(t))colors=["#FFF1F1","#FF4A5F","#9C0F22"]; else if(/緑|グリーン|green/i.test(t))colors=["#EFFFF5","#42E88B","#087A4A"]; else if(/ピンク|pink/i.test(t))colors=["#FFF1FA","#FF69B4","#A23BFF"]; else if(/黒|ブラック|black/i.test(t))colors=["#EEF1F5","#4B5563","#05070B"];
  const size=Math.min(Math.max(48,Math.round(min*(/かなり大き|とても大き|超大き/.test(t)?.125:/大きく|大きめ/.test(t)?.095:.078))),Math.max(48,Math.floor(width/2.7)));
  let anchor="middle",x=width/2,y=height-Math.round(height*.075); if(/右下/.test(t)){anchor="end";x=width-Math.round(width*.055);y=height-Math.round(height*.065)} else if(/左下/.test(t)){anchor="start";x=Math.round(width*.055);y=height-Math.round(height*.065)} else if(/右上/.test(t)){anchor="end";x=width-Math.round(width*.055);y=Math.round(height*.105)} else if(/左上/.test(t)){anchor="start";x=Math.round(width*.055);y=Math.round(height*.105)} else if(/中央|真ん中|センター/.test(t))y=height/2;
  const glow=/光|発光|ネオン|glow|neon/i.test(t)||style==="cyber",italic=/斜め|斜体|スタイリッシュ|シャープ|カッコよく|かっこよく|クール|ロゴ|gaming|esports/i.test(t)||style==="esports"||style==="cyber";
  const fontFamily={esports:"Impact, Haettenschweiler, Arial Black, sans-serif",luxury:"Georgia, Times New Roman, serif",cyber:"Arial Black, Impact, sans-serif",japanese:"Impact, Arial Black, sans-serif",cute:"Arial Rounded MT Bold, Arial, sans-serif",gothic:"Georgia, Times New Roman, serif",minimal:"Arial, Helvetica, sans-serif",metal:"Impact, Arial Black, sans-serif"}[style];
  const weight=style==="luxury"||style==="gothic"?700:900,letterSpacing=style==="luxury"?Math.round(size*.04):Math.round(size*.012),rotation=/斜め|斜体/.test(t)?-6:style==="japanese"?-2:style==="esports"?-3:0,accent=style==="japanese"?"#D82038":style==="luxury"?"#FFF1A6":style==="cyber"?"#36E9FF":style==="cute"?"#FFD7EF":"#FFFFFF";
  return {style,colors,size,anchor,x,y,glow,italic,fontFamily,weight,letterSpacing,rotation,accent};
}
async function addExactText(buffer,message){
  const text=extractRequestedText(message); if(!text) return buffer; const meta=await sharp(buffer).metadata(),width=meta.width||1024,height=meta.height||1024,s=textStyle(message,width,height),safe=svgEscape(text),id=`logo${Date.now()}${Math.floor(Math.random()*10000)}`;
  const stroke=s.style==="luxury"?"#3A2609":s.style==="cute"?"#5D2B67":"#070A12",outer=Math.max(5,Math.round(s.size*.06)),inner=Math.max(1,Math.round(s.size*.018)),shadowY=Math.max(5,Math.round(s.size*.075)),blur=Math.max(3,Math.round(s.size*.045)),glowColor=s.colors[1];
  const defs=`<linearGradient id="${id}grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${s.colors[0]}"/><stop offset="45%" stop-color="${s.colors[1]}"/><stop offset="100%" stop-color="${s.colors[2]}"/></linearGradient><linearGradient id="${id}shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.9"/><stop offset="45%" stop-color="#FFFFFF" stop-opacity="0.18"/><stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient><filter id="${id}shadow" x="-50%" y="-50%" width="200%" height="210%"><feDropShadow dx="0" dy="${shadowY}" stdDeviation="${blur}" flood-color="#000000" flood-opacity="0.85"/></filter><filter id="${id}glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${Math.max(5,Math.round(s.size*.1))}" result="blur"/><feFlood flood-color="${glowColor}" flood-opacity="0.75"/><feComposite in2="blur" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const transform=`rotate(${s.rotation} ${s.x} ${s.y})${s.italic?" skewX(-6)":""}`,filter=s.glow?`url(#${id}glow)`:`url(#${id}shadow)`,common=`x="${s.x}" y="${s.y}" text-anchor="${s.anchor}" font-family="${s.fontFamily}" font-size="${s.size}px" font-weight="${s.weight}" letter-spacing="${s.letterSpacing}px" stroke-linejoin="round" paint-order="stroke"`;
  const decoLeft=Math.max(0,s.x-s.size*1.45),decoRight=Math.min(width,s.x+s.size*1.45),decorative=s.style==="esports"?`<path d="M ${decoLeft} ${s.y+s.size*.18} L ${decoLeft+s.size*.32} ${s.y+s.size*.03} L ${decoLeft+s.size*.58} ${s.y+s.size*.18} M ${decoRight} ${s.y+s.size*.18} L ${decoRight-s.size*.32} ${s.y+s.size*.03} L ${decoRight-s.size*.58} ${s.y+s.size*.18}" stroke="${s.accent}" stroke-width="${Math.max(3,s.size*.018)}" fill="none" opacity=".9"/>`:"";
  const svg=`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs><g transform="${transform}" filter="${filter}">${decorative}<text ${common} fill="url(#${id}grad)" stroke="${stroke}" stroke-width="${outer}">${safe}</text><text ${common} fill="url(#${id}grad)" stroke="#FFFFFF" stroke-opacity=".28" stroke-width="${inner}">${safe}</text><text ${common} fill="url(#${id}shine)" stroke="none" opacity=".52">${safe}</text></g></svg>`;
  return sharp(buffer).composite([{input:Buffer.from(svg),top:0,left:0}]).jpeg({quality:94}).toBuffer();
}

function buildPrompt({message,history,hasImage,mode}){const recent=Array.isArray(history)?history.slice(-8).map(x=>`${x.role==="user"?"USER":"ASSISTANT"}: ${clean(x.text,1200)}`).join("\n"):"";const requestedText=extractRequestedText(message);return `You are Iconia AI, a professional conversational image creation and editing assistant.\nThe user speaks naturally in Japanese. Create the image directly and interpret the request like a skilled art director.\n\nLATEST REQUEST:\n${clean(message)}\n\nRECENT CONVERSATION:\n${recent||"No previous conversation."}\n\nREFERENCE IMAGE: ${hasImage?"YES":"NO"}\nEDIT MODE: ${mode}\n\nREFERENCE FIDELITY:\n- A reference image is the primary visual source, not merely inspiration.\n- Preserve identity, face, hairstyle, body proportions, clothing, accessories, distinctive marks, colors and composition unless the user explicitly asks to change them.\n- FAITHFUL mode: preserve the source as closely as possible and make only explicitly requested changes.\n- TEXT_ONLY mode: DO NOT redraw or regenerate the reference. The application will overlay the exact requested text after generation.\n- BACKGROUND_ONLY: keep the character and important details stable; change only the requested environment/background.\n- POSE_ONLY: keep identity, face, hair, outfit and visual style stable; change only pose/framing.\n- HAIR_ONLY: change only hair-related details.\n- CLOTHING_ONLY: change only clothing/armor/accessories requested.\n- TARGETED_EDIT: change the requested parts while preserving everything else.\n\nTEXT:\n- Requested exact text: ${requestedText||"none"}\n- Never invent or add text that the user did not request.\n- If exact text is requested, DO NOT render that text yourself. The application will add it afterward so spelling stays exact.\n- Do not add watermarks, signatures, usernames, logos or decorative words unless explicitly requested.\n\nORIGINAL CREATION:\n- Without a reference image, create a completely original character/artwork from the user's description.\n- Make strong creative choices when details are unspecified; do not force forms or categories.\n\nFORMAT:\n- Game icons and SNS profile images should have strong subject readability and safe cropping.\n- Headers and banners should use wide composition.\n- Respect explicit aspect ratio/format requests.\n\nQUALITY:\n- Professional game/SNS artwork, clean anatomy, coherent lighting, readable silhouettes, detailed materials and intentional composition.\n- Do not explain the prompt. Generate the image directly.`}

export default async function handler(req,res){if(req.method!=="POST")return res.status(405).json({success:false,error:"POSTリクエストのみ対応しています。"});try{if(!process.env.OPENAI_API_KEY)return res.status(500).json({success:false,error:"OPENAI_API_KEY がVercelに設定されていません。"});const body=req.body||{},message=clean(body.message),image=typeof body.image==="string"&&body.image.startsWith("data:image/")?body.image:null,history=Array.isArray(body.history)?body.history:[];if(!message&&!image)return res.status(400).json({success:false,error:"画像またはメッセージを入力してください。"});const size=detectSize(message),quality=wantsHighQuality(message)?"high":"low",mode=editMode(message,Boolean(image)),requestedText=extractRequestedText(message),prompt=buildPrompt({message,history,hasImage:Boolean(image),mode});let outputBuffer;
if(image){const sourceBuffer=imageBuffer(image);if(mode==="TEXT_ONLY"){outputBuffer=await addExactText(sourceBuffer,message);}else{const file=await toFile(sourceBuffer,"reference.jpg",{type:"image/jpeg"});const response=await client.images.edit({model:MODEL,image:file,prompt,size,quality,output_format:"jpeg",output_compression:72,n:1});const base64=response?.data?.[0]?.b64_json;if(!base64)throw new Error("画像データがOpenAIから返されませんでした。");outputBuffer=Buffer.from(base64,"base64");if(requestedText)outputBuffer=await addExactText(outputBuffer,message);}}else{const response=await client.images.generate({model:MODEL,prompt,size,quality,output_format:"jpeg",output_compression:72,n:1});const base64=response?.data?.[0]?.b64_json;if(!base64)throw new Error("画像データがOpenAIから返されませんでした。");outputBuffer=Buffer.from(base64,"base64");if(requestedText)outputBuffer=await addExactText(outputBuffer,message);}
const base64=outputBuffer.toString("base64");return res.status(200).json({success:true,image:`data:image/jpeg;base64,${base64}`,reply:"できました。気になるところがあれば、そのまま続けて指示してください。"});}catch(error){console.error("ICONIA API ERROR",error);return res.status(Number(error?.status)||500).json({success:false,error:error?.error?.message||error?.message||"不明なエラーが発生しました。",code:error?.error?.code||error?.code||null,type:error?.error?.type||error?.type||null});}}
