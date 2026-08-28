import OpenAI, { toFile } from "openai";
import sharp from "sharp";

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

function isTextMoveRequest(message, hasImage) {
  if (!hasImage) return false;
  const t = String(message || "").trim();
  const hasMove = /(移動|動か|ずら|寄せ|位置を変|場所を変|右へ|左へ|上へ|下へ|右側へ|左側へ|上側へ|下側へ|move|reposition)/iu.test(t);
  const hasText = /(文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名|ギルド名)/u.test(t);
  return Boolean(hasMove && hasText && exactText(t));
}

function isLikelyChat(message, hasImage) {
  const t = String(message || "").trim();
  if (!t) return false;
  if (/(作って|生成|作成|編集|変更|修正|追加|入れて|消して|削除|変えて|描いて|書いて|大きく|小さく|背景|人物|キャラ|文字|ロゴ|画像|アイコン|ヘッダー|サムネイル|絵柄|画風|ポーズ|髪|服|色|明るく|暗く)/u.test(t)) return false;
  return /^(いい感じ|いいね|最高|完璧|すごい|良いね|良い感じ|ありがとう|ありがとう！|助かった|気に入った|ok|okay|了解|うん|そうそう|その調子|いいじゃん|めっちゃいい)/iu.test(t) || (hasImage && t.length < 80 && /^(これ|それ|このまま|そのまま|いい|最高)/u.test(t));
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
  const system = `You are Iconia AI, a premium visual art director and game-icon editor. You must THINK about the image before editing it. You are not a sticker/text overlay tool and not a generic prompt generator.

Return JSON only with this schema:
{"action":"generate|edit|chat","mode":"ORIGINAL|FAITHFUL|STYLE_ONLY|TARGETED_EDIT|AI_DESIGN|BACKGROUND_ONLY|POSE_ONLY|HAIR_ONLY|CLOTHING_ONLY|TEXT_ONLY|TEXT_MOVE","requested_text":string|null,"text_position":string|null,"text_style":string|null,"text_scale":"tiny|small|medium|large|xlarge|huge","keep":string[],"change":string[],"style":string,"composition":string,"image_prompt":string,"reply":string}

VISUAL ART-DIRECTION RULES:
1. First inspect the reference as a designer: subject silhouette, face/eyes, focal point, lighting direction, color palette, background complexity, empty/negative space, circular/icon safe area, existing ornaments, visual hierarchy, and places where typography can sit without damaging the subject.
2. If text/logo is requested, DO NOT simply paste plain text on top. Invent a custom typography/logo treatment that belongs to the artwork: choose a suitable type character, weight, slant, width, material, outline, bevel, glow, shadow, texture, icon/ornament, and color treatment from the reference. The result should look intentionally designed by a professional game-logo designer.
3. For short Latin names such as AxLF, prefer a compact custom wordmark/emblem with strong silhouette and integrated effects rather than ordinary UI text. It may arc, interlock with the frame, follow the composition, or sit in negative space when that improves the design.
4. Choose text placement from the actual image. Do NOT default to center or bottom. Avoid covering eyes/face/focal details unless the user explicitly requests it. Prefer negative space, frame edges, lower third, upper arc, or an intentional overlap that looks designed. Record the chosen position and WHY in composition.
5. Vary typography across requests when the user asks for "another version" or "different". Do not keep the same font/placement/composition merely with a color change.
6. The reference image is the source of truth. Preserve the same recognizable person/character, face, hair, clothing, pose, important objects, camera and composition unless the user explicitly asks to change them.
7. If the user asks to change ONLY the art style, change rendering style only. Do not redesign the person.
8. If the user asks to change ONLY the background, change only the environment/background.
9. If the user asks for text/logo, exact spelling and requested size/position are hard requirements.
10. If the user asks to MOVE/REPOSITION an existing named text or logo, use TEXT_MOVE: remove the original instance completely and place that SAME text/logo only once at the requested position. NEVER duplicate it.
11. When the user says big/larger/もっと大きく, choose large/xlarge/huge, not medium.
12. If the user gives no typography style, automatically design it from the reference's palette, genre, lighting and visual language. Never use generic default typography.
13. If the latest message is praise, thanks, agreement or casual conversation with no edit request, action=chat and reply naturally in Japanese. Do not generate another image.
14. Default output is a square game icon. Only use another format when explicitly requested or the UI format is not icon.
15. Never invent unrelated changes merely to make the image prettier.

For text requests, your image_prompt must explicitly describe: exact text, chosen placement, scale, visual hierarchy, typography material/style, relationship to the subject, and how the lettering integrates with lighting/effects. Do not say only "add text".

Current output: ${format.label}. Current mode hint: ${modeHint || "auto"}.
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
  const allowed = new Set(["ORIGINAL", "FAITHFUL", "STYLE_ONLY", "TARGETED_EDIT", "AI_DESIGN", "BACKGROUND_ONLY", "POSE_ONLY", "HAIR_ONLY", "CLOTHING_ONLY", "TEXT_ONLY", "TEXT_MOVE"]);
  if (!allowed.has(mode)) mode = hasImage ? "FAITHFUL" : "ORIGINAL";
  if (isTextMoveRequest(message, hasImage)) mode = "TEXT_MOVE";
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
  if (mode === "TEXT_ONLY") change.push("ONLY typography/logo layer; preserve all artwork underneath");
  if (mode === "TEXT_MOVE") change.push("MOVE ONLY THE EXISTING NAMED TEXT/LOGO: erase its original location completely, then place the same text/logo once at the requested position; do not add a duplicate");
  let textScaleValue = String(plan?.text_scale || "").toLowerCase();
  if (!["tiny", "small", "medium", "large", "xlarge", "huge"].includes(textScaleValue)) {
    const raw = textScale(message);
    textScaleValue = raw >= .18 ? "huge" : raw >= .15 ? "xlarge" : raw >= .12 ? "large" : raw <= .06 ? "small" : "medium";
  }
  const defaultStyle = requestedText
    ? "Custom premium game wordmark designed from the reference: choose a distinctive non-generic type silhouette, palette-matched material, dimensional bevel/edge, controlled outline, directional light, subtle glow, shadow and one restrained emblem/ornament. Integrate it into the composition rather than placing it like a sticker."
    : "";
  return {
    action,
    mode,
    requestedText,
    textPosition: clean(plan?.text_position, 80) || textPosition(message),
    textStyle: clean(plan?.text_style || defaultStyle, 1600),
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
  const strict = ["FAITHFUL", "STYLE_ONLY", "BACKGROUND_ONLY", "TEXT_ONLY", "TARGETED_EDIT", "TEXT_MOVE"].includes(plan.mode);
  const textArtDirection = plan.requestedText ? `
TYPOGRAPHY ART DIRECTION — THIS IS A DESIGN TASK, NOT A TEXT OVERLAY:
- Exact text: "${plan.requestedText}"
- Placement: ${plan.textPosition || "choose the strongest negative-space/compositional area after inspecting the reference"}
- Scale: ${plan.textScale}
- Design: ${plan.textStyle}
- Integrate the wordmark with the image's existing lighting, perspective, frame, effects and visual hierarchy.
- Do NOT use a generic plain sans-serif/caption treatment.
- Do NOT simply center the text by default.
- Do NOT cover the face/eyes/focal point unless explicitly requested.
- The lettering must look intentionally art-directed, like a professional game emblem/wordmark created specifically for this image.
- If the reference has a frame, energy, weapons, ornaments, flames, lightning or other motifs, harmonize the lettering with those motifs rather than ignoring them.` : "";
  const moveInstruction = plan.mode === "TEXT_MOVE" && plan.requestedText
    ? `
TEXT MOVE OPERATION: Find the existing visible text/logo that reads exactly "${plan.requestedText}" in the reference. REMOVE/ERASE that original instance completely from its old position, reconstruct the SAME text/logo with the same spelling and visual identity, and place it ONLY ONCE at ${plan.textPosition || "the requested position"}. DO NOT add a second copy. DO NOT leave the old copy behind.`
    : "";
  return `Iconia AI high-fidelity visual editing operation.
LATEST USER REQUEST:
${clean(message)}
MODE: ${plan.mode}
OUTPUT FORMAT: ${plan.format.label}

VISUAL ANALYSIS / INTENT:
${plan.imagePrompt}

STYLE:
${plan.style}

COMPOSITION:
${plan.composition}

KEEP EXACTLY:
- ${plan.keep.join("\n- ")}

ONLY CHANGE:
- ${plan.change.join("\n- ")}
${textArtDirection}
${plan.textPosition ? `\nTEXT POSITION CONSTRAINT: ${plan.textPosition}` : ""}${moveInstruction}
${strict ? "\nIDENTITY LOCK: Do not replace, redesign, beautify into a different person, or regenerate unrequested parts. Preserve the recognizable subject from the reference." : ""}
QUALITY: premium commercial game artwork, polished anatomy, coherent lighting, crisp details, sophisticated composition, strong visual hierarchy.
NON-NEGOTIABLE: Never change an unrequested element merely because it seems aesthetically preferable. For typography, prioritize bespoke visual design and composition over generic readability-first placement.`;
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

    const quality = /高品質|高画質|最高|超高精細|精密|最高品質|premium/i.test(message) || ["STYLE_ONLY", "FAITHFUL", "AI_DESIGN", "TARGETED_EDIT", "TEXT_ONLY", "TEXT_MOVE"].includes(plan.mode) ? "high" : "medium";
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
    const output = await fitExactCanvas(`data:image/jpeg;base64,${b64}`, formatKey);
    return res.status(200).json({ success: true, image: output, reply: plan.reply, plan: { mode: plan.mode, requestedText: plan.requestedText, textPosition: plan.textPosition, textStyle: plan.textStyle, textScale: plan.textScale, keep: plan.keep, change: plan.change, format: formatKey, formatLabel: format.label } });
  } catch (error) {
    console.error("ICONIA API ERROR", error);
    const msg = error?.error?.message || error?.message || "画像処理中にエラーが発生しました。";
    const safety = /safety|content policy|policy|rejected/i.test(msg);
    return res.status(Number(error?.status) || 500).json({ success: false, error: safety ? "この操作は画像生成AIの安全システムにより拒否されました。別の表現で試してください。" : msg, code: error?.error?.code || error?.code || null, type: error?.error?.type || error?.type || null });
  }
}
