import OpenAI, { toFile } from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PLANNER_MODEL = "gpt-5.6";
const IMAGE_MODEL = "gpt-image-2";

const clean = (v, max = 9000) => String(v ?? "").trim().slice(0, max);

function imageBuffer(dataUrl) {
  const m = String(dataUrl || "").match(/^data:image\/[^;]+;base64,(.+)$/);
  if (!m) throw new Error("画像データを読み込めませんでした。");
  return Buffer.from(m[1], "base64");
}

function detectSize(text) {
  const t = String(text || "").toLowerCase();
  if (/1\s*[:：]\s*1|正方形|square|アイコン/.test(t)) return "1024x1024";
  if (/(x|twitter).*(ヘッダー|header)|ヘッダー|banner|バナー|横長/.test(t)) return "1536x1024";
  if (/縦長|portrait|ストーリー|story|tiktok/.test(t)) return "1024x1536";
  return "1024x1024";
}

function wantsHighQuality(text) {
  return /高品質|高画質|最高|細かく|超高精細|精密|high quality|high-res/i.test(String(text || ""));
}

function extractRequestedText(message) {
  const t = String(message || "").trim();
  if (!t) return null;
  const quoted = t.match(/[「『“"]([^」』”"]{1,80})[」』”"]/u);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  const namedText = t.match(/([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:の|という)\s*(?:文字|テキスト|ロゴ)\b/i);
  if (namedText?.[1]) return namedText[1].trim();
  const named2 = t.match(/([A-Za-z][A-Za-z0-9._-]{0,39})\s*(?:を|って)\s*(?:入れて|追加して|加えて|書いて|載せて|入れたい|追加したい|入れてください|追加してください)/i);
  if (named2?.[1]) return named2[1].trim();
  const explicit = t.match(/(?:文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名)\s*(?:は|を|：|:)\s*[「『“"]?([A-Za-z0-9._-]{1,60})/u);
  if (explicit?.[1] && !/^(?:入れて|追加して|加えて|書いて|載せて|ください|ほしい|欲しい)$/u.test(explicit[1])) return explicit[1].trim();
  return null;
}

function fallbackMode(message, hasImage) {
  if (!hasImage) return "ORIGINAL";
  const t = String(message || "");
  if (/イラストタッチ|絵柄|画風|タッチ|作画|アートスタイル|絵の感じ|テイスト|style transfer/i.test(t)) return "STYLE_ONLY";
  if (/背景だけ|背景のみ|背景を変更|背景を変え/.test(t)) return "BACKGROUND_ONLY";
  if (/ポーズだけ|ポーズのみ|ポーズを変更|ポーズを変え/.test(t)) return "POSE_ONLY";
  if (/髪だけ|髪型だけ|髪のみ|髪を変更|髪を変え/.test(t)) return "HAIR_ONLY";
  if (/服だけ|衣装だけ|服装だけ|衣装を変更|服を変更/.test(t)) return "CLOTHING_ONLY";
  if (/ほぼそのまま|ほとんどそのまま|原画のまま|原画をそのまま|できるだけそのまま|極力そのまま|原型を残|原画維持|原画を維持|元画像.*そのまま/.test(t)) return "FAITHFUL";
  return "TARGETED_EDIT";
}

function parseJson(text) {
  const raw = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(raw); } catch {}
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(raw.slice(a, b + 1)); } catch {}
  }
  return null;
}

async function understandRequest({ message, history, image }) {
  const recent = Array.isArray(history)
    ? history.slice(-16).map(x => `${x.role === "user" ? "USER" : "ASSISTANT"}: ${clean(x.text, 1600)}`).join("\n")
    : "";

  const developer = `You are the reasoning brain of Iconia AI, a conversational image editing product.
Your job is NOT to generate an image. Your job is to understand the user's intent and produce a precise editing plan for an image model.

Think like a strong ChatGPT assistant: use the entire recent conversation, resolve references such as "これ", "さっきの", "そのまま", "もっと", and understand natural Japanese rather than matching keywords.

CRITICAL IMAGE-EDITING RULES:
1. If a reference image is supplied, it is the source of truth.
2. Preserve the subject's identity unless the user explicitly asks to replace or redesign the subject.
3. If the user asks only to change illustration style / art style / rendering, this is STYLE_ONLY. Preserve the exact person/character, face, hair, expression, pose, clothing, accessories, composition, camera angle and scene. Change only linework, rendering, shading, brushwork, color treatment and finish.
4. If the user asks for a creative redesign such as "もっとカッコよく", "AIに任せる", "ゲームクラン風に", allow creative design, but still preserve the existing character unless the user asks for a different character.
5. If the user asks for exact text, extract the exact text. Never change its spelling, capitalization or symbols.
6. Exact text should be added by the application overlay when possible, not invented by the image model. The image model should reserve clean space for the text and design around it.
7. If the user asks to make the text/logo stylish, describe the desired logo treatment but keep the exact letters.
8. Never interpret "イラストタッチを変えて" as "make a different person".
9. If the user asks for "このまま" or "元画像をそのまま", make the preserve list very strict.
10. For a new image with no reference, use ORIGINAL and creatively fulfill the request.

Return ONLY valid JSON with these keys:
{
  "mode": "ORIGINAL|FAITHFUL|STYLE_ONLY|TARGETED_EDIT|AI_DESIGN|BACKGROUND_ONLY|POSE_ONLY|HAIR_ONLY|CLOTHING_ONLY|TEXT_ONLY",
  "requested_text": string|null,
  "keep": string[],
  "change": string[],
  "composition": string,
  "style": string,
  "text_design": string,
  "image_prompt": string,
  "assistant_reply": string
}

The image_prompt must be an actionable, detailed prompt for the image model. It must explicitly say what NOT to change when preservation matters.`;

  const userContent = [
    { type: "input_text", text: `LATEST USER REQUEST:\n${clean(message)}\n\nRECENT CONVERSATION:\n${recent || "No previous conversation."}\n\nREFERENCE IMAGE: ${image ? "YES" : "NO"}` }
  ];
  if (image) userContent.push({ type: "input_image", image_url: image, detail: "high" });

  const response = await client.responses.create({
    model: PLANNER_MODEL,
    input: [
      { role: "developer", content: developer },
      { role: "user", content: userContent }
    ],
    temperature: 0.2
  });

  const plan = parseJson(response.output_text);
  if (!plan) throw new Error("AIの編集プランを読み取れませんでした。");
  return plan;
}

function normalizePlan(plan, message, hasImage, forceAiDesign) {
  const fallback = fallbackMode(message, hasImage);
  let mode = String(plan?.mode || fallback).toUpperCase();
  const allowed = new Set(["ORIGINAL","FAITHFUL","STYLE_ONLY","TARGETED_EDIT","AI_DESIGN","BACKGROUND_ONLY","POSE_ONLY","HAIR_ONLY","CLOTHING_ONLY","TEXT_ONLY"]);
  if (!allowed.has(mode)) mode = fallback;
  if (forceAiDesign && hasImage && !/文字だけ|テキストだけ|ロゴだけ/.test(message)) mode = "AI_DESIGN";

  const exact = clean(plan?.requested_text || extractRequestedText(message), 80) || null;
  const keep = Array.isArray(plan?.keep) ? plan.keep.map(x => clean(x, 500)).filter(Boolean).slice(0, 30) : [];
  const change = Array.isArray(plan?.change) ? plan.change.map(x => clean(x, 700)).filter(Boolean).slice(0, 30) : [];

  if (mode === "STYLE_ONLY") {
    keep.push("same character/person identity", "same face and facial landmarks", "same hairstyle and hair color", "same expression", "same pose", "same clothing and accessories", "same composition and camera angle", "same background and major objects");
    change.push("only line art, brushwork, shading, rendering method, color treatment and illustration finish");
  }

  return {
    mode,
    requestedText: exact,
    keep: [...new Set(keep)],
    change: [...new Set(change)],
    composition: clean(plan?.composition || "Preserve the source composition unless the user explicitly requested a composition change.", 1800),
    style: clean(plan?.style || "Professional polished game illustration.", 1800),
    textDesign: clean(plan?.text_design || "If exact text is requested, reserve a clean area for it; do not alter the spelling.", 1800),
    imagePrompt: clean(plan?.image_prompt || message, 12000),
    reply: clean(plan?.assistant_reply || "できました。気になるところがあれば、そのまま続けて指示してください。", 500)
  };
}

function buildImagePrompt({ plan, message, hasImage }) {
  const preserve = plan.keep.length ? `\nPRESERVE EXACTLY:\n- ${plan.keep.join("\n- ")}` : "";
  const change = plan.change.length ? `\nCHANGE ONLY AS REQUESTED:\n- ${plan.change.join("\n- ")}` : "";
  const exactText = plan.requestedText ? `\nEXACT TEXT REQUESTED: ${plan.requestedText}\nDo not alter the spelling, capitalization or symbols. Leave intentional clean space for the application to place this exact text.` : "";
  const modeRules = plan.mode === "STYLE_ONLY"
    ? `\nSTYLE TRANSFER HARD LOCK:\nThis is the SAME IMAGE rendered in a different illustration language. Do not redesign the person/character. Do not change face, hair, age, gender, expression, pose, outfit, accessories, composition, camera angle or scene. Only change rendering, line quality, brush texture, shading, lighting treatment and finish.`
    : plan.mode === "FAITHFUL"
      ? `\nFAITHFUL EDIT HARD LOCK:\nKeep the reference almost identical. Make only the explicitly requested changes. Do not improve, redesign or reinterpret unrelated elements.`
      : "";

  return `You are the image-generation stage of Iconia AI. Follow the reasoning plan below exactly.

USER REQUEST:
${clean(message)}

EDIT MODE: ${plan.mode}

AI REASONING PLAN:
${plan.imagePrompt}

COMPOSITION:
${plan.composition}

STYLE:
${plan.style}
${preserve}
${change}
${exactText}
${modeRules}

REFERENCE IMAGE: ${hasImage ? "YES - treat it as the primary visual source" : "NO"}

GLOBAL RULES:
- Never invent or add random text, watermarks, signatures or usernames.
- Preserve requested elements even if they are unusual.
- Do not substitute a different character/person when the user asked to modify the existing one.
- Make the requested change visually strong enough to be noticeable, but do not change unrelated elements.
- Produce polished professional game/SNS artwork with coherent anatomy, lighting, materials and composition.
- If exact text will be overlaid by the application, create a clean, visually appropriate area for it and avoid fake text in that area.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POSTリクエストのみ対応しています。" });
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ success: false, error: "OPENAI_API_KEY がVercelに設定されていません。" });

    const body = req.body || {};
    const message = clean(body.message);
    const image = typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
    const history = Array.isArray(body.history) ? body.history : [];
    const forceAiDesign = body.aiDesign === true;

    if (!message && !image) return res.status(400).json({ success: false, error: "画像またはメッセージを入力してください。" });

    const rawPlan = await understandRequest({ message, history, image });
    const plan = normalizePlan(rawPlan, message, Boolean(image), forceAiDesign);

    // Exact-text-only requests are returned without regenerating the source image.
    // The frontend can use overlay.text to place the exact string with CSS/canvas.
    if (image && plan.mode === "TEXT_ONLY" && plan.requestedText) {
      return res.status(200).json({
        success: true,
        image,
        overlay: { text: plan.requestedText, message, design: plan.textDesign },
        plan: { mode: plan.mode, keep: plan.keep, change: plan.change },
        reply: `できました。「${plan.requestedText}」を元画像に追加します。`
      });
    }

    const size = detectSize(message);
    const quality = (plan.mode === "STYLE_ONLY" || wantsHighQuality(message)) ? "high" : "medium";
    const prompt = buildImagePrompt({ plan, message, hasImage: Boolean(image) });

    let outputBuffer;
    if (image) {
      const sourceBuffer = imageBuffer(image);
      const file = await toFile(sourceBuffer, "reference.jpg", { type: "image/jpeg" });
      const editParams = {
        model: IMAGE_MODEL,
        image: file,
        prompt,
        size,
        quality,
        output_format: "jpeg",
        output_compression: 86,
        n: 1
      };
      if (plan.mode === "STYLE_ONLY" || plan.mode === "FAITHFUL") editParams.input_fidelity = "high";
      const response = await client.images.edit(editParams);
      const base64 = response?.data?.[0]?.b64_json;
      if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");
      outputBuffer = Buffer.from(base64, "base64");
    } else {
      const response = await client.images.generate({
        model: IMAGE_MODEL,
        prompt,
        size,
        quality,
        output_format: "jpeg",
        output_compression: 86,
        n: 1
      });
      const base64 = response?.data?.[0]?.b64_json;
      if (!base64) throw new Error("画像データがOpenAIから返されませんでした。");
      outputBuffer = Buffer.from(base64, "base64");
    }

    return res.status(200).json({
      success: true,
      image: `data:image/jpeg;base64,${outputBuffer.toString("base64")}`,
      ...(plan.requestedText && plan.mode !== "STYLE_ONLY" ? { overlay: { text: plan.requestedText, message, design: plan.textDesign } } : {}),
      plan: { mode: plan.mode, requestedText: plan.requestedText, keep: plan.keep, change: plan.change },
      reply: plan.reply
    });
  } catch (error) {
    console.error("ICONIA API ERROR", error);
    return res.status(Number(error?.status) || 500).json({
      success: false,
      error: error?.error?.message || error?.message || "不明なエラーが発生しました。",
      code: error?.error?.code || error?.code || null,
      type: error?.error?.type || error?.type || null
    });
  }
}
