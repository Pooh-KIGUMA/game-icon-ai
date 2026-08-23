import originalHandler from "./generate.js";

function isImageData(v) {
  return typeof v === "string" && /^data:image\//.test(v);
}

function extractText(message) {
  const t = String(message || "").trim();
  if (!t) return null;

  const quoted = t.match(/[「『“"]([^」』”"]{1,80})[」』”"]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();

  const labeled = t.match(/(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名)\s*(?:は|を|：|:|=)\s*[「『“"]?([^\s、。,.!！?？\n]{1,60})[」』”"]?/u);
  if (labeled?.[1]) return labeled[1].trim();

  const latin = t.match(/([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:を|って)\s*(?:入れて|追加して|入れたい|入れてください)/i);
  if (latin?.[1]) return latin[1].trim();

  const natural = t.match(/([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:の文字|という文字|だけ(?:を|に)?|のみ(?:を|に)?)/i);
  if (natural?.[1]) return natural[1].trim();

  if (/(?:文字|テキスト|ロゴ|名前|チーム|クラン|同盟).*(?:入れて|追加|書いて|入れたい)/u.test(t)) {
    const tokens = t.match(/[A-Za-z][A-Za-z0-9._-]{0,39}/g) || [];
    const stop = new Set(["AI","SNS","X","Twitter","Instagram","LINE","OpenAI","image","edit","original","text","logo","name","game","icon"]);
    const candidate = tokens.find(v => !stop.has(v) && !stop.has(v.toLowerCase()));
    if (candidate) return candidate;
  }
  return null;
}

function isTextOnlyRequest(message, image) {
  if (!isImageData(image)) return false;
  const t = String(message || "");
  const text = extractText(t);
  if (!text) return false;
  const otherEdit = /背景(?:だけ|のみ|を変更|を変え)|ポーズ(?:だけ|のみ|を変更|を変え)|髪(?:だけ|型だけ|のみ|を変更|を変え)|服(?:だけ|装だけ|のみ|を変更|を変え)|人物(?:だけ|のみ|を変更|を変え)|顔(?:だけ|のみ|を変更|を変え)/u.test(t);
  if (otherEdit) return false;
  return /文字|テキスト|ロゴ|名前|チーム|クラン|同盟|そのまま|原画|元画像|だけ|のみ|追加|入れ|入れて|書いて|入れたい/u.test(t);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success:false, error:"POSTリクエストのみ対応しています。" });
  const body = req.body || {};
  const message = String(body.message || "");
  const image = isImageData(body.image) ? body.image : null;

  // Exact text is rendered in the user's browser so Japanese, emoji and special
  // characters use the device's real fonts instead of server-side SVG fallbacks.
  if (isTextOnlyRequest(message, image)) {
    const text = extractText(message);
    return res.status(200).json({
      success: true,
      image,
      overlay: { text, message },
      reply: `できました。「${text}」を正確に追加します。元画像は変更していません。`
    });
  }

  return originalHandler(req, res);
}
