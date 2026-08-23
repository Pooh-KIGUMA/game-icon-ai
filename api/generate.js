import OpenAI, { toFile } from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PLANNER_MODEL = "gpt-5.6";
const IMAGE_MODEL = "gpt-image-2";
const clean = (v, n = 12000) => String(v ?? "").trim().slice(0, n);
const uniq = (a) => [...new Set((Array.isArray(a) ? a : []).map(x => clean(x, 800)).filter(Boolean))];

function dataImageToBuffer(value) {
  const m = String(value || "").match(/^data:image\/([^;]+);base64,(.+)$/);
  if (!m) throw new Error("参考画像を読み込めませんでした。");
  const mime = `image/${m[1].toLowerCase()}`;
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("参考画像はJPG・PNG・WebPに対応しています。");
  return { buffer: Buffer.from(m[2], "base64"), mime };
}

function imageSize(text) {
  const t = String(text || "").toLowerCase();
  if (/縦長|portrait|story|ストーリー|tiktok/.test(t)) return "1024x1536";
  if (/横長|landscape|header|ヘッダー|banner|バナー|youtube|サムネ/.test(t)) return "1536x1024";
  return "1024x1024";
}

function exactText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const quoted = [...t.matchAll(/[「『“"]([^」』”"]{1,120})[」』”"]/gu)].map(m => m[1].trim()).filter(Boolean);
  if (quoted.length) return quoted.join("\n");
  const possessive = t.match(/(?:^|\s|[「『])([A-Za-z0-9][A-Za-z0-9 _+\-.]{0,39})の(?:文字|テキスト|ロゴ)(?=\s*(?:を|は|に))/u);
  if (possessive?.[1]) return possessive[1].trim();
  const englishLead = t.match(/(?:^|\s)([A-Za-z0-9][A-Za-z0-9 _+\-.]{0,39})\s*(?:という)?(?:文字|テキスト|ロゴ)(?=\s*(?:を|は|に))/u);
  if (englishLead?.[1]) return englishLead[1].trim();
  const m = t.match(/(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名|ギルド名)\s*(?:は|を|：|:)\s*[「『“"]?([^」』”"\n]{1,100})/u);
  return m?.[1]?.trim() || null;
}

function textPosition(text) {
  const t = String(text || "").toLowerCase();
  if (/右|right/.test(t)) return "right";
  if (/左|left/.test(t)) return "left";
  if (/上|top/.test(t)) return "top";
  if (/下|bottom/.test(t)) return "bottom";
  return null;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const s = String(text || "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) try { return JSON.parse(s.slice(a, b + 1)); } catch {}
  return {};
}

async function makePlan(message, image, history) {
  const recent = (Array.isArray(history) ? history.slice(-20) : [])
    .map((m, i) => `${i + 1}. ${m.role === "user" ? "USER" : "ASSISTANT"}: ${clean(m.text, 1500)}`)
    .join("\n");

  const system = `You are the high-precision visual planning brain for Iconia AI.
Understand the user's whole conversation and turn the request into an exact image operation.
REFERENCE IMAGE RULE: when an image is supplied, treat it as the visual source of truth. Never replace a person/character with another person unless explicitly requested.
CONTEXT RULE: resolve words like これ, このキャラ, さっき, 前の画像, そのまま, もっと, 少し, ここ, 左, 右 using the conversation and reference image.
EDIT RULE: preserve everything not explicitly requested. For a targeted edit, change only the requested property.
STYLE-ONLY RULE: if the user asks only for 絵柄/画風/イラストタッチ/style, lock identity, face, hair, clothing, pose, camera, crop, composition, objects and existing text; change only rendering style.
TEXT DESIGN RULE: when the user requests text, name, team name, clan name, alliance name, logo text, or any typography, DO NOT use a post-processing text overlay. The image model must render the requested text as part of the finished artwork. Preserve the requested text character-for-character. If the user gives no typography details, automatically choose placement, font character, size, color, outline, glow, shadow, angle and integration that best match the reference image. If the user gives typography details, follow those details precisely while harmonizing them with the image.
TEXT REDRAW RULE: with a reference image, any text request should normally use AI_DESIGN or TARGETED_EDIT so the image model redraws the complete composition with the text integrated naturally. Never return TEXT_ONLY for a reference-image request.
SQUARE RULE: unless the user explicitly requests another aspect ratio, game icons are square 1024x1024.
NEW IMAGE RULE: if there is no reference image, create an original image from the request.
Return JSON only with this schema:
{"mode":"ORIGINAL|FAITHFUL|STYLE_ONLY|TARGETED_EDIT|AI_DESIGN|BACKGROUND_ONLY|POSE_ONLY|HAIR_ONLY|CLOTHING_ONLY|TEXT_ONLY","requested_text":string|null,"text_position":string|null,"keep":string[],"change":string[],"style":string,"composition":string,"image_prompt":string,"reply":string}`;

  const content = [{ type: "input_text", text: `LATEST REQUEST:\n${clean(message)}\n\nRECENT CONVERSATION:\n${recent || "none"}\n\nREFERENCE IMAGE: ${image ? "YES" : "NO"}` }];
  if (image) content.push({ type: "input_image", image_url: image, detail: "high" });

  const response = await client.responses.create({
    model: PLANNER_MODEL,
    reasoning: { effort: "high" },
    input: [{ role: "developer", content: system }, { role: "user", content }],
    max_output_tokens: 2600
  });
  return parseJson(response.output_text);
}

function normalize(plan, message, hasImage) {
  let mode = String(plan?.mode || (hasImage ? "TARGETED_EDIT" : "ORIGINAL")).toUpperCase();
  const allowed = new Set(["ORIGINAL","FAITHFUL","STYLE_ONLY","TARGETED_EDIT","AI_DESIGN","BACKGROUND_ONLY","POSE_ONLY","HAIR_ONLY","CLOTHING_ONLY","TEXT_ONLY"]);
  if (!allowed.has(mode)) mode = hasImage ? "TARGETED_EDIT" : "ORIGINAL";

  const requestedText = clean(plan?.requested_text || exactText(message), 140) || null;
  let keep = uniq(plan?.keep);
  let change = uniq(plan?.change);

  // Text on a reference image is always rendered by the image model, never composited afterward.
  if (hasImage && requestedText && mode === "TEXT_ONLY") mode = "AI_DESIGN";
  if (hasImage && requestedText && !mode) mode = "AI_DESIGN";

  if (mode === "STYLE_ONLY") {
    keep.push("exact same person/character identity", "same face and facial landmarks", "same eyes, nose, mouth, expression", "same hairstyle and hair color", "same skin tone and body proportions", "same clothing and accessories", "same pose and camera angle", "same crop and composition", "same background and distinctive objects", "same existing text and logo placement");
    change.push("ONLY illustration rendering style, linework, brushwork, shading, lighting and color finish");
  }
  if (mode === "BACKGROUND_ONLY") change.push("ONLY background/environment");
  if (mode === "POSE_ONLY") change.push("ONLY pose/body position");
  if (mode === "HAIR_ONLY") change.push("ONLY hairstyle/hair color");
  if (mode === "CLOTHING_ONLY") change.push("ONLY clothing/outfit");
  if (hasImage && requestedText) {
    change.push("Integrate the requested typography directly into the generated artwork, not as a separate overlay");
  }

  return {
    mode,
    requestedText,
    textPosition: clean(plan?.text_position, 120) || textPosition(message),
    keep: uniq(keep),
    change: uniq(change),
    style: clean(plan?.style || "premium polished game illustration", 1800),
    composition: clean(plan?.composition || "Preserve the reference composition unless explicitly changed.", 1800),
    imagePrompt: clean(plan?.image_prompt || message, 9000),
    reply: clean(plan?.reply || "できました。続けて修正を指示できます。", 600)
  };
}

function buildPrompt(plan, message) {
  const locks = plan.keep.length ? `\nKEEP EXACTLY:\n- ${plan.keep.join("\n- ")}` : "";
  const changes = plan.change.length ? `\nCHANGE / DESIGN:\n- ${plan.change.join("\n- ")}` : "";
  const text = plan.requestedText ? `\nEXACT TEXT — MUST APPEAR IN THE IMAGE EXACTLY AS WRITTEN: ${plan.requestedText}` : "";
  const position = plan.textPosition ? `\nTEXT POSITION REQUEST: ${plan.textPosition}` : "";
  const autoTypography = plan.requestedText && !plan.textPosition
    ? "\nTYPOGRAPHY: No exact typography was specified. Automatically design the typography to match the reference image's mood, composition, colors and visual hierarchy."
    : "";

  return `Iconia AI high-fidelity image operation.
USER REQUEST:
${clean(message)}

MODE: ${plan.mode}
PLANNER INTENT:
${plan.imagePrompt}

STYLE:
${plan.style}

COMPOSITION:
${plan.composition}${locks}${changes}${text}${position}${autoTypography}

NON-NEGOTIABLE RULES:
- The reference image is the primary source of truth when present.
- Do not change anything the user did not ask to change unless a natural redraw is necessary to integrate requested typography.
- Do not invent people, objects, watermark or signature.
- If text is requested, render the text directly inside the generated image. NEVER add it later with SVG, Sharp, HTML, canvas or another overlay.
- Preserve exact spelling, capitalization, punctuation, spaces and Japanese characters when text is requested.
- If no typography details are specified, choose a professional typography treatment that fits the artwork.
- If typography details are specified, prioritize them exactly.
- For style-only edits, the result must be immediately recognizable as the same image.
- For targeted edits, all unmentioned visual properties remain unchanged.
- Premium game-icon quality, clean anatomy, strong silhouette, controlled lighting, polished finish.`;
}

async function editImage(file, prompt, size, quality) {
  const base = { model: IMAGE_MODEL, image: file, prompt, size, quality, output_format: "jpeg", output_compression: 85, n: 1 };
  let last;
  for (let i = 0; i < 2; i++) {
    try { return await client.images.edit(base); }
    catch (e) { last = e; console.error(`gpt-image-2 edit attempt ${i + 1} failed`, e); }
  }
  throw last;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success:false, error:"POSTリクエストのみ対応しています。" });
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY がVercelに設定されていません。");

    const body = req.body || {};
    const message = clean(body.message);
    const image = typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
    const history = Array.isArray(body.history) ? body.history : [];

    if (!message && !image) return res.status(400).json({ success:false, error:"画像またはメッセージを入力してください。" });
    if (image && image.length > 8_000_000) return res.status(413).json({ success:false, error:"参考画像が大きすぎます。もう少し小さい画像を使ってください。" });

    const plan = normalize(await makePlan(message, image, history), message, Boolean(image));
    const quality = /高品質|高画質|最高|超高精細|精密|最高品質|premium/i.test(message) || ["STYLE_ONLY","FAITHFUL","AI_DESIGN"].includes(plan.mode) ? "high" : "medium";
    const prompt = buildPrompt(plan, message);
    const size = imageSize(message);

    let result;
    if (image) {
      const { buffer, mime } = dataImageToBuffer(image);
      const ext = mime.split("/")[1] === "png" ? "png" : mime.split("/")[1] === "webp" ? "webp" : "jpg";
      result = await editImage(await toFile(buffer, `reference.${ext}`, { type:mime }), prompt, size, quality);
    } else {
      result = await client.images.generate({ model:IMAGE_MODEL, prompt, size, quality, output_format:"jpeg", output_compression:85, n:1 });
    }

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("画像データがAIから返されませんでした。");
    return res.status(200).json({ success:true, image:`data:image/jpeg;base64,${b64}`, reply:plan.reply, plan:{mode:plan.mode, requestedText:plan.requestedText, textPosition:plan.textPosition, keep:plan.keep, change:plan.change} });
  } catch (error) {
    console.error("ICONIA API ERROR", error);
    return res.status(Number(error?.status)||500).json({ success:false, error:error?.error?.message || error?.message || "画像処理中にエラーが発生しました。", code:error?.error?.code || error?.code || null, type:error?.error?.type || error?.type || null });
  }
}
