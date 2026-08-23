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
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textStyle(message, width, height) {
  const t = String(message || "");
  const min = Math.min(width, height);
  let style = "esports";
  if (/高級|高級感|ブランド|ラグジュアリー|luxury|premium|elegant/i.test(t)) style = "luxury";
  else if (/サイバー|サイバーパンク|ネオン|未来|cyber|neon|sci-fi/i.test(t)) style = "cyber";
  else if (/和風|和|日本|筆|墨|侍|忍者|japanese|brush/i.test(t)) style = "japanese";
  else if (/可愛い|かわいい|キュート|cute|ゆめかわ/i.test(t)) style = "cute";
  else if (/ゴシック|ダーク|闇|冷酷|悪|gothic|dark/i.test(t)) style = "gothic";
  else if (/シンプル|上品|minimal|minimalist/i.test(t)) style = "minimal";
  else if (/メタル|金属|メタリック|metal|chrome/i.test(t)) style = "metal";
  else if (/ゲーム|クラン|チーム|eスポーツ|esports|ロゴ|gaming/i.test(t)) style = "esports";

  const palettes = {
    esports: ["#FFFFFF", "#6BC7FF", "#6C4DFF"],
    luxury: ["#FFF4B0", "#F5B93D", "#8B5A16"],
    cyber: ["#E8FFFF", "#32D8FF", "#7B4DFF"],
    japanese: ["#FFFFFF", "#FF4B4B", "#7B0B16"],
    cute: ["#FFF4FB", "#FF8DCE", "#9D72FF"],
    gothic: ["#FFFFFF", "#B89CFF", "#321B5F"],
    minimal: ["#FFFFFF", "#D7E0EA", "#6E7B8C"],
    metal: ["#FFFFFF", "#AEB9C7", "#4A5564"],
  };
  let colors = palettes[style];
  if (/金|ゴールド|gold/i.test(t)) colors = ["#FFF7C2", "#F2B63D", "#8A5A14"];
  else if (/紫|パープル|purple/i.test(t)) colors = ["#F4E9FF", "#A76BFF", "#5120A8"];
  else if (/青|ブルー|blue/i.test(t)) colors = ["#F0FFFF", "#39B9FF", "#1E4FFF"];
  else if (/赤|レッド|red/i.test(t)) colors = ["#FFF1F1", "#FF4A5F", "#9C0F22"];
  else if (/緑|グリーン|green/i.test(t)) colors = ["#EFFFF5", "#42E88B", "#087A4A"];
  else if (/ピンク|pink/i.test(t)) colors = ["#FFF1FA", "#FF69B4", "#A23BFF"];
  else if (/黒|ブラック|black/i.test(t)) colors = ["#E6E9EF", "#4B5563", "#05070B"];

  const size = Math.min(
    Math.max(48, Math.round(min * (/かなり大き|とても大き|超大き/.test(t) ? 0.125 : /大きく|大きめ/.test(t) ? 0.095 : 0.078))),
    Math.max(48, Math.floor(width / 2.7))
  );

  let anchor = "middle";
  let x = width / 2;
  let y = height - Math.round(height * 0.075);
  if (/右下|右下側/.test(t)) { anchor = "end"; x = width - Math.round(width * 0.055); y = height - Math.round(height * 0.065); }
  else if (/左下|左下側/.test(t)) { anchor = "start"; x = Math.round(width * 0.055); y = height - Math.round(height * 0.065); }
  else if (/右上|右上側/.test(t)) { anchor = "end"; x = width - Math.round(width * 0.055); y = Math.round(height * 0.105); }
  else if (/左上|左上側/.test(t)) { anchor = "start"; x = Math.round(width * 0.055); y = Math.round(height * 0.105); }
  else if (/中央|真ん中|センター/.test(t)) { y = height / 2; }

  const glow = /光|発光|ネオン|glow|neon/i.test(t) || style === "cyber";
  const italic = /斜め|斜体|スタイリッシュ|シャープ|カッコよく|かっこよく|クール|ロゴ|gaming|esports/i.test(t) || style === "esports" || style === "cyber";
  const fontFamily = {
    esports: "Impact, Haettenschweiler, Arial Black, sans-serif",
    luxury: "Georgia, Times New Roman, serif",
    cyber: "Arial Black, Impact, sans-serif",
    japanese: "Impact, Arial Black, sans-serif",
    cute: "Arial Rounded MT Bold, Arial, sans-serif",
    gothic: "Georgia, Times New Roman, serif",
    minimal: "Arial, Helvetica, sans-serif",
    metal: "Impact, Arial Black, sans-serif",
  }[style];
  const weight = style === "luxury" || style === "gothic" ? 700 : 900;
  const letterSpacing = style === "luxury" ? Math.round(size * .04) : style === "cyber" ? Math.round(size * .02) : Math.round(size * .012);
  const rotation = /斜め|斜体/.test(t) ? -6 : style === "japanese" ? -2 : style === "esports" ? -3 : 0;
  const accent = style === "japanese" ? "#D82038" : style === "luxury" ? "#FFF1A6" : style === "cyber" ? "#36E9FF" : style === "cute" ? "#FFD7EF" : "#FFFFFF";
  return { style, colors, size, anchor, x, y, glow, italic, fontFamily, weight, letterSpacing, rotation, accent };
}

async function addExactText(buffer, message) {
  const text = extractRequestedText(message);
  if (!text) return buffer;
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 1024;
  const height = meta.height || 1024;
  const s = textStyle(message, width, height);
  const safe = svgEscape(text);
  const id = `logo${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const stroke = s.style === "luxury" ? "#3A2609" : s.style === "cute" ? "#5D2B67" : "#070A12";
  const outer = Math.max(4, Math.round(s.size * 0.055));
  const inner = Math.max(1, Math.round(s.size * 0.018));
  const shadowY = Math.max(5, Math.round(s.size * 0.075));
  const blur = Math.max(3, Math.round(s.size * 0.045));
  const glowColor = s.colors[1];
  const defs = `<linearGradient id="${id}grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${s.colors[0]}"/><stop offset="45%" stop-color="${s.colors[1]}"/><stop offset="100%" stop-color="${s.colors[2]}"/></linearGradient><linearGradient id="${id}shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.82"/><stop offset="42%" stop-color="#FFFFFF" stop-opacity="0.18"/><stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient><filter id="${id}shadow" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="${shadowY}" stdDeviation="${blur}" flood-color="#000000" flood-opacity="0.82"/></filter><filter id="${id}glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${Math.max(5, Math.round(s.size * .10))}" result="blur"/><feFlood flood-color="${glowColor}" flood-opacity="0.78"/><feComposite in2="blur" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const transform = `rotate(${s.rotation} ${s.x} ${s.y})${s.italic ? " skewX(-6)" : ""}`;
  const filter = s.glow ? `url(#${id}glow)` : `url(#${id}shadow)`;
  const common = `x="${s.x}" y="${s.y}" text-anchor="${s.anchor}" font-family="${s.fontFamily}" font-size="${s.size}px" font-weight="${s.weight}" letter-spacing="${s.letterSpacing}px" stroke-linejoin="round" paint-order="stroke"`;
  const decorative = s.style === "japanese" ? `<path d="M ${Math.max(0, s.x - s.size * 1.15)} ${s.y + s.size * .25} L ${Math.min(width, s.x + s.size * 1.15)} ${s.y + s.size * .25}" stroke="${s.accent}" stroke-width="${Math.max(4, s.size * .025)}" opacity="0.85"/>` : s.style === "cyber" ? `<path d="M ${Math.max(0, s.x - s.size * 1.2)} ${s.y + s.size * .18} L ${Math.min(width, s.x + s.size * 1.2)} ${s.y + s.size * .18}" stroke="${s.accent}" stroke-width="${Math.max(3, s.size * .018)}" opacity="0.9"/>` : s.style === "luxury" ? `<path d="M ${Math.max(0, s.x - s.size * 1.05)} ${s.y + s.size * .22} L ${Math.min(width, s.x + s.size * 1.05)} ${s.y + s.size * .22}" stroke="${s.accent}" stroke-width="${Math.max(2, s.size * .012)}" opacity="0.75"/>` : "";
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs><g transform="${transform}" filter="${filter}">${decorative}<text ${common} fill="url(#${id}grad)" stroke="${stroke}" stroke-width="${outer}">${safe}</text><text ${common} fill="url(#${id}grad)" stroke="#FFFFFF" stroke-opacity="0.20" stroke-width="${inner}">${safe}</text><text ${common} fill="url(#${id}shine)" stroke="none" opacity="0.55">${safe}</text></g></svg>`;
  return sharp(buffer).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 94 }).toBuffer();
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
- For TEXT_ONLY requests, do not render any text yourself. The application will add the exact requested wording as a clean, styled overlay after the image is returned.
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
      if (mode === "TEXT_ONLY") {
        outputBuffer = await addExactText(sourceBuffer, message);
      } else {
        const file = await toFile(sourceBuffer, "reference.jpg", { type: "image/jpeg" });
        response = await client.images.edit({ model: MODEL, image: file, prompt, size, quality, output_format: "jpeg", output_compression: 72, n: 1 });
        const base64 = response?.data?.[0]?.b64_json;
        if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");
        outputBuffer = Buffer.from(base64, "base64");
      }
    } else {
      response = await client.images.generate({ model: MODEL, prompt, size, quality, output_format: "jpeg", output_compression: 72, n: 1 });
      const base64 = response?.data?.[0]?.b64_json;
      if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");
      outputBuffer = Buffer.from(base64, "base64");
    }
    const base64 = outputBuffer.toString("base64");
    return res.status(200).json({ success: true, image: `data:image/jpeg;base64,${base64}`, reply: "できました。気になるところがあれば、そのまま続けて指示してください。" });
  } catch (error) {
    console.error("ICONIA API ERROR", error);
    return res.status(Number(error?.status) || 500).json({ success: false, error: error?.error?.message || error?.message || "不明なエラーが発生しました。", code: error?.error?.code || error?.code || null, type: error?.error?.type || error?.type || null });
  }
}
