import originalHandler from "./generate.js";

function isImageData(v) {
  return typeof v === "string" && /^data:image\//.test(v);
}

function extractText(message) {
  const t = String(message || "").trim();
  if (!t) return null;
  const quoted = t.match(/[「『“"]([^」』”"]{1,80})[」』”"]/u);
  if (quoted?.[1]?.trim()) return quoted[1].trim();

  const named = t.match(/([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:の|という)\s*(?:文字|テキスト|ロゴ)\b/i);
  if (named?.[1]) return named[1].trim();

  const named2 = t.match(/([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:を|って)\s*(?:入れて|追加して|加えて|書いて|載せて|入れたい|追加したい|入れてください|追加してください)/i);
  if (named2?.[1]) return named2[1].trim();

  const explicit = t.match(/(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名)\s*(?:は|を|：|:)\s*[「『“"]?([A-Za-z0-9._-]{1,60})/u);
  if (explicit?.[1] && !/^(?:入れて|追加して|加えて|書いて|載せて|ください|ほしい|欲しい)$/u.test(explicit[1])) return explicit[1].trim();
  return null;
}

function wantsAiDesign(message, body) {
  if (body?.aiDesign === true) return true;
  const t = String(message || "");
  return /AI(?:に|が)?(?:書き直|描き直|再デザイン|デザイン)|AIデザイン|全体を.*(?:再|デザイン)|雰囲気.*(?:変え|変えて)|構図.*(?:変え|変えて)/u.test(t);
}

function isTextOnlyRequest(message, image, body) {
  if (!isImageData(image) || wantsAiDesign(message, body)) return false;
  const t = String(message || "");
  const text = extractText(t);
  if (!text) return false;
  const otherEdit = /背景(?:だけ|のみ|を変更|を変え)|ポーズ(?:だけ|のみ|を変更|を変え)|髪(?:だけ|型だけ|のみ|を変更|を変え)|服(?:だけ|装だけ|のみ|を変更|を変え)|人物(?:だけ|のみ|を変更|を変え)|顔(?:だけ|のみ|を変更|を変え)/u.test(t);
  if (otherEdit) return false;
  return /文字|テキスト|ロゴ|名前|チーム|クラン|同盟|そのまま|原画|元画像|だけ|のみ|追加|入れ|書いて|カッコよく|かっこよく|デザイン/u.test(t);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success:false, error:"POSTリクエストのみ対応しています。" });
  const body = req.body || {};
  const message = String(body.message || "");
  const image = isImageData(body.image) ? body.image : null;
  if (isTextOnlyRequest(message, image, body)) {
    const text = extractText(message);
    return res.status(200).json({success:true,image,overlay:{text,message},reply:`できました。「${text}」を正確に追加します。元画像は変更していません。`});
  }
  return originalHandler(req, res);
}
