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

function wantsHighQuality(text) {
  return /高品質|高画質|最高|細かく|超高精細|精密|high quality|high-res/i.test(String(text || ""));
}

function editMode(message, hasImage) {
  if (!hasImage) return "ORIGINAL";
  const t = String(message || "");
  if (/文字だけ|文字を入れ|文字を追加|テキストだけ|テキストを入れ|ロゴだけ|ロゴを入れ|文字のみ/.test(t)) return "TEXT_ONLY";
  if (/背景だけ|背景のみ|背景を変更|背景を変え/.test(t)) return "BACKGROUND_ONLY";
  if (/ポーズだけ|ポーズのみ|ポーズを変更|ポーズを変え/.test(t)) return "POSE_ONLY";
  if (/髪だけ|髪型だけ|髪のみ|髪を変更|髪を変え/.test(t)) return "HAIR_ONLY";
  if (/服だけ|衣装だけ|服装だけ|衣装を変更|服を変更/.test(t)) return "CLOTHING_ONLY";
  if (/ほぼそのまま|ほとんどそのまま|原画のまま|原画をそのまま|できるだけそのまま|極力そのまま|原型を残|原画維持|原画を維持/.test(t)) return "FAITHFUL";
  return "TARGETED_EDIT";
}

function extractRequestedText(message) {
  const t = String(message || "");
  const quoted = t.match(/[「『“”](.{1,40})[」』“”]/);
  if (quoted?.[1]) return quoted[1].trim();
  const patterns = [
    /([A-Za-z0-9][A-Za-z0-9._-]{0,30})\s*の文字/,
    /([A-Za-z0-9][A-Za-z0-9._-]{0,30})\s*という文字/,
    /([A-Za-z0-9][A-Za-z0-9._-]{0,30})\s*を(?:入れて|追加して|入れたい)/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function svgEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function textStyle(message, width, height) {
  const t = String(message || "");
  const color = /金|ゴールド|gold/i.test(t) ? "#FFD86A" : /紫|パープル|purple/i.test(t) ? "#B889FF" : /青|ブルー|blue/i.test(t) ? "#66B7FF" : /赤|レッド|red/i.test(t) ? "#FF667A" : /黒|ブラック|black/i.test(t) ? "#111111" : "#FFFFFF";
  const sizeBase = Math.max(44, Math.round(Math.min(width, height) * (/かなり大き|とても大き|超大き/.test(t) ? 0.13 : /大きく|大きめ/.test(t) ? 0.095 : 0.065)));
  const size = Math.min(sizeBase, Math.max(42, Math.floor(width / 3)));
  let anchor = "middle", x = width / 2, y = height - Math.round(height * 0.08);
  if (/右下|右下側/.test(t)) { anchor = "end"; x = width - Math.round(width * 0.06); y = height - Math.round(height * 0.07); }
  else if (/左下|左下側/.test(t)) { anchor = "start"; x = Math.round(width * 0.06); y = height - Math.round(height * 0.07); }
  else if (/右上|右上側/.test(t)) { anchor = "end"; x = width - Math.round(width * 0.06); y = Math.round(height * 0.10); }
  else if (/左上|左上側/.test(t)) { anchor = "start"; x = Math.round(width * 0.06); y = Math.round(height * 0.10); }
  else if (/中央|真ん中|センター/.test(t)) { y = height / 2; }
  return { color, size, anchor, x, y };
}

async function addExactText(buffer, message) {
  const text = extractRequestedText(message);
  if (!text) return buffer;
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 1024, height = meta.height || 1024;
  const s = textStyle(message, width, height);
  const safe = svgEscape(text);
  const stroke = s.color === "#111111" ? "#FFFFFF" : "#111111";
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><text x="${s.x}" y="${s.y}" text-anchor="${s.anchor}" font-family="Arial, Helvetica, sans-serif" font-size="${s.size}px" font-weight="800" fill="${s.color}" stroke="${stroke}" stroke-width="${Math.max(2, Math.round(s.size * .055))}" stroke-linejoin="round" paint-order="stroke" opacity="0.98">${safe}</text></svg>`;
  return sharp(buffer).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 92 }).toBuffer();
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
- Preserve identity, face, hairstyle, body proportions, clothing, accessories, distinctive marks, text and overall art direction unless the user explicitly asks to change them.
- FAITHFUL mode: preserve the source as closely as the image model allows. Make only the requested modifications and avoid redesigning the character, scene or composition.
- TEXT_ONLY mode: preserve the source image and composition as closely as possible. The application will place the exact requested text after generation, so do NOT create, redraw, duplicate or invent any text in the image. Do not redesign the character or background.
- BACKGROUND_ONLY mode: keep the character/subject and its important details essentially unchanged; change only the environment/background and related lighting when necessary.
- POSE_ONLY mode: keep the character's identity, face, hair, outfit, colors and style stable; change the pose/camera framing as requested.
- HAIR_ONLY mode: keep everything else stable and modify only hair-related details.
- CLOTHING_ONLY mode: keep the character and scene stable and modify only clothing/armor/accessories requested.
- TARGETED_EDIT mode: make the requested changes while preserving everything else that does not need to change.
- If the user says "顔はそのまま", "キャラはそのまま", "服はそのまま", "背景だけ", etc., treat that as a hard preservation constraint.

TEXT RULES:
- Never invent, hallucinate or add text that the user did not explicitly request.
- Never add player names, alliance names, clan names, usernames, logos, watermarks, signatures, "Pooh", "AxLF", "Player name", "Iconia AI", or "Game Icon AI" unless the user explicitly requests that exact text.
- For TEXT_ONLY requests, do not render any text yourself. The application will add the exact requested wording as a clean overlay after the image is returned.
- When text is requested outside TEXT_ONLY mode, reproduce the requested wording exactly. Do not silently correct, translate, abbreviate, duplicate or add extra words.
- If the user asks for a single text item, do not create a second decorative copy of it.

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
    const mode = editMode(message, Boolean(image));
    const prompt = buildPrompt({ message, history, hasImage: Boolean(image) });

    let response;
    let outputBuffer;

    if (image) {
      const sourceBuffer = imageBuffer(image);
      const file = await toFile(sourceBuffer, "reference.jpg", { type: "image/jpeg" });
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
      const base64 = response?.data?.[0]?.b64_json;
      if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");
      outputBuffer = Buffer.from(base64, "base64");

      // TEXT_ONLY is deliberately handled as a real pixel-level overlay.
      // This prevents the image model from redrawing the source just to add text.
      if (mode === "TEXT_ONLY") {
        outputBuffer = await addExactText(sourceBuffer, message);
      }
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
      const base64 = response?.data?.[0]?.b64_json;
      if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");
      outputBuffer = Buffer.from(base64, "base64");
    }

    const base64 = outputBuffer.toString("base64");
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
