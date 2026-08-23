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

function editMode(message, hasImage) {
  if (!hasImage) return "ORIGINAL";
  const t = String(message || "");
  if (/文字だけ|文字を入れ|テキストだけ|ロゴだけ|文字のみ/.test(t)) return "TEXT_ONLY";
  if (/背景だけ|背景のみ|背景を変更|背景を変え/.test(t)) return "BACKGROUND_ONLY";
  if (/ポーズだけ|ポーズのみ|ポーズを変更|ポーズを変え/.test(t)) return "POSE_ONLY";
  if (/髪だけ|髪型だけ|髪のみ|髪を変更|髪を変え/.test(t)) return "HAIR_ONLY";
  if (/服だけ|衣装だけ|服装だけ|衣装を変更|服を変更/.test(t)) return "CLOTHING_ONLY";
  if (/ほぼそのまま|ほとんどそのまま|原画のまま|原画をそのまま|できるだけそのまま|極力そのまま|原型を残|原画維持|原画を維持/.test(t)) return "FAITHFUL";
  return "TARGETED_EDIT";
}

function buildPrompt({ message, history, hasImage }) {
  const recent = Array.isArray(history)
    ? history.slice(-8).map(x => `${x.role === "user" ? "USER" : "ASSISTANT"}: ${clean(x.text, 1400)}`).join("\n")
    : "";
  const mode = editMode(message, hasImage);

  return `You are Iconia AI, a professional conversational image creation and editing assistant.
The user speaks naturally in Japanese. Do not make the user fill out forms or choose predefined categories. Interpret the request like a skilled human art director and create the best possible image.

LATEST REQUEST:
${clean(message)}

RECENT CONVERSATION:
${recent || "No previous conversation."}

REFERENCE IMAGE: ${hasImage ? "YES" : "NO"}
EDIT MODE: ${mode}

CORE BEHAVIOR:
- The latest request is the strongest instruction. Use recent conversation only to resolve references such as "さっきの", "前の", "このキャラ", "これ", "そのまま", "もっと", and "もう少し".
- Understand ordinary natural language, including vague creative requests such as "いい感じに", "もっとかっこよく", "高級感を出して", "ゲームアイコンっぽく", or "SNSで使いやすく".
- Infer sensible composition, lighting, color harmony, camera angle, subject scale, background detail and visual polish when the user leaves those choices open.
- Never force a predefined character type, mood, color, background, clothing or pose when the user did not ask for one.

REFERENCE IMAGE FIDELITY:
- When a reference image exists, treat it as the primary visual source, not merely inspiration.
- Preserve identity, face, hairstyle, body proportions, clothing, accessories, distinctive marks and overall art direction unless the user explicitly asks to change them.
- FAITHFUL mode: preserve the source as closely as the image model allows. Make only the requested modifications and avoid redesigning the character.
- TEXT_ONLY mode: preserve the source image and composition as closely as possible. Add or modify only the requested text. Do not redesign the character or background.
- BACKGROUND_ONLY mode: keep the character/subject and its important details essentially unchanged; change only the environment/background and related lighting when necessary.
- POSE_ONLY mode: keep the character's identity, face, hair, outfit, colors and style stable; change the pose/camera framing as requested.
- HAIR_ONLY mode: keep everything else stable and modify only hair-related details.
- CLOTHING_ONLY mode: keep the character and scene stable and modify only clothing/armor/accessories requested.
- TARGETED_EDIT mode: make the requested changes while preserving everything else that does not need to change.
- If the user says "顔はそのまま", "キャラはそのまま", "服はそのまま", "背景だけ", etc., treat that as a hard preservation constraint.

TEXT RULES:
- Never invent, hallucinate or add text that the user did not explicitly request.
- Never add player names, alliance names, clan names, usernames, logos, watermarks, signatures, "Pooh", "AxLF", "Player name", "Iconia AI", or "Game Icon AI" unless the user explicitly requests that exact text.
- When text is requested, reproduce the requested wording exactly. Do not silently correct, translate, abbreviate, duplicate or add extra words.
- If the user asks for a single text item, do not create a second decorative copy of it.
- Integrate requested text naturally into the composition and obey requested position, size and color.

ORIGINAL CREATION:
- If there is no reference image, create a completely original character/artwork from the user's natural-language description.
- If the user has not decided on an exact design, make a polished, appealing creative choice rather than asking a long list of questions.
- If the user asks for several concepts and then one final image, choose a strong concept and execute it.

FORMAT:
- For game icons, X/Instagram/LINE profile images, favor strong subject readability, clear face/subject scale and safe cropping.
- For X/Twitter headers, banners or other wide formats, use a wide composition and keep important elements away from crop edges.
- Respect explicit aspect-ratio or format requests when possible.

QUALITY:
- Prioritize professional game/SNS artwork, clean anatomy, coherent lighting, readable silhouettes, detailed materials and intentional composition.
- Do not explain the prompt or describe what you plan to do. Generate the image directly.
`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POSTリクエストのみ対応しています。" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ success: false, error: "OPENAI_API_KEY がVercelに設定されていません。" });

    const body = req.body || {};
    const message = clean(body.message);
    const image = typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
    const history = Array.isArray(body.history) ? body.history : [];

    if (!message && !image) return res.status(400).json({ success: false, error: "画像またはメッセージを入力してください。" });

    const size = detectSize(message);
    const quality = wantsHighQuality(message) ? "high" : "low";
    const prompt = buildPrompt({ message, history, hasImage: Boolean(image) });

    let response;

    if (image) {
      const file = await toFile(imageBuffer(image), "reference.jpg", { type: "image/jpeg" });
      response = await client.images.edit({
        model: MODEL,
        image: file,
        prompt,
        size,
        quality,
        output_format: "jpeg",
        output_compression: 72,
        n: 1,
      });
    } else {
      response = await client.images.generate({
        model: MODEL,
        prompt,
        size,
        quality,
        output_format: "jpeg",
        output_compression: 72,
        n: 1,
      });
    }

    const base64 = response?.data?.[0]?.b64_json;
    if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");

    return res.status(200).json({
      success: true,
      image: `data:image/jpeg;base64,${base64}`,
      reply: "できました。気になるところがあれば、そのまま続けて指示してください。",
    });
  } catch (error) {
    console.error("ICONIA API ERROR", error);
    return res.status(Number(error?.status) || 500).json({
      success: false,
      error: error?.error?.message || error?.message || "不明なエラーが発生しました。",
      code: error?.error?.code || error?.code || null,
      type: error?.error?.type || error?.type || null,
    });
  }
}
