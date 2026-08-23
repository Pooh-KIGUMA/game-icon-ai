import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import fs from "node:fs/promises";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PLANNER_MODEL = "gpt-5.6";
const IMAGE_MODEL = "gpt-image-2";
const clean = (v, n = 12000) => String(v ?? "").trim().slice(0, n);
const uniq = (a) => [...new Set((Array.isArray(a) ? a : []).map(x => clean(x, 900)).filter(Boolean))];

const FORMATS = {
  icon: { modelSize: "1024x1024", width: 1024, height: 1024, label: "ゲームアイコン 1:1" },
  xheader: { modelSize: "1536x1024", width: 1500, height: 500, label: "X / Twitter ヘッダー 3:1" },
  youtube: { modelSize: "1536x1024", width: 1280, height: 720, label: "YouTube 16:9" },
  portrait: { modelSize: "1024x1536", width: 1024, height: 1536, label: "縦長 2:3" }
};

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
    await fs.writeFile(configPath, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${dir}</dir><cachedir>/tmp/iconia-font-cache</cachedir></fontconfig>`);
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
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("参考画像はJPG・PNG・WebPに対応しています。");
  return { buffer: Buffer.from(m[2], "base64"), mime };
}

function formatFrom(message, requested) {
  const t = `${message} ${requested || ""}`.toLowerCase();
  if (/x\s*\/\s*twitter|twitter|xのヘッダー|xヘッダー|twitterヘッダー|ツイッター.*ヘッダー|ヘッダー|banner|バナー/.test(t)) return "xheader";
  if (/youtube|ユーチューブ|サムネイル|thumbnail/.test(t)) return "youtube";
  if (/縦長|portrait|ポートレート|ストーリー|tiktok/.test(t)) return "portrait";
  return "icon";
}

function exactText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const quoted = [...t.matchAll(/[「『“"]([^」』”"]{1,120})[」』”"]/gu)].map(m => m[1].trim()).filter(Boolean);
  if (quoted.length) return quoted.join("\n");
  const m1 = t.match(/(?:^|\s|[「『])([A-Za-z0-9][A-Za-z0-9 _+\-.]{0,39})の(?:文字|テキスト|ロゴ)(?=\s*(?:を|は|に))/u);
  if (m1?.[1]) return m1[1].trim();
  const m2 = t.match(/(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名|ギルド名)\s*(?:は|を|：|:)\s*[「『“"]?([^」』”"\n]{1,100})/u);
  return m2?.[1]?.trim() || null;
}

function textPosition(text) {
  const t = String(text || "").toLowerCase();
  if (/右|right/.test(t)) return "right";
  if (/左|left/.test(t)) return "left";
  if (/上|top/.test(t)) return "top";
  if (/下|bottom/.test(t)) return "bottom";
  if (/中央|真ん中|center/.test(t)) return "center";
  return null;
}

function textScale(text) {
  const t = String(text || "").toLowerCase();
  if (/極端に大き|最大|画面いっぱい|超大き|めちゃくちゃ大き/.test(t)) return 0.19;
  if (/かなり大き|ものすごく大き|とても大き/.test(t)) return 0.16;
  if (/大きく|大きめ|もっと大き|大きな|large|big/.test(t)) return 0.135;
  if (/小さく|小さめ|small/.test(t)) return 0.055;
  return 0.105;
}

function isLikelyChat(message, hasImage) {
  const t = String(message || "").trim();
  if (!t) return false;
  if (/(作って|生成|作成|編集|変更|修正|追加|入れて|消して|削除|変えて|描いて|書いて|大きく|小さく|背景|人物|キャラ|文字|ロゴ|画像|アイコン|ヘッダー|サムネイル|絵柄|画風|ポーズ|髪|服|色|明るく|暗く)/u.test(t)) return false;
  return /^(いい感じ|いいね|最高|完璧|すごい|良いね|良い感じ|ありがとう|ありがとう！|助かった|気に入った|ok|okay|了解|うん|そうそう|その調子|いいじゃん|めっちゃいい)/iu.test(t) || (hasImage && t.length < 80 && /^(これ|それ|このまま|そのまま|いい|最高)/u.test(t));
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
  const s = String(text || "");
  const a = s.indexOf("{"); const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) try { return JSON.parse(s.slice(a, b + 1)); } catch {}
  return {};
}

async function makePlan(message, image, history, format, modeHint) {
  const recent = (Array.isArray(history) ? history.slice(-28) : [])
    .map((m, i) => `${i + 1}. ${m.role === "user" ? "USER" : "ASSISTANT"}: ${clean(m.text, 1800)}`)
    .join("\n");
  const system = `You are Iconia AI, a premium game-icon editing assistant. You are not merely an image prompt generator: understand the conversation like a strong chat assistant, then decide whether the user wants conversation or an image operation.

Return JSON only with this schema:
{"action":"generate|edit|chat","mode":"ORIGINAL|FAITHFUL|STYLE_ONLY|TARGETED_EDIT|AI_DESIGN|BACKGROUND_ONLY|POSE_ONLY|HAIR_ONLY|CLOTHING_ONLY|TEXT_ONLY","requested_text":string|null,"text_position":string|null,"text_style":string|null,"text_scale":"tiny|small|medium|large|xlarge|huge","keep":string[],"change":string[],"style":string,"composition":string,"image_prompt":string,"reply":string}

CORE RULES:
1. The reference image is the source of truth. Preserve the same recognizable person/character, face, hair, clothing, pose, important objects, existing text, camera and composition unless the user explicitly asks to change them.
2. If the user asks to change ONLY the art style, change rendering style only. Do not redesign the person.
3. If the user asks to change ONLY the background, change only the environment/background.
4. If the user asks for text/logo, exact spelling and requested size/position are hard requirements.
5. When the user says "big", "larger", "もっと大きく", etc., choose large/xlarge/huge, not medium.
6. When the user asks for text but gives no typography style, AUTOMATICALLY DESIGN typography that matches the reference image: color palette, mood, lighting, genre, character, and composition. Do not use a generic plain text treatment. Describe a tasteful logo/typography treatment in text_style.
7. When the user gives a specific typography direction, follow it exactly while still matching the image.
8. If the latest message is praise, thanks, agreement or casual conversation with no edit request, action=chat and reply naturally in Japanese. Do not generate another image.
9. The default output is a square game icon. Only use another format when the user explicitly asks or the UI format is not icon.
10. "この画像", "このキャラ", "さっき", "そのまま" refer to the supplied reference and recent conversation.
11. Never invent an unrequested change just to make the image prettier.

The UI mode hint is only a hint; the user's natural-language request wins. Current output: ${format.label}. Current mode hint: ${modeHint || "auto"}.
Recent conversation:
${recent || "none"}`;
  const content = [{ type: "input_text", text: `LATEST USER MESSAGE:\n${clean(message)}\n\nREFERENCE IMAGE PRESENT: ${image ? "YES" : "NO"}` }];
  if (image) content.push({ type: "input_image", image_url: image, detail: "high" });
  const r = await client.responses.create({
    model: PLANNER_MODEL,
    reasoning: { effort: "high" },
    input: [{ role: "developer", content: system }, { role: "user", content }],
    max_output_tokens: 3000
  });
  return parseJson(r.output_text);
}

function normalize(plan, message, hasImage, format) {
  let action = String(plan?.action || "").toLowerCase();
  if (!["generate", "edit", "chat"].includes(action)) action = hasImage ? "edit" : (isLikelyChat(message, hasImage) ? "chat" : "generate");
  let mode = String(plan?.mode || (hasImage ? "FAITHFUL" : "ORIGINAL")).toUpperCase();
  const allowed = new Set(["ORIGINAL", "FAITHFUL", "STYLE_ONLY", "TARGETED_EDIT", "AI_DESIGN", "BACKGROUND_ONLY", "POSE_ONLY", "HAIR_ONLY", "CLOTHING_ONLY", "TEXT_ONLY"]);
  if (!allowed.has(mode)) mode = hasImage ? "FAITHFUL" : "ORIGINAL";
  if (action === "chat") mode = "FAITHFUL";
  const requestedText = clean(plan?.requested_text || exactText(message), 140) || null;
  const keep = uniq(plan?.keep);
  const change = uniq(plan?.change);
  if (hasImage) keep.push("exact recognizable subject identity", "same face and key facial features", "same hair unless explicitly changed", "same clothing unless explicitly changed", "same pose unless explicitly changed", "same important objects", "same camera/composition unless explicitly changed", "same existing text unless explicitly changed");
  if (mode === "STYLE_ONLY") change.push("ONLY rendering style, brushwork, shading and lighting language");
  if (mode === "BACKGROUND_ONLY") change.push("ONLY background/environment");
  if (mode === "POSE_ONLY") change.push("ONLY pose/body position");
  if (mode === "HAIR_ONLY") change.push("ONLY hairstyle/hair color");
  if (mode === "CLOTHING_ONLY") change.push("ONLY clothing/outfit");
  if (mode === "TEXT_ONLY") change.push("ONLY typography/logo layer");
  let textScaleValue = String(plan?.text_scale || "").toLowerCase();
  if (!["tiny", "small", "medium", "large", "xlarge", "huge"].includes(textScaleValue)) {
    const raw = textScale(message);
    textScaleValue = raw >= .18 ? "huge" : raw >= .15 ? "xlarge" : raw >= .12 ? "large" : raw <= .06 ? "small" : "medium";
  }
  if (requestedText && !plan?.text_style) change.push("automatic typography design matched to the reference image");
  return {
    action,
    mode,
    requestedText,
    textPosition: clean(plan?.text_position, 80) || textPosition(message),
    textStyle: clean(plan?.text_style || (requestedText ? "Automatic premium logo typography matched to the reference image: elegant, dimensional, polished, with palette-aware gradient, outline, subtle glow and balanced negative space; never plain default text." : ""), 1200),
    textScale: textScaleValue,
    keep: uniq(keep),
    change: uniq(change),
    style: clean(plan?.style || "premium polished commercial game illustration", 1800),
    composition: clean(plan?.composition || "Preserve the reference composition unless explicitly changed.", 1800),
    imagePrompt: clean(plan?.image_prompt || message, 9000),
    reply: clean(plan?.reply || (action === "chat" ? "いい感じだね。ここからもこの方向で仕上げていこう。" : "できました。"), 700),
    format
  };
}

function buildPrompt(plan, message) {
  const strict = ["FAITHFUL", "STYLE_ONLY", "BACKGROUND_ONLY", "TEXT_ONLY", "TARGETED_EDIT"].includes(plan.mode);
  return `Iconia AI high-fidelity visual editing operation.\nLATEST USER REQUEST:\n${clean(message)}\nMODE: ${plan.mode}\nOUTPUT FORMAT: ${plan.format.label}\n\nINTENT:\n${plan.imagePrompt}\n\nSTYLE:\n${plan.style}\n\nCOMPOSITION:\n${plan.composition}\n\nKEEP EXACTLY:\n- ${plan.keep.join("\n- ")}\n\nONLY CHANGE:\n- ${plan.change.join("\n- ")}\n${plan.requestedText ? `\nEXACT TEXT: ${plan.requestedText}\nTYPOGRAPHY DIRECTION: ${plan.textStyle}\nTEXT SCALE: ${plan.textScale}` : ""}\n${plan.textPosition ? `TEXT POSITION: ${plan.textPosition}` : ""}\n${strict ? "\nIDENTITY LOCK: Do not replace, redesign, beautify into a different person, or regenerate unrequested parts. Preserve the recognizable subject from the reference." : ""}\nQUALITY: premium commercial game artwork, polished anatomy, coherent lighting, crisp details, sophisticated composition.\nNON-NEGOTIABLE: Never change an unrequested element merely because it seems aesthetically preferable.`;
}

async function editImage(file, prompt, size, quality) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      return await client.images.edit({ model: IMAGE_MODEL, image: file, prompt, size, quality, output_format: "jpeg", output_compression: 88, n: 1 });
    } catch (e) { last = e; console.error(`image edit attempt ${i + 1} failed`, e); }
  }
  throw last;
}

function colorFromStyle(text) {
  const s = String(text || "");
  if (/金|gold|amber|yellow/i.test(s)) return ["#fff6c5", "#e5a72a", "#4b2b00"];
  if (/ピンク|pink|rose|magenta/i.test(s)) return ["#fff3fb", "#ff70c9", "#4a1239"];
  if (/赤|red|crimson/i.test(s)) return ["#fff1f1", "#ff4f5e", "#4a060d"];
  if (/紫|purple|violet|lavender/i.test(s)) return ["#fff7ff", "#9f67ff", "#34105f"];
  if (/緑|green|emerald/i.test(s)) return ["#effff5", "#4bdc8a", "#073b23"];
  if (/青|blue|cyan|ice|silver/i.test(s)) return ["#ffffff", "#63d8ff", "#06243d"];
  return ["#ffffff", "#a7c7ff", "#091529"];
}

async function renderText(imageData, text, position, textStyle, message, scale, formatKey) {
  await ensureJapaneseFont();
  const { buffer } = dataImageToBuffer(imageData);
  const fmt = FORMATS[formatKey] || FORMATS.icon;
  const source = await sharp(buffer).resize(fmt.width, fmt.height, { fit: "cover", position: "attention" }).jpeg({ quality: 95 }).toBuffer();
  const w = fmt.width, h = fmt.height;
  const lines = String(text).split(/\n/).slice(0, 6);
  const ratios = { tiny: .052, small: .072, medium: .105, large: .145, xlarge: .175, huge: .205 };
  let fs0 = Math.round(Math.min(w, h) * (ratios[scale] || ratios.medium));
  if (/大き|large|big|xlarge|huge/i.test(message) && !["tiny", "small"].includes(scale)) fs0 = Math.max(fs0, Math.round(Math.min(w, h) * .14));
  if (formatKey === "xheader") fs0 = Math.max(fs0, 70);
  if (formatKey === "youtube") fs0 = Math.max(fs0, 64);
  const maxWidth = w * (/右|right/.test(String(position || "")) ? .74 : .9);
  const estimated = Math.max(...lines.map(x => Math.max(1, [...x].length))) * fs0 * .57;
  if (estimated > maxWidth) fs0 = Math.max(30, Math.floor(fs0 * maxWidth / estimated));
  let x = w / 2, y = h * .83, anchor = "middle";
  const p = String(position || "").toLowerCase();
  if (/left|左/.test(p)) { x = w * .07; anchor = "start"; y = h * .78; }
  else if (/right|右/.test(p)) { x = w * .93; anchor = "end"; y = h * .78; }
  else if (/top|上/.test(p)) y = h * .16;
  else if (/center|中央|真ん中/.test(p)) y = h * .52;
  const [fill1, fill2, stroke] = colorFromStyle(`${textStyle} ${message}`);
  const decorative = /蝶|花|幻想|fantasy|elegant|上品|高級|魔法|dream|luxury|anime|ゲーム/i.test(`${textStyle} ${message}`);
  const shadow = Math.max(4, fs0 * .075);
  const strokeW = Math.max(3, fs0 * .09);
  const esc = v => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
  const tspans = lines.map((line, i) => `<tspan x="${x}" dy="${i ? fs0 * 1.12 : 0}">${esc(line)}</tspan>`).join("");
  const ornament = decorative ? `<g opacity=".9" fill="${fill2}"><path d="M ${x - fs0 * .62} ${y - fs0 * .48} q ${fs0 * .22} -${fs0 * .28} ${fs0 * .44} 0 q -${fs0 * .22} ${fs0 * .28} -${fs0 * .44} 0z"/><path d="M ${x + fs0 * .18} ${y + fs0 * .52} q ${fs0 * .22} -${fs0 * .28} ${fs0 * .44} 0 q -${fs0 * .22} ${fs0 * .28} -${fs0 * .44} 0z"/></g>` : "";
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" xml:lang="ja"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fill1}"/><stop offset=".52" stop-color="${fill2}"/><stop offset="1" stop-color="${fill1}"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="${shadow}" stdDeviation="${Math.max(2, fs0 * .045)}" flood-color="#000" flood-opacity=".92"/></filter></defs>${ornament}<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" font-family="Noto Sans CJK JP" font-weight="900" font-style="italic" font-size="${fs0}" fill="url(#g)" stroke="${stroke}" stroke-width="${strokeW}" stroke-linejoin="round" paint-order="stroke" filter="url(#s)">${tspans}</text></svg>`;
  const out = await sharp(source).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 96 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

async function fitExactCanvas(dataUrl, formatKey) {
  const fmt = FORMATS[formatKey] || FORMATS.icon;
  const { buffer } = dataImageToBuffer(dataUrl);
  const out = await sharp(buffer).resize(fmt.width, fmt.height, { fit: "cover", position: "attention" }).jpeg({ quality: 95 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POSTリクエストのみ対応しています。" });
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY がVercelに設定されていません。");
    const body = req.body || {};
    const message = clean(body.message);
    const image = typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
    const history = Array.isArray(body.history) ? body.history : [];
    const modeHint = clean(body.mode, 40) || "auto";
    const requestedFormat = ["icon", "xheader", "youtube", "portrait"].includes(body.format) ? body.format : null;
    if (!message && !image) return res.status(400).json({ success: false, error: "画像またはメッセージを入力してください。" });
    if (image && image.length > 9_500_000) return res.status(413).json({ success: false, error: "参考画像が大きすぎます。もう少し小さい画像を使ってください。" });

    const formatKey = requestedFormat || formatFrom(message, body.format);
    const format = FORMATS[formatKey];
    const plan = normalize(await makePlan(message, image, history, format, modeHint), message, Boolean(image), format);

    if (plan.action === "chat") {
      return res.status(200).json({ success: true, chat: true, reply: plan.reply || "いい感じだね。", plan: { mode: "CHAT", format: formatKey } });
    }

    if (isTextOnlyRequest(message, Boolean(image)) && image) {
      const requested = plan.requestedText || exactText(message);
      const edited = await renderText(image, requested, plan.textPosition, plan.textStyle, message, plan.textScale, formatKey);
      return res.status(200).json({ success: true, image: edited, reply: plan.reply || `できました。「${requested}」を画像の雰囲気に合わせてデザインしました。`, plan: { mode: "TEXT_ONLY", requestedText: requested, textPosition: plan.textPosition, textStyle: plan.textStyle, textScale: plan.textScale, keep: ["元画像の人物・背景・構図"], change: ["文字・ロゴだけ"], format: formatKey, formatLabel: format.label } });
    }

    const quality = /高品質|高画質|最高|超高精細|精密|最高品質|premium/i.test(message) || ["STYLE_ONLY", "FAITHFUL", "AI_DESIGN", "TARGETED_EDIT"].includes(plan.mode) ? "high" : "medium";
    const prompt = buildPrompt(plan, message);
    let result;
    if (image) {
      const { buffer, mime } = dataImageToBuffer(image);
      const ext = mime.split("/")[1] === "png" ? "png" : mime.split("/")[1] === "webp" ? "webp" : "jpg";
      result = await editImage(await toFile(buffer, `reference.${ext}`, { type: mime }), prompt, format.modelSize, quality);
    } else {
      result = await client.images.generate({ model: IMAGE_MODEL, prompt, size: format.modelSize, quality, output_format: "jpeg", output_compression: 88, n: 1 });
    }
    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("画像データがAIから返されませんでした。");
    let output = await fitExactCanvas(`data:image/jpeg;base64,${b64}`, formatKey);
    return res.status(200).json({ success: true, image: output, reply: plan.reply, plan: { mode: plan.mode, requestedText: plan.requestedText, textPosition: plan.textPosition, textStyle: plan.textStyle, textScale: plan.textScale, keep: plan.keep, change: plan.change, format: formatKey, formatLabel: format.label } });
  } catch (error) {
    console.error("ICONIA API ERROR", error);
    const msg = error?.error?.message || error?.message || "画像処理中にエラーが発生しました。";
    const safety = /safety|content policy|policy|rejected/i.test(msg);
    return res.status(Number(error?.status) || 500).json({ success: false, error: safety ? "この操作は画像生成AIの安全システムにより拒否されました。別の表現で試してください。" : msg, code: error?.error?.code || error?.code || null, type: error?.error?.type || error?.type || null });
  }
}
