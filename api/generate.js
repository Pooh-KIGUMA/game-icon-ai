import OpenAI, { toFile } from "openai";

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

function wantsHighQuality(text) {
  return /高品質|高画質|最高|細かく|超高精細|精密|high quality|high-res/i.test(String(text || ""));
}

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

function isStyleRequest(text) {
  return /イラストタッチ|絵柄|画風|タッチ|作画|描き方|アートスタイル|イラスト風|絵の感じ|絵の雰囲気|テイスト|anime style|art style|style transfer/i.test(String(text || ""));
}

function isTextOnlyRequest(message, hasImage, forceAiDesign = false) {
  if (!hasImage || forceAiDesign) return false;
  const t = String(message || "");
  const text = extractRequestedText(t);
  if (!text || isStyleRequest(t)) return false;
  const other = /背景(?:だけ|のみ|を変更|を変え)|ポーズ(?:だけ|のみ|を変更|を変え)|髪(?:だけ|型だけ|のみ|を変更|を変え)|服(?:だけ|装だけ|のみ|を変更|を変え)|人物(?:だけ|のみ|を変更|を変え)|顔(?:だけ|のみ|を変更|を変え)/u.test(t);
  return !other && /文字|テキスト|ロゴ|名前|クラン|チーム|同盟|原画|元画像|そのまま|だけ|のみ|追加|入れて|書いて|カッコよく|かっこよく|デザイン/u.test(t);
}

function editMode(message, hasImage, forceAiDesign = false) {
  if (!hasImage) return "ORIGINAL";
  if (isTextOnlyRequest(message, true, forceAiDesign)) return "TEXT_ONLY";
  const t = String(message || "");
  if (isStyleRequest(t)) return "STYLE_ONLY";
  if (/背景だけ|背景のみ|背景を変更|背景を変え/.test(t)) return "BACKGROUND_ONLY";
  if (/ポーズだけ|ポーズのみ|ポーズを変更|ポーズを変え/.test(t)) return "POSE_ONLY";
  if (/髪だけ|髪型だけ|髪のみ|髪を変更|髪を変え/.test(t)) return "HAIR_ONLY";
  if (/服だけ|衣装だけ|服装だけ|衣装を変更|服を変更/.test(t)) return "CLOTHING_ONLY";
  if (/ほぼそのまま|ほとんどそのまま|原画のまま|原画をそのまま|できるだけそのまま|極力そのまま|原型を残|原画維持|原画を維持|元画像.*そのまま/.test(t)) return "FAITHFUL";
  return forceAiDesign ? "AI_DESIGN" : "TARGETED_EDIT";
}

function buildPrompt({ message, history, hasImage, mode, requestedText }) {
  const recent = Array.isArray(history)
    ? history.slice(-8).map(x => `${x.role === "user" ? "USER" : "ASSISTANT"}: ${clean(x.text, 1200)}`).join("\n")
    : "";

  const styleOnly = mode === "STYLE_ONLY" ? `
STYLE-ONLY HARD LOCK:
- This is a style transfer, NOT a character redesign.
- Treat the reference image as an exact visual blueprint.
- Keep the exact same character/person and recognizable identity.
- Keep the exact same face, facial landmarks, eyes, nose, mouth, expression, hairstyle, hair color, skin tone, body proportions, pose, clothing, accessories, distinctive marks, camera angle, crop, background layout and major objects.
- Change ONLY the rendering language: line art, brush texture, shading technique, color rendering, lighting treatment and illustration finish.
- The result must be recognizable as the SAME IMAGE redrawn by a different artist.
- Do NOT replace the subject with a generic person, beauty portrait, different anime character, realistic woman/man, or new composition.
- Do NOT change gender, age, ethnicity, facial structure, hairstyle, outfit, pose or scene.
- If the requested style is vague, choose a polished anime/game illustration style while preserving the source exactly.
- Prioritize identity preservation over stylistic strength.` : "";

  return `You are Iconia AI, a professional conversational image creation and editing assistant.

LATEST REQUEST:
${clean(message)}

RECENT CONVERSATION:
${recent || "No previous conversation."}

REFERENCE IMAGE: ${hasImage ? "YES" : "NO"}
EDIT MODE: ${mode}
EXACT REQUESTED TEXT: ${requestedText || "none"}

REFERENCE PRIORITY:
- A supplied reference image is the PRIMARY SOURCE.
- Never replace the subject unless the user explicitly requests a replacement or full transformation.
- Preserve identity, face, hair, body proportions, pose, clothing, accessories, distinctive marks, camera angle and composition unless that specific element is requested to change.
${styleOnly}

OTHER EDIT MODES:
- TEXT_ONLY: do not regenerate the reference; the application overlays the exact requested text.
- FAITHFUL: preserve the source as closely as possible and change only requested parts.
- TARGETED_EDIT: change only what the user asks for and preserve everything else.
- AI_DESIGN: creatively redesign requested visual elements, but preserve character identity unless the user explicitly asks for a full transformation.
- BACKGROUND_ONLY: change only the background.
- POSE_ONLY: change only the pose while preserving identity and appearance.
- HAIR_ONLY: change only hair while preserving identity and everything else.
- CLOTHING_ONLY: change only clothing while preserving identity and everything else.

TEXT:
- Never invent text, watermarks, signatures, usernames or logos.
- If exact text is requested in TEXT_ONLY mode, do not render it yourself; the application adds it afterward.

QUALITY:
- Professional game/SNS artwork, clean anatomy, coherent lighting and detailed materials.
- Respect the requested aspect ratio and composition.`;
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
    const mode = editMode(message, Boolean(image), forceAiDesign);
    const quality = (mode === "STYLE_ONLY" || wantsHighQuality(message)) ? "high" : "low";
    const prompt = buildPrompt({ message, history, hasImage:Boolean(image), mode, requestedText });

    if (image && mode === "TEXT_ONLY" && requestedText) {
      return res.status(200).json({ success:true, image, overlay:{text:requestedText,message}, reply:`できました。「${requestedText}」を正確に追加します。元画像は変更していません。` });
    }

    let outputBuffer;
    if (image) {
      const sourceBuffer = imageBuffer(image);
      const file = await toFile(sourceBuffer, "reference.jpg", { type:"image/jpeg" });
      const editParams = {
        model:MODEL,
        image:file,
        prompt,
        size,
        quality,
        output_format:"jpeg",
        output_compression:72,
        n:1
      };
      // High input fidelity is especially important for style-only edits so facial
      // features and other source-image details are matched as closely as possible.
      if (mode === "STYLE_ONLY" || mode === "FAITHFUL") editParams.input_fidelity = "high";
      const response = await client.images.edit(editParams);
      const base64 = response?.data?.[0]?.b64_json;
      if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");
      outputBuffer = Buffer.from(base64, "base64");
    } else {
      const response = await client.images.generate({ model:MODEL, prompt, size, quality, output_format:"jpeg", output_compression:72, n:1 });
      const base64 = response?.data?.[0]?.b64_json;
      if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");
      outputBuffer = Buffer.from(base64, "base64");
    }

    return res.status(200).json({
      success:true,
      image:`data:image/jpeg;base64,${outputBuffer.toString("base64")}`,
      ...(requestedText && !forceAiDesign && mode !== "STYLE_ONLY" ? {overlay:{text:requestedText,message}} : {}),
      reply:"できました。気になるところがあれば、そのまま続けて指示してください。"
    });
  } catch (error) {
    console.error("ICONIA API ERROR", error);
    return res.status(Number(error?.status)||500).json({ success:false, error:error?.error?.message||error?.message||"不明なエラーが発生しました。", code:error?.error?.code||error?.code||null, type:error?.error?.type||error?.type||null });
  }
}
