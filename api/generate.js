import OpenAI, { toFile } from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PLANNER_MODEL = "gpt-5.6";
const IMAGE_MODEL = "gpt-image-2";

const clean = (v, n = 12000) => String(v ?? "").trim().slice(0, n);

function dataImageToBuffer(value) {
  const match = String(value || "").match(/^data:image\/([^;]+);base64,(.+)$/);
  if (!match) throw new Error("参考画像を読み込めませんでした。");
  const mime = `image/${match[1].toLowerCase()}`;
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    throw new Error("参考画像はJPG・PNG・WebPに対応しています。");
  }
  return { buffer: Buffer.from(match[2], "base64"), mime };
}

function imageSize(text) {
  const t = String(text || "").toLowerCase();
  if (/ヘッダー|header|banner|バナー|横長|xのヘッダー/.test(t)) return "1536x1024";
  if (/縦長|portrait|story|ストーリー|tiktok/.test(t)) return "1024x1536";
  return "1024x1024";
}

function exactText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const quoted = [...t.matchAll(/[「『“"]([^」』”"]{1,100})[」』”"]/gu)].map(m => m[1].trim()).filter(Boolean);
  if (quoted.length) return quoted.join("\n");
  const m = t.match(/(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名|ギルド名)\s*(?:は|を|：|:)\s*[「『“"]?([^」』”"\n]{1,80})/u);
  if (m) return m[1].trim();
  return null;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const a = String(text || "").indexOf("{");
  const b = String(text || "").lastIndexOf("}");
  if (a >= 0 && b > a) try { return JSON.parse(text.slice(a, b + 1)); } catch {}
  return {};
}

async function makePlan(message, image, history) {
  const recent = (Array.isArray(history) ? history.slice(-16) : [])
    .map((m, i) => `${i + 1}. ${m.role === "user" ? "USER" : "AI"}: ${clean(m.text, 1200)}`)
    .join("\n");

  const system = `You are Iconia AI's image-editing planner.
Understand the entire conversation, not only the latest sentence.
When a reference image exists, it is the source of truth.
For edits, preserve the same person/character identity unless the user explicitly asks to replace them.
Preserve face, eyes, hair, skin tone, body proportions, clothing, accessories, pose, camera angle, crop, composition and existing text/logo unless the user asks to change them.
If the user asks only for illustration style/touch/絵柄/画風, mode MUST be STYLE_ONLY and the same subject and composition must remain immediately recognizable. Change only rendering style, linework, brushwork, shading and color treatment.
If the user asks for a specific element, change ONLY that element.
Exact user-provided text must be reproduced character-for-character.
Return JSON only:
{"mode":"ORIGINAL|FAITHFUL|STYLE_ONLY|TARGETED_EDIT|AI_DESIGN|BACKGROUND_ONLY|POSE_ONLY|HAIR_ONLY|CLOTHING_ONLY|TEXT_ONLY","requested_text":string|null,"text_position":string|null,"keep":string[],"change":string[],"style":string,"composition":string,"image_prompt":string,"reply":string}`;

  const content = [{
    type: "input_text",
    text: `LATEST REQUEST:\n${clean(message)}\n\nRECENT CONVERSATION:\n${recent || "none"}\nREFERENCE IMAGE: ${image ? "YES" : "NO"}`
  }];
  if (image) content.push({ type: "input_image", image_url: image, detail: "high" });

  const response = await client.responses.create({
    model: PLANNER_MODEL,
    input: [{ role: "developer", content: system }, { role: "user", content }],
    max_output_tokens: 2200
  });
  return parseJson(response.output_text);
}

function normalize(plan, message, hasImage) {
  let mode = String(plan?.mode || (hasImage ? "TARGETED_EDIT" : "ORIGINAL")).toUpperCase();
  const allowed = new Set(["ORIGINAL","FAITHFUL","STYLE_ONLY","TARGETED_EDIT","AI_DESIGN","BACKGROUND_ONLY","POSE_ONLY","HAIR_ONLY","CLOTHING_ONLY","TEXT_ONLY"]);
  if (!allowed.has(mode)) mode = hasImage ? "TARGETED_EDIT" : "ORIGINAL";

  const text = clean(plan?.requested_text || exactText(message), 120) || null;
  let keep = Array.isArray(plan?.keep) ? plan.keep : [];
  let change = Array.isArray(plan?.change) ? plan.change : [];

  if (mode === "STYLE_ONLY") {
    keep = [...keep,
      "same person/character identity",
      "same face and facial landmarks",
      "same eyes, nose, mouth and expression",
      "same hairstyle and hair color",
      "same skin tone and body proportions",
      "same clothing and accessories",
      "same pose and camera angle",
      "same crop and composition",
      "same background and distinctive objects",
      "same existing text/logo placement"
    ];
    change = [...change, "ONLY illustration rendering style, linework, brushwork, shading, lighting and color finish"];
  }

  return {
    mode, requestedText: text,
    textPosition: clean(plan?.text_position, 100) || null,
    keep: [...new Set(keep.map(x => clean(x, 500)).filter(Boolean))],
    change: [...new Set(change.map(x => clean(x, 600)).filter(Boolean))],
    style: clean(plan?.style || "premium polished game illustration", 1800),
    composition: clean(plan?.composition || "Preserve the reference composition unless explicitly changed.", 1800),
    imagePrompt: clean(plan?.image_prompt || message, 9000),
    reply: clean(plan?.reply || "できました。気になるところがあれば、そのまま続けて指示してください。", 500)
  };
}

function buildPrompt(plan, message) {
  const locks = plan.keep.length ? `\nKEEP EXACTLY:\n- ${plan.keep.join("\n- ")}` : "";
  const changes = plan.change.length ? `\nCHANGE ONLY:\n- ${plan.change.join("\n- ")}` : "";
  const text = plan.requestedText ? `\nEXACT TEXT: ${plan.requestedText}\nDo not change spelling, capitalization or characters.` : "";
  const position = plan.textPosition ? `\nTEXT POSITION: ${plan.textPosition}` : "";
  const styleLock = plan.mode === "STYLE_ONLY" ? `\nSTYLE-ONLY HARD LOCK:\nTreat the reference as the exact visual blueprint.\nDo NOT replace, redesign, beautify, reposition or invent the subject.\nThe output must be immediately recognizable as the same image.\nChange ONLY the requested illustration rendering style.` : "";

  return `Iconia AI premium image edit.\nUSER REQUEST:\n${clean(message)}\n\nMODE: ${plan.mode}\nPLANNER:\n${plan.imagePrompt}\n\nSTYLE:\n${plan.style}\n\nCOMPOSITION:\n${plan.composition}${locks}${changes}${text}${position}${styleLock}\n\nGLOBAL RULES:\n- Reference image is the primary source when present.\n- Never invent extra text, watermark, signature or logo.\n- Preserve everything not explicitly requested.\n- Premium game/SNS quality, polished anatomy, cinematic readable lighting, clean silhouette.`;
}

async function editImage(file, prompt, size, quality) {
  const base = { model: IMAGE_MODEL, image: file, prompt, size, quality, output_format: "jpeg", output_compression: 70, n: 1 };
  try {
    return await client.images.edit(base);
  } catch (firstError) {
    console.error("gpt-image-2 edit failed; retrying once", firstError);
    try { return await client.images.edit({ ...base }); }
    catch (secondError) { console.error("gpt-image-2 second edit failed", secondError); throw firstError; }
  }
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
    if (image && image.length > 6_000_000) return res.status(413).json({ success: false, error: "参考画像が大きすぎます。画像を少し小さくして、もう一度試してください。" });

    const plan = normalize(await makePlan(message, image, history), message, Boolean(image));
    if (image && plan.mode === "TEXT_ONLY" && plan.requestedText) {
      return res.status(200).json({ success: true, image, overlay: { text: plan.requestedText, message, design: plan.style, position: plan.textPosition }, reply: `できました。「${plan.requestedText.replace(/\n/g, " / ")}」を元画像に追加します。` });
    }

    const quality = (/高品質|高画質|最高|超高精細|精密|最高品質/i.test(message) || plan.mode === "STYLE_ONLY") ? "high" : "medium";
    const prompt = buildPrompt(plan, message);
    let result;
    if (image) {
      const { buffer, mime } = dataImageToBuffer(image);
      const extension = mime.split("/")[1] === "png" ? "png" : mime.split("/")[1] === "webp" ? "webp" : "jpg";
      const file = await toFile(buffer, `reference.${extension}`, { type: mime });
      result = await editImage(file, prompt, imageSize(message), quality);
    } else {
      result = await client.images.generate({ model: IMAGE_MODEL, prompt, size: imageSize(message), quality, output_format: "jpeg", output_compression: 70, n: 1 });
    }

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("画像データがAIから返されませんでした。");
    return res.status(200).json({ success: true, image: `data:image/jpeg;base64,${b64}`, reply: plan.reply, plan: { mode: plan.mode, keep: plan.keep, change: plan.change } });
  } catch (error) {
    console.error("ICONIA API ERROR", error);
    const status = Number(error?.status) || 500;
    return res.status(status).json({ success: false, error: error?.error?.message || error?.message || "画像処理中にエラーが発生しました。", code: error?.error?.code || error?.code || null, type: error?.error?.type || error?.type || null });
  }
}
