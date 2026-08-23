import OpenAI, { toFile } from "openai";
import sharp from "sharp";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-image-2";
const clean = (v, max = 7000) => String(v ?? "").trim().slice(0, max);

function imageBuffer(dataUrl) {
  const m = String(dataUrl || "").match(/^data:image\/[^;]+;base64,(.+)$/);
  if (!m) throw new Error("画像データを読み込めませんでした。");
  return Buffer.from(m[1], "base64");
}
function detectSize(text) {
  const t = String(text || "").toLowerCase();
  if (/(x|twitter).*(ヘッダー|header)|ヘッダー|banner|バナー|横長/.test(t)) return "1536x1024";
  if (/縦長|portrait|ストーリー|story|tiktok/.test(t)) return "1024x1536";
  return "1024x1024";
}
function wantsHighQuality(text) { return /高品質|高画質|最高|細かく|超高精細|精密|high quality|high-res/i.test(String(text || "")); }
function extractRequestedText(message) {
  const t = String(message || "").trim();
  if (!t) return null;
  const quoted = t.match(/[「『“"]([^」』”"]{1,80})[」』”"]/u);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  const namedText = t.match(/([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:の|という)\s*(?:文字|テキスト|ロゴ)\b/i);
  if (namedText?.[1]) return namedText[1].trim();
  const named2 = t.match(/([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:を|って)\s*(?:入れて|追加して|加えて|書いて|載せて|入れたい|追加したい|入れてください|追加してください)/i);
  if (named2?.[1]) return named2[1].trim();
  const explicit = t.match(/(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名)\s*(?:は|を|：|:)\s*[「『“"]?([A-Za-z0-9._-]{1,60})/u);
  if (explicit?.[1] && !/^(?:入れて|追加して|加えて|書いて|載せて|ください|ほしい|欲しい)$/u.test(explicit[1])) return explicit[1].trim();
  return null;
}
function isTextOnlyRequest(message, hasImage, forceAiDesign = false) {
  if (!hasImage || forceAiDesign) return false;
  const t = String(message || "");
  const text = extractRequestedText(t);
  if (!text) return false;
  const other = /背景(?:だけ|のみ|を変更|を変え)|ポーズ(?:だけ|のみ|を変更|を変え)|髪(?:だけ|型だけ|のみ|を変更|を変え)|服(?:だけ|装だけ|のみ|を変更|を変え)|人物(?:だけ|のみ|を変更|を変え)|顔(?:だけ|のみ|を変更|を変え)/u.test(t);
  return !other && /文字|テキスト|ロゴ|名前|クラン|チーム|同盟|原画|元画像|そのまま|だけ|のみ|追加|入れて|書いて|カッコよく|かっこよく|デザイン/u.test(t);
}
function editMode(message, hasImage, forceAiDesign = false) {
  if (!hasImage) return "ORIGINAL";
  if (isTextOnlyRequest(message, true, forceAiDesign)) return "TEXT_ONLY";
  const t = String(message || "");
  if (/背景だけ|背景のみ|背景を変更|背景を変え/.test(t)) return "BACKGROUND_ONLY";
  if (/ポーズだけ|ポーズのみ|ポーズを変更|ポーズを変え/.test(t)) return "POSE_ONLY";
  if (/髪だけ|髪型だけ|髪のみ|髪を変更|髪を変え/.test(t)) return "HAIR_ONLY";
  if (/服だけ|衣装だけ|服装だけ|衣装を変更|服を変更/.test(t)) return "CLOTHING_ONLY";
  if (/ほぼそのまま|ほとんどそのまま|原画のまま|原画をそのまま|できるだけそのまま|極力そのまま|原型を残|原画維持|原画を維持|元画像.*そのまま/.test(t)) return "FAITHFUL";
  return forceAiDesign ? "AI_DESIGN" : "TARGETED_EDIT";
}
function buildPrompt({ message, history, hasImage, mode, requestedText }) {
  const recent = Array.isArray(history) ? history.slice(-8).map(x => `${x.role === "user" ? "USER" : "ASSISTANT"}: ${clean(x.text,1200)}`).join("\n") : "";
  return `You are Iconia AI, a professional conversational image creation and editing assistant. Interpret the user's Japanese request like a skilled art director and create the image directly.

LATEST REQUEST:
${clean(message)}

RECENT CONVERSATION:
${recent || "No previous conversation."}

REFERENCE IMAGE: ${hasImage ? "YES" : "NO"}
EDIT MODE: ${mode}
EXACT REQUESTED TEXT: ${requestedText || "none"}

REFERENCE RULES:
- Preserve the reference identity, face, hairstyle, body proportions, clothing, accessories, distinctive marks, colors and composition unless explicitly asked to change them.
- FAITHFUL: preserve the source as closely as possible and change only requested parts.
- TEXT_ONLY: do not regenerate the reference; the application will overlay the exact requested text after generation.
- AI_DESIGN: redesign the requested visual elements boldly and creatively; preserve the character identity unless the user explicitly asks for a full transformation.
- Never invent text, watermarks, signatures, usernames or logos.
- If exact text is requested, do not render it yourself; the application adds it after generation when TEXT_ONLY is active.

QUALITY:
- Professional game/SNS artwork, clean anatomy, coherent lighting, readable silhouette and detailed materials.
- Respect requested aspect ratio and composition.`;
}
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success:false, error:"POSTリクエストのみ対応しています。" });
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ success:false, error:"OPENAI_API_KEY がVercelに設定されていません。" });
    const body = req.body || {};
    const message = clean(body.message);
    const image = typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
    const history = Array.isArray(body.history) ? body.history : [];
    const forceAiDesign = body.aiDesign === true;
    if (!message && !image) return res.status(400).json({ success:false, error:"画像またはメッセージを入力してください。" });
    const requestedText = clean(body.requestedText || extractRequestedText(message), 80) || null;
    const size = detectSize(message);
    const quality = wantsHighQuality(message) ? "high" : "low";
    const mode = editMode(message, Boolean(image), forceAiDesign);
    const prompt = buildPrompt({ message, history, hasImage:Boolean(image), mode, requestedText });
    if (image && mode === "TEXT_ONLY" && requestedText) return res.status(200).json({success:true,image,overlay:{text:requestedText,message},reply:`できました。「${requestedText}」を正確に追加します。元画像は変更していません。`});
    let outputBuffer;
    if (image) {
      const sourceBuffer = imageBuffer(image);
      const file = await toFile(sourceBuffer, "reference.jpg", { type:"image/jpeg" });
      const response = await client.images.edit({ model:MODEL, image:file, prompt, size, quality, output_format:"jpeg", output_compression:72, n:1 });
      const base64 = response?.data?.[0]?.b64_json;
      if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");
      outputBuffer = Buffer.from(base64, "base64");
    } else {
      const response = await client.images.generate({ model:MODEL, prompt, size, quality, output_format:"jpeg", output_compression:72, n:1 });
      const base64 = response?.data?.[0]?.b64_json;
      if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");
      outputBuffer = Buffer.from(base64, "base64");
    }
    return res.status(200).json({success:true,image:`data:image/jpeg;base64,${outputBuffer.toString("base64")}`,...(requestedText&&!forceAiDesign?{overlay:{text:requestedText,message}}:{}),reply:"できました。気になるところがあれば、そのまま続けて指示してください。"});
  } catch (error) {
    console.error("ICONIA API ERROR", error);
    return res.status(Number(error?.status)||500).json({success:false,error:error?.error?.message||error?.message||"不明なエラーが発生しました。",code:error?.error?.code||error?.code||null,type:error?.error?.type||error?.type||null});
  }
}
