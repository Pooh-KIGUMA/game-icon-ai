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

// Extract the exact Latin/number name the user wants printed.
// This is intentionally independent from the image model so spelling is guaranteed.
function extractRequestedText(message) {
  const t = String(message || "").trim();
  if (!t) return null;

  // Quoted text: 「AxLF」 / 『AxLF』 / “AxLF”
  const quoted = t.match(/[「『“"]([^」』”"]{1,60})[」』”"]/);
  if (quoted?.[1] && /[A-Za-z0-9]/.test(quoted[1])) return quoted[1].trim();

  // Explicit Japanese labels.
  const explicit = t.match(/(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名)\s*(?:は|を|：|:|=)\s*[「『“"]?([A-Za-z0-9][A-Za-z0-9._-]{0,39})[」』”"]?/i);
  if (explicit?.[1]) return explicit[1].trim();

  const patterns = [
    /([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:の文字|という文字)/i,
    /([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:だけ(?:を|に)?|のみ(?:を|に)?)/i,
    /([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:を|って)\s*(?:入れて|追加して|入れたい|入れてください)/i,
    /(?:文字|ロゴ|名前|クラン|チーム|同盟)[^A-Za-z0-9]{0,15}([A-Za-z][A-Za-z0-9._-]{0,39})/i
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) return m[1].trim();
  }

  // Natural Japanese such as: 「元画像そのままでAxLFだけ入れて」.
  if (/(?:文字|ロゴ|名前|クラン|チーム|同盟|原画|元画像|そのまま|だけ|追加|入れて|入れたい)/.test(t)) {
    const tokens = t.match(/[A-Za-z][A-Za-z0-9._-]{0,39}/g) || [];
    const stop = new Set(["AI", "SNS", "X", "Twitter", "Instagram", "LINE", "OpenAI"]);
    const candidate = tokens.find(v => !stop.has(v) && !/^(?:image|edit|original|text|logo|name)$/i.test(v));
    if (candidate) return candidate;
  }
  return null;
}

function isTextOnlyRequest(message, hasImage) {
  if (!hasImage) return false;
  const t = String(message || "");
  const text = extractRequestedText(t);
  if (!text) return false;
  const other = /背景(?:だけ|のみ|を変更|を変え)|ポーズ(?:だけ|のみ|を変更|を変え)|髪(?:だけ|型だけ|のみ|を変更|を変え)|服(?:だけ|装だけ|のみ|を変更|を変え)/.test(t);
  return !other && /文字|テキスト|ロゴ|名前|クラン|チーム|同盟|そのまま|原画|元画像|だけ|のみ|追加|入れ/.test(t);
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

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
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

  const palettes = {
    esports: ["#FFFFFF", "#6BC7FF", "#5A35FF"], luxury: ["#FFF7C7", "#F2B63D", "#7A470A"],
    cyber: ["#EFFFFF", "#28DFFF", "#7447FF"], japanese: ["#FFFFFF", "#FF4A4A", "#7A0714"],
    cute: ["#FFF5FC", "#FF79C6", "#8D63FF"], gothic: ["#FFFFFF", "#B79BFF", "#29134F"],
    minimal: ["#FFFFFF", "#D9E2EC", "#657487"], metal: ["#FFFFFF", "#B8C4D0", "#3E4855"]
  };
  let colors = palettes[style];
  if (/金|ゴールド|gold/i.test(t)) colors = ["#FFF8C8", "#F2B63D", "#8A5A14"];
  else if (/紫|パープル|purple/i.test(t)) colors = ["#F4E9FF", "#A76BFF", "#5120A8"];
  else if (/青|ブルー|blue/i.test(t)) colors = ["#F0FFFF", "#39B9FF", "#1E4FFF"];
  else if (/赤|レッド|red/i.test(t)) colors = ["#FFF1F1", "#FF4A5F", "#9C0F22"];
  else if (/緑|グリーン|green/i.test(t)) colors = ["#EFFFF5", "#42E88B", "#087A4A"];
  else if (/ピンク|pink/i.test(t)) colors = ["#FFF1FA", "#FF69B4", "#A23BFF"];
  else if (/黒|ブラック|black/i.test(t)) colors = ["#EEF1F5", "#4B5563", "#05070B"];

  const size = Math.min(Math.max(48, Math.round(min * (/かなり大き|とても大き|超大き/.test(t) ? .125 : /大きく|大きめ/.test(t) ? .095 : .078))), Math.max(48, Math.floor(width / 2.7)));
  let anchor = "middle", x = width / 2, y = height - Math.round(height * .075);
  if (/右下/.test(t)) { anchor = "end"; x = width - Math.round(width * .055); y = height - Math.round(height * .065); }
  else if (/左下/.test(t)) { anchor = "start"; x = Math.round(width * .055); y = height - Math.round(height * .065); }
  else if (/右上/.test(t)) { anchor = "end"; x = width - Math.round(width * .055); y = Math.round(height * .105); }
  else if (/左上/.test(t)) { anchor = "start"; x = Math.round(width * .055); y = Math.round(height * .105); }
  else if (/中央|真ん中|センター/.test(t)) y = height / 2;

  const glow = /光|発光|ネオン|glow|neon/i.test(t) || style === "cyber";
  const italic = /斜め|斜体|スタイリッシュ|シャープ|カッコよく|かっこよく|クール|ロゴ|gaming|esports/i.test(t) || style === "esports" || style === "cyber";
  const fontFamily = { esports: "Impact, Arial Black, sans-serif", luxury: "Georgia, serif", cyber: "Arial Black, Impact, sans-serif", japanese: "Impact, Arial Black, sans-serif", cute: "Arial Rounded MT Bold, Arial, sans-serif", gothic: "Georgia, serif", minimal: "Arial, sans-serif", metal: "Impact, Arial Black, sans-serif" }[style];
  const weight = style === "luxury" || style === "gothic" ? 700 : 900;
  const letterSpacing = style === "luxury" ? Math.round(size * .04) : Math.round(size * .012);
  const rotation = /斜め|斜体/.test(t) ? -6 : style === "japanese" ? -2 : style === "esports" ? -3 : 0;
  const accent = style === "japanese" ? "#D82038" : style === "luxury" ? "#FFF1A6" : style === "cyber" ? "#36E9FF" : style === "cute" ? "#FFD7EF" : "#FFFFFF";
  return { style, colors, size, anchor, x, y, glow, italic, fontFamily, weight, letterSpacing, rotation, accent };
}

async function addExactText(buffer, text, message) {
  if (!text) return buffer;
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 1024, height = meta.height || 1024;
  const s = textStyle(message, width, height);
  const safe = escapeXml(text);
  const id = `logo${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const stroke = s.style === "luxury" ? "#3A2609" : s.style === "cute" ? "#5D2B67" : "#070A12";
  const outer = Math.max(5, Math.round(s.size * .06));
  const inner = Math.max(1, Math.round(s.size * .018));
  const shadowY = Math.max(5, Math.round(s.size * .075));
  const blur = Math.max(3, Math.round(s.size * .045));
  const defs = `<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${s.colors[0]}"/><stop offset="45%" stop-color="${s.colors[1]}"/><stop offset="100%" stop-color="${s.colors[2]}"/></linearGradient><filter id="${id}s" x="-50%" y="-50%" width="200%" height="210%"><feDropShadow dx="0" dy="${shadowY}" stdDeviation="${blur}" flood-color="#000" flood-opacity=".85"/></filter><filter id="${id}glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${Math.max(5, Math.round(s.size * .1))}" result="b"/><feFlood flood-color="${s.colors[1]}" flood-opacity=".75"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const transform = `rotate(${s.rotation} ${s.x} ${s.y})${s.italic ? " skewX(-6)" : ""}`;
  const filter = s.glow ? `url(#${id}glow)` : `url(#${id}s)`;
  const common = `x="${s.x}" y="${s.y}" text-anchor="${s.anchor}" font-family="${s.fontFamily}" font-size="${s.size}px" font-weight="${s.weight}" letter-spacing="${s.letterSpacing}px" stroke-linejoin="round" paint-order="stroke"`;
  const decorative = s.style === "esports" ? `<path d="M ${Math.max(0,s.x-s.size*1.45)} ${s.y+s.size*.18} L ${Math.max(0,s.x-s.size*1.13)} ${s.y+s.size*.03} L ${Math.max(0,s.x-s.size*.87)} ${s.y+s.size*.18} M ${Math.min(width,s.x+s.size*1.45)} ${s.y+s.size*.18} L ${Math.min(width,s.x+s.size*1.13)} ${s.y+s.size*.03} L ${Math.min(width,s.x+s.size*.87)} ${s.y+s.size*.18}" stroke="${s.accent}" stroke-width="${Math.max(3,s.size*.018)}" fill="none"/>` : "";
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs><g transform="${transform}" filter="${filter}">${decorative}<text ${common} fill="url(#${id}g)" stroke="${stroke}" stroke-width="${outer}">${safe}</text><text ${common} fill="url(#${id}g)" stroke="#fff" stroke-opacity=".28" stroke-width="${inner}">${safe}</text></g></svg>`;
  return sharp(buffer).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 94 }).toBuffer();
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
- TEXT_ONLY: the application will overlay the exact requested text after generation; do not render text yourself.
- BACKGROUND_ONLY: change only the environment/background.
- POSE_ONLY: change only pose/framing.
- HAIR_ONLY: change only hair.
- CLOTHING_ONLY: change only clothing/armor/accessories.
- TARGETED_EDIT: change requested parts while preserving everything else.

TEXT RULES:
- Never invent text, watermarks, signatures, usernames or logos.
- If exact text is requested, do not render it yourself; the application adds it after generation.

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
    if (!message && !image) return res.status(400).json({ success:false, error:"画像またはメッセージを入力してください。" });

    const requestedText = clean(body.requestedText || extractRequestedText(message), 60) || null;
    const size = detectSize(message);
    const quality = wantsHighQuality(message) ? "high" : "low";
    const mode = editMode(message, Boolean(image));
    const prompt = buildPrompt({ message, history, hasImage:Boolean(image), mode, requestedText });
    let outputBuffer;

    if (image) {
      const sourceBuffer = imageBuffer(image);
      if (mode === "TEXT_ONLY" && requestedText) {
        // Do not regenerate the reference at all. This guarantees the original stays intact.
        outputBuffer = await addExactText(sourceBuffer, requestedText, message);
      } else {
        const file = await toFile(sourceBuffer, "reference.jpg", { type:"image/jpeg" });
        const response = await client.images.edit({ model:MODEL, image:file, prompt, size, quality, output_format:"jpeg", output_compression:72, n:1 });
        const base64 = response?.data?.[0]?.b64_json;
        if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");
        outputBuffer = Buffer.from(base64, "base64");
        if (requestedText) outputBuffer = await addExactText(outputBuffer, requestedText, message);
      }
    } else {
      const response = await client.images.generate({ model:MODEL, prompt, size, quality, output_format:"jpeg", output_compression:72, n:1 });
      const base64 = response?.data?.[0]?.b64_json;
      if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");
      outputBuffer = Buffer.from(base64, "base64");
      if (requestedText) outputBuffer = await addExactText(outputBuffer, requestedText, message);
    }

    return res.status(200).json({ success:true, image:`data:image/jpeg;base64,${outputBuffer.toString("base64")}`, reply:"できました。気になるところがあれば、そのまま続けて指示してください。" });
  } catch (error) {
    console.error("ICONIA API ERROR", error);
    return res.status(Number(error?.status)||500).json({ success:false, error:error?.error?.message || error?.message || "不明なエラーが発生しました。", code:error?.error?.code || error?.code || null, type:error?.error?.type || error?.type || null });
  }
}
