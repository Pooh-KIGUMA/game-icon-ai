import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import fs from "node:fs/promises";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PLANNER_MODEL = "gpt-5.6";
const IMAGE_MODEL = "gpt-image-2";
const clean = (v, n = 12000) => String(v ?? "").trim().slice(0, n);
const uniq = (a) => [...new Set((Array.isArray(a) ? a : []).map(x => clean(x, 800)).filter(Boolean))];

const FORMATS = {
  icon: { modelSize: "1024x1024", width: 1024, height: 1024, label: "ゲームアイコン 1:1" },
  xheader: { modelSize: "1536x1024", width: 1500, height: 500, label: "X / Twitter ヘッダー 3:1" },
  youtube: { modelSize: "1536x1024", width: 1280, height: 720, label: "YouTube サムネイル 16:9" },
  portrait: { modelSize: "1024x1536", width: 1024, height: 1536, label: "縦長 2:3" }
};

let japaneseFontReady = null;
async function ensureJapaneseFont() {
  if (japaneseFontReady) return japaneseFontReady;
  japaneseFontReady = (async () => {
    const dir = "/tmp/iconia-fonts";
    const fontPath = `${dir}/NotoSansJP-VF.ttf`;
    const configPath = `${dir}/fonts.conf`;
    await fs.mkdir(dir, { recursive: true });
    try { await fs.access(fontPath); }
    catch {
      const r = await fetch("https://github.com/notofonts/noto-cjk/raw/main/Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf");
      if (!r.ok) throw new Error(`日本語フォントの取得に失敗しました (${r.status})`);
      await fs.writeFile(fontPath, Buffer.from(await r.arrayBuffer()));
    }
    await fs.writeFile(configPath, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${dir}</dir><cachedir>/tmp/iconia-font-cache</cachedir></fontconfig>`);
    process.env.FONTCONFIG_FILE = configPath;
    process.env.FONTCONFIG_PATH = dir;
    return fontPath;
  })().catch(e => { japaneseFontReady = null; throw e; });
  return japaneseFontReady;
}

function dataImageToBuffer(value) {
  const m = String(value || "").match(/^data:image\/([^;]+);base64,(.+)$/);
  if (!m) throw new Error("参考画像を読み込めませんでした。");
  const mime = `image/${m[1].toLowerCase()}`;
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("参考画像はJPG・PNG・WebPに対応しています。");
  return { buffer: Buffer.from(m[2], "base64"), mime };
}

function formatFrom(message, requested) {
  const t = `${message} ${requested || ""}`.toLowerCase();
  if (/x\s*\/\s*twitter|twitter|xのヘッダー|xヘッダー|twitterヘッダー|ツイッター.*ヘッダー|ヘッダー|banner|バナー/.test(t)) return "xheader";
  if (/youtube|ユーチューブ|サムネイル|thumbnail/.test(t)) return "youtube";
  if (/縦長|portrait|ポートレート|ストーリー|tiktok/.test(t)) return "portrait";
  return "icon";
}

function exactText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const quoted = [...t.matchAll(/[「『“"]([^」』”"]{1,120})[」』”"]/gu)].map(m => m[1].trim()).filter(Boolean);
  if (quoted.length) return quoted.join("\n");
  const m1 = t.match(/(?:^|\s|[「『])([A-Za-z0-9][A-Za-z0-9 _+\-.]{0,39})の(?:文字|テキスト|ロゴ)(?=\s*(?:を|は|に))/u);
  if (m1?.[1]) return m1[1].trim();
  const m2 = t.match(/(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名|ギルド名)\s*(?:は|を|：|:)\s*[「『“"]?([^」』”"\n]{1,100})/u);
  return m2?.[1]?.trim() || null;
}

function textPosition(text) {
  const t = String(text || "").toLowerCase();
  if (/右|right/.test(t)) return "right";
  if (/左|left/.test(t)) return "left";
  if (/上|top/.test(t)) return "top";
  if (/下|bottom/.test(t)) return "bottom";
  return null;
}

function textScale(text) {
  const t = String(text || "").toLowerCase();
  if (/極端に大き|最大|画面いっぱい|超大き|めちゃくちゃ大き/.test(t)) return 0.19;
  if (/かなり大き|ものすごく大き|とても大き/.test(t)) return 0.16;
  if (/大きく|大きめ|もっと大き|大きな|large|big/.test(t)) return 0.135;
  if (/小さく|小さめ|small/.test(t)) return 0.055;
  return 0.095;
}

function isTextOnlyRequest(message, hasImage) {
  if (!hasImage) return false;
  const t = String(message || "");
  if (!exactText(t)) return false;
  if (!/(文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名|ギルド名)/u.test(t)) return false;
  return !/(背景|ポーズ|髪|髪型|服|衣装|人物|顔|構図|キャラ|イラストタッチ|画風|絵柄|スタイル).*(変え|変更|追加|消し|削除|描き|書き直)/u.test(t);
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const s = String(text || "");
  const a = s.indexOf("{"); const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) try { return JSON.parse(s.slice(a, b + 1)); } catch {}
  return {};
}

async function makePlan(message, image, history, format) {
  const recent = (Array.isArray(history) ? history.slice(-24) : []).map((m, i) => `${i + 1}. ${m.role === "user" ? "USER" : "ASSISTANT"}: ${clean(m.text, 1800)}`).join("\n");
  const system = `You are Iconia AI's high-precision visual editor planner. Your job is to understand the full conversation, the reference image and the latest request, then produce a conservative edit plan. Never invent changes. The reference image is the source of truth. Preserve the exact person/character identity, face, hair, clothing, pose, objects, text, camera and composition unless the user explicitly asks to change them. If the user asks for only a style change, change rendering style only. If the user asks for only background, change background only. If the user asks for text, preserve the image and typography intent; exact characters matter more than artistic improvisation. When the user says something is bigger/smaller/moved, treat it as a hard requirement. Resolve pronouns such as 'this', 'that', 'the previous image' using the supplied conversation. The output canvas defaults to a square game icon unless the requested format is X/Twitter header, YouTube thumbnail, or portrait. Return JSON only: {"mode":"ORIGINAL|FAITHFUL|STYLE_ONLY|TARGETED_EDIT|AI_DESIGN|BACKGROUND_ONLY|POSE_ONLY|HAIR_ONLY|CLOTHING_ONLY|TEXT_ONLY","requested_text":string|null,"text_position":string|null,"text_style":string|null,"keep":string[],"change":string[],"style":string,"composition":string,"image_prompt":string,"reply":string}`;
  const content = [{ type: "input_text", text: `LATEST REQUEST:\n${clean(message)}\n\nOUTPUT FORMAT:\n${format.label}\n\nRECENT CONVERSATION:\n${recent || "none"}\n\nREFERENCE IMAGE: ${image ? "YES" : "NO"}` }];
  if (image) content.push({ type: "input_image", image_url: image, detail: "high" });
  const r = await client.responses.create({
    model: PLANNER_MODEL,
    reasoning: { effort: "high" },
    input: [{ role: "developer", content: system }, { role: "user", content }],
    max_output_tokens: 2600
  });
  return parseJson(r.output_text);
}

function normalize(plan, message, hasImage, format) {
  let mode = String(plan?.mode || (hasImage ? "FAITHFUL" : "ORIGINAL")).toUpperCase();
  const allowed = new Set(["ORIGINAL", "FAITHFUL", "STYLE_ONLY", "TARGETED_EDIT", "AI_DESIGN", "BACKGROUND_ONLY", "POSE_ONLY", "HAIR_ONLY", "CLOTHING_ONLY", "TEXT_ONLY"]);
  if (!allowed.has(mode)) mode = hasImage ? "FAITHFUL" : "ORIGINAL";
  const requestedText = clean(plan?.requested_text || exactText(message), 140) || null;
  const keep = uniq(plan?.keep);
  const change = uniq(plan?.change);
  if (hasImage) keep.push("exact subject identity", "same face and recognizable features", "same hair unless explicitly changed", "same clothing unless explicitly changed", "same pose unless explicitly changed", "same important objects", "same camera/composition unless explicitly changed", "same existing text unless explicitly changed");
  if (mode === "STYLE_ONLY") change.push("ONLY rendering style / brush / lighting language");
  if (mode === "BACKGROUND_ONLY") change.push("ONLY background/environment");
  if (mode === "POSE_ONLY") change.push("ONLY pose/body position");
  if (mode === "HAIR_ONLY") change.push("ONLY hairstyle/hair color");
  if (mode === "CLOTHING_ONLY") change.push("ONLY clothing/outfit");
  if (mode === "TEXT_ONLY") change.push("ONLY typography");
  return {
    mode,
    requestedText,
    textPosition: clean(plan?.text_position, 80) || textPosition(message),
    textStyle: clean(plan?.text_style, 700),
    keep: uniq(keep),
    change: uniq(change),
    style: clean(plan?.style || "premium polished game illustration", 1800),
    composition: clean(plan?.composition || "Preserve the reference composition unless explicitly changed.", 1800),
    imagePrompt: clean(plan?.image_prompt || message, 9000),
    reply: clean(plan?.reply || "できました。", 500),
    format
  };
}

function buildPrompt(plan, message) {
  const strict = plan.mode === "FAITHFUL" || plan.mode === "STYLE_ONLY" || plan.mode === "BACKGROUND_ONLY" || plan.mode === "TEXT_ONLY";
  return `Iconia AI high-fidelity image editing operation.\nLATEST USER REQUEST:\n${clean(message)}\nMODE: ${plan.mode}\nOUTPUT FORMAT: ${plan.format.label}\n\nINTENT:\n${plan.imagePrompt}\n\nSTYLE:\n${plan.style}\n\nCOMPOSITION:\n${plan.composition}\n\nKEEP EXACTLY:\n- ${plan.keep.join("\n- ")}\n\nONLY CHANGE:\n- ${plan.change.join("\n- ")}\n${plan.requestedText ? `\nEXACT TEXT (do not alter spelling, case, punctuation or characters): ${plan.requestedText}` : ""}\n${plan.textPosition ? `TEXT POSITION: ${plan.textPosition}` : ""}\n${plan.textStyle ? `TEXT STYLE: ${plan.textStyle}` : ""}\n${strict ? "\nIDENTITY LOCK: Do not redesign, replace, beautify into a different person, or regenerate unrequested parts. Keep the same recognizable subject from the reference." : ""}\nQUALITY: premium commercial game artwork, clean anatomy, coherent lighting, crisp details, polished finish.\nNON-NEGOTIABLE: Never change an unrequested element just because it seems aesthetically preferable.`;
}

async function editImage(file, prompt, size, quality) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      return await client.images.edit({ model: IMAGE_MODEL, image: file, prompt, size, quality, output_format: "jpeg", output_compression: 88, n: 1 });
    } catch (e) { last = e; console.error(`image edit attempt ${i + 1} failed`, e); }
  }
  throw last;
}

async function renderText(imageData, text, position, textStyle, message, formatKey) {
  await ensureJapaneseFont();
  const { buffer } = dataImageToBuffer(imageData);
  const fmt = FORMATS[formatKey] || FORMATS.icon;
  const source = await sharp(buffer).resize(fmt.width, fmt.height, { fit: "cover", position: "attention" }).jpeg({ quality: 95 }).toBuffer();
  const w = fmt.width, h = fmt.height;
  const lines = String(text).split(/\n/).slice(0, 6);
  let fs0 = Math.round(Math.min(w, h) * textScale(message));
  if (formatKey === "xheader") fs0 = Math.max(fs0, 72);
  if (formatKey === "youtube") fs0 = Math.max(fs0, 64);
  const maxWidth = w * (/右|right/.test(String(position || "")) ? .72 : .86);
  const estimated = Math.max(...lines.map(x => x.length)) * fs0 * .62;
  if (estimated > maxWidth) fs0 = Math.max(28, Math.floor(fs0 * maxWidth / estimated));
  let x = w / 2, y = h * .84, anchor = "middle";
  const p = String(position || "").toLowerCase();
  if (/left|左/.test(p)) { x = w * .08; anchor = "start"; y = h * .78; }
  else if (/right|右/.test(p)) { x = w * .92; anchor = "end"; y = h * .78; }
  else if (/top|上/.test(p)) y = h * .16;
  else if (/center|中央|真ん中|中央/.test(p)) y = h * .52;
  const s = `${textStyle} ${message}`;
  let fill1 = "#ffffff", fill2 = "#bfe3ff", stroke = "#071321";
  if (/gold|金|黄色/.test(s)) { fill1 = "#fff7c2"; fill2 = "#f0b52a"; stroke = "#3b2300"; }
  if (/pink|ピンク/.test(s)) { fill1 = "#fff0fa"; fill2 = "#ff66c8"; stroke = "#3a092c"; }
  if (/red|赤/.test(s)) { fill1 = "#fff0f0"; fill2 = "#ff4545"; stroke = "#3b0000"; }
  if (/purple|紫/.test(s)) { fill1 = "#f8efff"; fill2 = "#a66cff"; stroke = "#21063d"; }
  if (/green|緑/.test(s)) { fill1 = "#f1fff3"; fill2 = "#4ee07a"; stroke = "#07351a"; }
  if (/black|黒/.test(s)) { fill1 = "#ffffff"; fill2 = "#777777"; stroke = "#050505"; }
  const escSvg = v => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const tspans = lines.map((line, i) => `<tspan x="${x}" dy="${i ? fs0 * 1.16 : 0}">${escSvg(line)}</tspan>`).join("");
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" xml:lang="ja"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fill1}"/><stop offset=".55" stop-color="${fill2}"/><stop offset="1" stop-color="${fill1}"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="${Math.max(3, fs0 * .07)}" stdDeviation="${Math.max(3, fs0 * .05)}" flood-color="#000" flood-opacity=".9"/></filter></defs><text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" font-family="Noto Sans CJK JP" font-weight="900" font-style="italic" font-size="${fs0}" fill="url(#g)" stroke="${stroke}" stroke-width="${Math.max(4, fs0 * .13)}" stroke-linejoin="round" paint-order="stroke" filter="url(#s)">${tspans}</text></svg>`;
  const out = await sharp(source).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 96 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

async function fitExactCanvas(dataUrl, formatKey) {
  const fmt = FORMATS[formatKey] || FORMATS.icon;
  const { buffer } = dataImageToBuffer(dataUrl);
  const out = await sharp(buffer).resize(fmt.width, fmt.height, { fit: "cover", position: "attention" }).jpeg({ quality: 95 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POSTリクエストのみ対応しています。" });
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY がVercelに設定されていません。");
    const body = req.body || {};
    const message = clean(body.message);
    const image = typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
    const history = Array.isArray(body.history) ? body.history : [];
    const requestedFormat = ["icon", "xheader", "youtube", "portrait"].includes(body.format) ? body.format : null;
    if (!message && !image) return res.status(400).json({ success: false, error: "画像またはメッセージを入力してください。" });
    if (image && image.length > 8_000_000) return res.status(413).json({ success: false, error: "参考画像が大きすぎます。もう少し小さい画像を使ってください。" });

    const formatKey = requestedFormat || formatFrom(message, body.format);
    const format = FORMATS[formatKey];

    if (isTextOnlyRequest(message, Boolean(image))) {
      let plan = {};
      try { plan = normalize(await makePlan(message, image, history, format), message, true, format); }
      catch (e) { console.warn("Typography planner fallback", e); plan = normalize({}, message, true, format); }
      const requested = plan.requestedText || exactText(message);
      const edited = await renderText(image, requested, plan.textPosition, plan.textStyle, message, formatKey);
      return res.status(200).json({ success: true, image: edited, reply: `できました。「${requested}」を${format.label}として配置しました。元画像の人物・背景・構図は維持しています。`, plan: { mode: "TEXT_ONLY", requestedText: requested, textPosition: plan.textPosition, textStyle: plan.textStyle, keep: ["元画像の人物・背景・構図・服装・ポーズ"], change: ["文字だけ"], format: formatKey } });
    }

    const plan = normalize(await makePlan(message, image, history, format), message, Boolean(image), format);
    const quality = /高品質|高画質|最高|超高精細|精密|最高品質|premium/i.test(message) || ["STYLE_ONLY", "FAITHFUL", "AI_DESIGN"].includes(plan.mode) ? "high" : "medium";
    const prompt = buildPrompt(plan, message);
    let result;
    if (image) {
      const { buffer, mime } = dataImageToBuffer(image);
      const ext = mime.split("/")[1] === "png" ? "png" : mime.split("/")[1] === "webp" ? "webp" : "jpg";
      result = await editImage(await toFile(buffer, `reference.${ext}`, { type: mime }), prompt, format.modelSize, quality);
    } else {
      result = await client.images.generate({ model: IMAGE_MODEL, prompt, size: format.modelSize, quality, output_format: "jpeg", output_compression: 88, n: 1 });
    }
    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("画像データがAIから返されませんでした。");
    let output = `data:image/jpeg;base64,${b64}`;
    output = await fitExactCanvas(output, formatKey);
    return res.status(200).json({ success: true, image: output, reply: plan.reply, plan: { mode: plan.mode, requestedText: plan.requestedText, textPosition: plan.textPosition, textStyle: plan.textStyle, keep: plan.keep, change: plan.change, format: formatKey, formatLabel: format.label } });
  } catch (error) {
    console.error("ICONIA API ERROR", error);
    const msg = error?.error?.message || error?.message || "画像処理中にエラーが発生しました。";
    const safety = /safety|content policy|policy|rejected/i.test(msg);
    return res.status(Number(error?.status) || 500).json({ success: false, error: safety ? "この操作は画像生成AIの安全システムにより拒否されました。別の表現で試してください。" : msg, code: error?.error?.code || error?.code || null, type: error?.error?.type || error?.type || null });
  }
}
