import sharp from "sharp";
import originalHandler from "./generate.js";

function getImageBuffer(dataUrl) {
  const m = String(dataUrl || "").match(/^data:image\/[^;]+;base64,(.+)$/);
  if (!m) throw new Error("画像データを読み込めませんでした。");
  return Buffer.from(m[1], "base64");
}

function extractText(message) {
  const t = String(message || "").trim();
  if (!t) return null;

  // First priority: anything explicitly quoted. This also supports Japanese text.
  const quoted = t.match(/[「『“"]([^」』”"]{1,80})[」』”"]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();

  // Common Japanese instructions used in the UI/chat.
  const explicit = [
    /(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名)\s*(?:は|を|：|:|=)\s*([A-Za-z0-9][A-Za-z0-9._-]{0,39})/i,
    /(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名)\s*(?:は|を|：|:|=)\s*([^\s、。,.!！?？]{1,40})/,
    /([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:の文字|という文字)/i,
    /([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:だけ(?:を|に)?|のみ(?:を|に)?)/i,
    /([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:を|って)\s*(?:入れて|追加して|入れたい|入れてください)/i,
    /(?:文字|ロゴ|名前|クラン|チーム|同盟)[^A-Za-z0-9]{0,20}([A-Za-z][A-Za-z0-9._-]{0,39})/i
  ];
  for (const re of explicit) {
    const m = t.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }

  // Natural requests such as: 元画像そのままでAxLFだけ入れて / Poohと文字を入れて
  const tokens = t.match(/[A-Za-z][A-Za-z0-9._-]{0,39}/g) || [];
  const stop = new Set([
    "AI", "SNS", "X", "Twitter", "Instagram", "LINE", "OpenAI",
    "image", "edit", "original", "text", "logo", "name", "game", "icon"
  ]);
  const candidate = tokens.find(v => !stop.has(v) && !stop.has(v.toLowerCase()));
  if (candidate && /(?:文字|テキスト|ロゴ|名前|クラン|チーム|同盟|そのまま|原画|元画像|だけ|のみ|追加|入れ|入れて|入れたい)/i.test(t)) {
    return candidate;
  }
  return null;
}

function isLatinExactText(text) {
  return /^[A-Za-z0-9][A-Za-z0-9._ -]{0,39}$/.test(String(text || "").trim());
}

function isTextOverlayRequest(message, image) {
  if (!image) return false;
  const t = String(message || "");
  const text = extractText(t);
  if (!text || !isLatinExactText(text)) return false;
  if (/背景(?:だけ|のみ|を変更|を変え)|ポーズ(?:だけ|のみ|を変更|を変え)|髪(?:だけ|型だけ|のみ|を変更|を変え)|服(?:だけ|装だけ|のみ|を変更|を変え)/.test(t)) return false;
  return /文字|テキスト|ロゴ|名前|チーム|クラン|同盟|原画|元画像|そのまま|だけ|のみ|追加|入れ|入れて|入れたい/i.test(t);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function makeLogoSvg(text, width, height, message) {
  const t = String(message || "");
  const min = Math.min(width, height);
  const size = Math.max(58, Math.min(Math.round(min * (/かなり大き|とても大き|超大き/.test(t) ? 0.125 : /大きく|大きめ/.test(t) ? 0.105 : 0.095)), Math.floor(width / 2.35)));
  let x = width / 2;
  let y = height - Math.round(height * 0.08);
  let anchor = "middle";
  if (/右下/.test(t)) { x = width - Math.round(width * 0.06); anchor = "end"; }
  if (/左下/.test(t)) { x = Math.round(width * 0.06); anchor = "start"; }
  if (/右上/.test(t)) { x = width - Math.round(width * 0.06); y = Math.round(height * 0.12); anchor = "end"; }
  if (/左上/.test(t)) { x = Math.round(width * 0.06); y = Math.round(height * 0.12); anchor = "start"; }
  if (/中央|真ん中|センター/.test(t)) y = Math.round(height * 0.55);

  let c1 = "#FFFFFF", c2 = "#65C7FF", c3 = "#5138FF", accent = "#FFFFFF";
  if (/金|ゴールド|gold/i.test(t)) { c1="#FFFBE0"; c2="#F4C24B"; c3="#8A520A"; accent="#FFF2A6"; }
  else if (/紫|パープル|purple/i.test(t)) { c1="#FFFFFF"; c2="#C18CFF"; c3="#5920A8"; accent="#E5C9FF"; }
  else if (/赤|レッド|red/i.test(t)) { c1="#FFFFFF"; c2="#FF5366"; c3="#8E1020"; accent="#FFCDD3"; }
  else if (/青|ブルー|blue/i.test(t)) { c1="#FFFFFF"; c2="#48D6FF"; c3="#1646FF"; accent="#B7F3FF"; }
  else if (/ピンク|pink/i.test(t)) { c1="#FFFFFF"; c2="#FF7BCB"; c3="#9D42FF"; accent="#FFD9F0"; }
  else if (/緑|グリーン|green/i.test(t)) { c1="#FFFFFF"; c2="#5BE58D"; c3="#087A4A"; accent="#C9FFE0"; }
  else if (/黒|ブラック|black/i.test(t)) { c1="#FFFFFF"; c2="#8D98A8"; c3="#171A20"; accent="#FFFFFF"; }

  const id = "logo" + Date.now() + Math.floor(Math.random() * 10000);
  const safe = escapeXml(text);
  const stroke = Math.max(7, Math.round(size * 0.075));
  const shadow = Math.max(5, Math.round(size * 0.055));
  const glow = /光|発光|ネオン|glow|neon/i.test(t);
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".48" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></linearGradient><filter id="${id}s" x="-40%" y="-40%" width="180%" height="220%"><feDropShadow dx="0" dy="${shadow}" stdDeviation="${Math.round(size*.035)}" flood-color="#000" flood-opacity=".9"/></filter>${glow ? `<filter id="${id}g" x="-50%" y="-50%" width="200%" height="220%"><feGaussianBlur stdDeviation="${Math.round(size*.07)}" result="b"/><feFlood flood-color="${c2}" flood-opacity=".7"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : ""}</defs><g filter="url(#${glow ? id+"g" : id+"s"})" transform="rotate(-3 ${x} ${y})"><path d="M ${Math.max(10,x-size*1.8)} ${y+size*.18} L ${Math.max(10,x-size*1.45)} ${y-size*.02} L ${Math.max(10,x-size*1.15)} ${y+size*.18} M ${Math.min(width-10,x+size*1.8)} ${y+size*.18} L ${Math.min(width-10,x+size*1.45)} ${y-size*.02} L ${Math.min(width-10,x+size*1.15)} ${y+size*.18}" fill="none" stroke="${accent}" stroke-width="${Math.max(3,size*.018)}"/><text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial Black, Impact, sans-serif" font-size="${size}px" font-weight="900" letter-spacing="${Math.round(size*.015)}px" fill="url(#${id})" stroke="#080A12" stroke-width="${stroke}" stroke-linejoin="round" paint-order="stroke">${safe}</text><text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial Black, Impact, sans-serif" font-size="${size}px" font-weight="900" letter-spacing="${Math.round(size*.015)}px" fill="none" stroke="#FFFFFF" stroke-opacity=".35" stroke-width="2" paint-order="stroke">${safe}</text></g></svg>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success:false, error:"POSTリクエストのみ対応しています。" });
  const body = req.body || {};
  const message = String(body.message || "");
  const image = typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;

  if (!isTextOverlayRequest(message, image)) {
    return originalHandler(req, res);
  }

  try {
    const source = getImageBuffer(image);
    const meta = await sharp(source).metadata();
    const width = meta.width || 1024;
    const height = meta.height || 1024;
    const text = extractText(message);
    const svg = makeLogoSvg(text, width, height, message);
    const out = await sharp(source)
      .composite([{ input: Buffer.from(svg), top:0, left:0 }])
      .jpeg({ quality:95, mozjpeg:true })
      .toBuffer();

    return res.status(200).json({
      success:true,
      image:`data:image/jpeg;base64,${out.toString("base64")}`,
      reply:`できました。「${text}」を指定どおり追加しました。元画像は変更していません。`
    });
  } catch (error) {
    console.error("ICONIA TEXT OVERLAY ERROR", error);
    return res.status(500).json({ success:false, error:error?.message || "文字の追加に失敗しました。" });
  }
}
