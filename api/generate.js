import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import fs from "node:fs/promises";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PLANNER_MODEL = "gpt-5.6";
const IMAGE_MODEL = "gpt-image-2";
const clean = (v, n = 12000) => String(v ?? "").trim().slice(0, n);
const uniq = (a) => [...new Set((Array.isArray(a) ? a : []).map(x => clean(x, 800)).filter(Boolean))];

let japaneseFontReady = null;
async function ensureJapaneseFont() {
  if (japaneseFontReady) return japaneseFontReady;
  japaneseFontReady = (async () => {
    const dir = "/tmp/iconia-fonts";
    const fontPath = `${dir}/NotoSansJP-VF.ttf`;
    const configPath = `${dir}/fonts.conf`;
    await fs.mkdir(dir, { recursive: true });
    try { await fs.access(fontPath); }
    catch {
      const r = await fetch("https://github.com/notofonts/noto-cjk/raw/main/Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf");
      if (!r.ok) throw new Error(`日本語フォントの取得に失敗しました (${r.status})`);
      await fs.writeFile(fontPath, Buffer.from(await r.arrayBuffer()));
    }
    await fs.writeFile(configPath, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${dir}</dir><cachedir>/tmp/iconia-font-cache</cachedir><match target="pattern"><edit name="family" mode="prepend"><string>Noto Sans CJK JP</string></edit></match></fontconfig>`);
    process.env.FONTCONFIG_FILE = configPath;
    process.env.FONTCONFIG_PATH = dir;
    return fontPath;
  })().catch(e => { japaneseFontReady = null; throw e; });
  return japaneseFontReady;
}

function dataImageToBuffer(value) {
  const m = String(value || "").match(/^data:image\/([^;]+);base64,(.+)$/);
  if (!m) throw new Error("参考画像を読み込めませんでした。");
  const mime = `image/${m[1].toLowerCase()}`;
  if (!["image/jpeg","image/png","image/webp"].includes(mime)) throw new Error("参考画像はJPG・PNG・WebPに対応しています。");
  return { buffer: Buffer.from(m[2], "base64"), mime };
}
function imageSize(text) {
  const t = String(text || "").toLowerCase();
  if (/縦長|portrait|story|ストーリー|tiktok/.test(t)) return "1024x1536";
  if (/横長|landscape|header|ヘッダー|banner|バナー|youtube|サムネ/.test(t)) return "1536x1024";
  return "1024x1024";
}
function exactText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const quoted = [...t.matchAll(/[「『“"]([^」』”"]{1,120})[」』”"]/gu)].map(m => m[1].trim()).filter(Boolean);
  if (quoted.length) return quoted.join("\n");
  const possessive = t.match(/(?:^|\s|[「『])([A-Za-z0-9][A-Za-z0-9 _+\-.]{0,39})の(?:文字|テキスト|ロゴ)(?=\s*(?:を|は|に))/u);
  if (possessive?.[1]) return possessive[1].trim();
  const englishLead = t.match(/(?:^|\s)([A-Za-z0-9][A-Za-z0-9 _+\-.]{0,39})\s*(?:という)?(?:文字|テキスト|ロゴ)(?=\s*(?:を|は|に))/u);
  if (englishLead?.[1]) return englishLead[1].trim();
  const m = t.match(/(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名|ギルド名)\s*(?:は|を|：|:)\s*[「『“"]?([^」』”"\n]{1,100})/u);
  return m?.[1]?.trim() || null;
}
function textPosition(text) {
  const t = String(text || "").toLowerCase();
  if (/右|right/.test(t)) return "right";
  if (/左|left/.test(t)) return "left";
  if (/上|top/.test(t)) return "top";
  if (/下|bottom/.test(t)) return "bottom";
  return null;
}
function isTextOnlyRequest(message, hasImage) {
  if (!hasImage) return false;
  const t = String(message || "");
  if (!exactText(t)) return false;
  if (!/(文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名|ギルド名)/u.test(t)) return false;
  return !/(背景|ポーズ|髪|髪型|服|衣装|人物|顔|構図|キャラ|イラストタッチ|画風|絵柄|スタイル).*(変え|変更|追加|消し|削除|描き|書き直)/u.test(t);
}
function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const s = String(text || ""); const a = s.indexOf("{"); const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) try { return JSON.parse(s.slice(a,b+1)); } catch {}
  return {};
}

async function makePlan(message, image, history) {
  const recent = (Array.isArray(history) ? history.slice(-20) : []).map((m,i) => `${i+1}. ${m.role === "user" ? "USER" : "ASSISTANT"}: ${clean(m.text,1500)}`).join("\n");
  const system = `You are the high-precision visual planning brain for Iconia AI.\nUnderstand the whole conversation and produce an exact image operation.\nWhen a reference image exists, preserve identity, composition and all unmentioned details.\nFor text requests, preserve the exact requested characters. If typography details are not specified, choose placement, size, weight, color, outline, shadow and angle that best fit the reference.\nReturn JSON only: {"mode":"ORIGINAL|FAITHFUL|STYLE_ONLY|TARGETED_EDIT|AI_DESIGN|BACKGROUND_ONLY|POSE_ONLY|HAIR_ONLY|CLOTHING_ONLY|TEXT_ONLY","requested_text":string|null,"text_position":string|null,"text_style":string|null,"keep":string[],"change":string[],"style":string,"composition":string,"image_prompt":string,"reply":string}`;
  const content = [{type:"input_text",text:`LATEST REQUEST:\n${clean(message)}\n\nRECENT CONVERSATION:\n${recent || "none"}\n\nREFERENCE IMAGE: ${image ? "YES" : "NO"}`}];
  if (image) content.push({type:"input_image",image_url:image,detail:"high"});
  const r = await client.responses.create({ model:PLANNER_MODEL, reasoning:{effort:"high"}, input:[{role:"developer",content:system},{role:"user",content}], max_output_tokens:2200 });
  return parseJson(r.output_text);
}
function normalize(plan,message,hasImage) {
  let mode = String(plan?.mode || (hasImage ? "TARGETED_EDIT" : "ORIGINAL")).toUpperCase();
  const allowed = new Set(["ORIGINAL","FAITHFUL","STYLE_ONLY","TARGETED_EDIT","AI_DESIGN","BACKGROUND_ONLY","POSE_ONLY","HAIR_ONLY","CLOTHING_ONLY","TEXT_ONLY"]);
  if (!allowed.has(mode)) mode = hasImage ? "TARGETED_EDIT" : "ORIGINAL";
  const requestedText = clean(plan?.requested_text || exactText(message),140) || null;
  let keep = uniq(plan?.keep), change = uniq(plan?.change);
  if (mode === "STYLE_ONLY") { keep.push("same identity","same face","same hair","same clothing","same pose","same camera","same crop","same composition","same objects","same existing text"); change.push("ONLY rendering style"); }
  if (mode === "BACKGROUND_ONLY") change.push("ONLY background/environment");
  if (mode === "POSE_ONLY") change.push("ONLY pose/body position");
  if (mode === "HAIR_ONLY") change.push("ONLY hairstyle/hair color");
  if (mode === "CLOTHING_ONLY") change.push("ONLY clothing/outfit");
  return {mode,requestedText,textPosition:clean(plan?.text_position,80)||textPosition(message),textStyle:clean(plan?.text_style,500),keep:uniq(keep),change:uniq(change),style:clean(plan?.style||"premium polished game illustration",1600),composition:clean(plan?.composition||"Preserve the reference composition unless explicitly changed.",1600),imagePrompt:clean(plan?.image_prompt||message,8000),reply:clean(plan?.reply||"できました。",500)};
}
function buildPrompt(plan,message) {
  return `Iconia AI high-fidelity image operation.\nUSER REQUEST:\n${clean(message)}\nMODE: ${plan.mode}\nINTENT:\n${plan.imagePrompt}\nSTYLE:\n${plan.style}\nCOMPOSITION:\n${plan.composition}\nKEEP:\n- ${plan.keep.join("\n- ")}\nCHANGE:\n- ${plan.change.join("\n- ")}\n${plan.requestedText?`EXACT TEXT: ${plan.requestedText}`:""}\n${plan.textPosition?`TEXT POSITION: ${plan.textPosition}`:""}\n${plan.textStyle?`TEXT STYLE: ${plan.textStyle}`:""}\nNON-NEGOTIABLE: reference image is the source of truth; do not change unrequested elements; exact spelling/case/punctuation/Japanese characters; premium polished game-icon quality.`;
}
async function editImage(file,prompt,size,quality) {
  let last;
  for (let i=0;i<2;i++) { try { return await client.images.edit({model:IMAGE_MODEL,image:file,prompt,size,quality,output_format:"jpeg",output_compression:85,n:1}); } catch(e) { last=e; console.error(`image edit attempt ${i+1} failed`,e); } }
  throw last;
}

async function overlayText(imageData,text,position,textStyle) {
  await ensureJapaneseFont();
  const {buffer} = dataImageToBuffer(imageData); const meta=await sharp(buffer).metadata();
  const w=meta.width||1024,h=meta.height||1024; const lines=String(text).split(/\n/).slice(0,6);
  const fs0=Math.max(34,Math.round(Math.min(w,h)*(lines.length>2?.055:.075)));
  let x=w/2,y=h-Math.round(h*.12)-(lines.length-1)*fs0*.55,anchor="middle";
  const p=String(position||"").toLowerCase();
  if (/left|左/.test(p)){x=w*.08;anchor="start";} else if (/right|右/.test(p)){x=w*.92;anchor="end";} else if (/top|上/.test(p)) y=Math.max(fs0*1.2,h*.12);
  let fill1="#ffffff",fill2="#bfe3ff",stroke="#071321";
  const s=String(textStyle||"");
  if (/gold|金|黄色/.test(s)){fill1="#fff7c2";fill2="#f0b52a";stroke="#3b2300";}
  if (/pink|ピンク/.test(s)){fill1="#fff0fa";fill2="#ff66c8";stroke="#3a092c";}
  if (/red|赤/.test(s)){fill1="#fff0f0";fill2="#ff4545";stroke="#3b0000";}
  if (/purple|紫/.test(s)){fill1="#f8efff";fill2="#a66cff";stroke="#21063d";}
  if (/green|緑/.test(s)){fill1="#f1fff3";fill2="#4ee07a";stroke="#07351a";}
  const safe=String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
  const tspans=lines.map((line,i)=>`<tspan x="${x}" dy="${i?fs0*1.18:0}">${String(line).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</tspan>`).join("");
  const svg=`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" xml:lang="ja"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fill1}"/><stop offset=".55" stop-color="${fill2}"/><stop offset="1" stop-color="${fill1}"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="7" stdDeviation="6" flood-color="#000000" flood-opacity=".85"/></filter></defs><text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" font-family="Noto Sans CJK JP" font-weight="900" font-style="italic" font-size="${fs0}" fill="url(#g)" stroke="${stroke}" stroke-width="${Math.max(5,fs0*.16)}" stroke-linejoin="round" paint-order="stroke" filter="url(#s)">${tspans}</text></svg>`;
  const out=await sharp(buffer).composite([{input:Buffer.from(svg),top:0,left:0}]).jpeg({quality:94}).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({success:false,error:"POSTリクエストのみ対応しています。"});
  try{
    if(!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY がVercelに設定されていません。");
    const body=req.body||{},message=clean(body.message),image=typeof body.image==="string"&&body.image.startsWith("data:image/")?body.image:null,history=Array.isArray(body.history)?body.history:[];
    if(!message&&!image) return res.status(400).json({success:false,error:"画像またはメッセージを入力してください。"});
    if(image&&image.length>8_000_000) return res.status(413).json({success:false,error:"参考画像が大きすぎます。もう少し小さい画像を使ってください。"});

    // Explicit text-only edits never call the image generation safety pipeline.
    // The planner can still inspect the reference and decide typography; Sharp performs the exact final text render.
    if(isTextOnlyRequest(message,Boolean(image))){
      let plan={};
      try { plan=normalize(await makePlan(message,image,history),message,true); } catch(e) { console.warn("Typography planner fallback",e); plan=normalize({},message,true); }
      const requested=plan.requestedText||exactText(message);
      const edited=await overlayText(image,requested,plan.textPosition,plan.textStyle);
      return res.status(200).json({success:true,image:edited,reply:`できました。「${requested}」を元画像の雰囲気に合わせて配置しました。人物・背景・構図は変更していません。`,plan:{mode:"TEXT_ONLY",requestedText:requested,textPosition:plan.textPosition,textStyle:plan.textStyle,keep:["元画像の人物・背景・構図・服装・ポーズ"],change:["文字だけ"]}});
    }

    const plan=normalize(await makePlan(message,image,history),message,Boolean(image));
    const quality=/高品質|高画質|最高|超高精細|精密|最高品質|premium/i.test(message)||["STYLE_ONLY","FAITHFUL","AI_DESIGN"].includes(plan.mode)?"high":"medium";
    const prompt=buildPrompt(plan,message),size=imageSize(message); let result;
    if(image){const {buffer,mime}=dataImageToBuffer(image);const ext=mime.split("/")[1]==="png"?"png":mime.split("/")[1]==="webp"?"webp":"jpg";result=await editImage(await toFile(buffer,`reference.${ext}`,{type:mime}),prompt,size,quality);} else result=await client.images.generate({model:IMAGE_MODEL,prompt,size,quality,output_format:"jpeg",output_compression:85,n:1});
    const b64=result?.data?.[0]?.b64_json;if(!b64) throw new Error("画像データがAIから返されませんでした。");
    return res.status(200).json({success:true,image:`data:image/jpeg;base64,${b64}`,reply:plan.reply,plan:{mode:plan.mode,requestedText:plan.requestedText,textPosition:plan.textPosition,textStyle:plan.textStyle,keep:plan.keep,change:plan.change}});
  }catch(error){
    console.error("ICONIA API ERROR",error);
    const msg=error?.error?.message||error?.message||"画像処理中にエラーが発生しました。";
    const safety=/safety|content policy|policy|rejected/i.test(msg);
    return res.status(Number(error?.status)||500).json({success:false,error:safety?"この操作は画像生成AIの安全システムにより拒否されました。文字だけの追加・変更なら元画像を維持したまま処理できます。":msg,code:error?.error?.code||error?.code||null,type:error?.error?.type||error?.type||null});
  }
}
