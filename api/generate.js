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
  if (/縦長|portrait|ストーリー|story/.test(t)) return "1024x1536";
  return "1024x1024";
}

function wantsHighQuality(text) {
  return /高品質|高画質|最高|細かく|超高精細|high quality|high-res/i.test(String(text || ""));
}

function buildPrompt({ message, history, hasImage }) {
  const recent = Array.isArray(history)
    ? history.slice(-8).map(x => `${x.role === "user" ? "USER" : "ASSISTANT"}: ${clean(x.text, 1200)}`).join("\n")
    : "";

  return `You are Iconia AI, a professional conversational image creation assistant.
The user speaks naturally in Japanese. Turn the user's request directly into the best possible image.

LATEST REQUEST:
${clean(message)}

RECENT CONVERSATION:
${recent || "No previous conversation."}

REFERENCE IMAGE: ${hasImage ? "YES" : "NO"}

RULES:
- The latest request has priority, while using conversation context to understand phrases like "もっと", "さっきの", "このまま", "背景だけ", and "もう少し".
- If a reference image exists, preserve the original subject, face, clothing, identity, important details and composition unless the user asks to change them.
- Treat the reference image as the main visual source. Make only requested changes when the user asks for an edit.
- If the user asks to keep the original nearly unchanged, preserve it as faithfully as possible and only apply the requested modifications.
- If there is no reference image, create a completely original character/artwork from the user's natural-language description.
- Never invent or add text. Never add player names, alliance names, clan names, usernames, logos, watermarks, signatures, "Pooh", "AxLF", "Player name", "Iconia AI", or "Game Icon AI" unless the user explicitly requests that exact text.
- When text is requested, reproduce exactly what the user requested and place it where requested.
- Do not force predefined character types, moods, colors or backgrounds. Natural language is the main control.
- For game icons, X/Instagram/LINE profile images, favor strong subject readability and safe cropping.
- For X/Twitter headers, banners or other wide formats, use a wide composition and place important content safely inside the crop.
- Prioritize polished professional game/SNS artwork, clear faces, good lighting, strong composition and appropriate subject scale.
- Do not explain the prompt. Generate the image.
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
