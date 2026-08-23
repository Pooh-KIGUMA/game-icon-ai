import OpenAI, { toFile } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = "gpt-image-2";

function text(value, max = 6000) {
  return String(value || "").trim().slice(0, max);
}

function decodeImage(dataUrl) {
  const match = String(dataUrl || "").match(
    /^data:image\/[^;]+;base64,(.+)$/
  );

  if (!match) {
    throw new Error("画像データを読み込めませんでした。");
  }

  return Buffer.from(match[1], "base64");
}

function makePrompt(message, history, hasImage) {
  const previous = Array.isArray(history)
    ? history
        .slice(-8)
        .map(x => {
          const role =
            x.role === "user"
              ? "USER"
              : "ASSISTANT";

          return `${role}: ${text(x.text, 1200)}`;
        })
        .join("\n")
    : "";

  return `
You are Iconia AI, a professional conversational image creation assistant.

The user wants to create images by talking naturally, similar to a conversational AI.

LATEST USER REQUEST:
${text(message)}

PREVIOUS CONVERSATION:
${previous || "No previous conversation."}

IMAGE PROVIDED:
${hasImage ? "YES" : "NO"}

IMPORTANT:

- Follow the latest user request exactly.
- Use previous conversation when the user says "this character", "this image", "make it bigger", "change only the background", etc.
- If an image is provided, use it as the primary reference.
- Preserve the original image as much as possible when the user asks to preserve it.
- If the user asks to change only one thing, do not unnecessarily change other things.
- If the user asks for an original character and no image is provided, create an original character.
- Do not invent names.
- Do not invent player names.
- Do not invent alliance names.
- Do not invent clan names.
- Do not add Pooh.
- Do not add AxLF.
- Do not add Player name.
- Do not add Iconia AI.
- Do not add Game Icon AI.
- Do not add watermarks.
- Do not add signatures.
- Do not add logos unless explicitly requested.
- Do not add text unless explicitly requested.
- If text is requested, use exactly the requested text.
- If the user wants an icon, prioritize the character and keep the composition clean.
- If the user wants an SNS header, use an appropriate wide composition.
- If the user does not specify a ratio, use a square composition.
- Prioritize visual quality and the user's actual request over generic image-generation conventions.

Create the image directly.
Do not explain your reasoning.
`;
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST only"
    });
  }

  try {

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error:
          "OPENAI_API_KEY がVercelに設定されていません。"
      });
    }

    const body = req.body || {};

    const message =
      text(body.message);

    const image =
      body.image || null;

    const history =
      Array.isArray(body.history)
        ? body.history
        : [];

    if (!message && !image) {
      return res.status(400).json({
        error:
          "画像またはメッセージが必要です。"
      });
    }

    const prompt =
      makePrompt(
        message,
        history,
        Boolean(image)
      );

    let result;

    /*
     * =========================
     * 新規画像
     * =========================
     */

    if (!image) {

      console.log(
        "ICONIA: generating new image"
      );

      result =
        await openai.images.generate({
          model: MODEL,
          prompt,
          size: "1024x1024",
          quality: "medium",
          output_format: "jpeg",
          output_compression: 70,
          n: 1
        });

    }

    /*
     * =========================
     * 画像編集
     * =========================
     */

    else {

      console.log(
        "ICONIA: editing image"
      );

      const buffer =
        decodeImage(image);

      const file =
        await toFile(
          buffer,
          "reference.jpg",
          {
            type: "image/jpeg"
          }
        );

      result =
        await openai.images.edit({
          model: MODEL,
          image: file,
          prompt,
          size: "1024x1024",
          quality: "medium",
          output_format: "jpeg",
          output_compression: 70,
          n: 1
        });

    }

    const base64 =
      result?.data?.[0]?.b64_json;

    if (!base64) {
      throw new Error(
        "OpenAIから画像データが返されませんでした。"
      );
    }

    const imageData =
      `data:image/jpeg;base64,${base64}`;

    return res.status(200).json({

      success: true,

      image: imageData,

      reply:
        "できました。気になるところがあれば、そのまま続けて指示してください。"

    });

  } catch (error) {

    console.error(
      "========== ICONIA ERROR =========="
    );

    console.error(error);

    console.error(
      "==================================="
    );

    /*
     * OpenAIの本当のエラーを
     * フロント側へ返す
     */

    const apiMessage =
      error?.error?.message ||
      error?.message ||
      "不明なエラー";

    const status =
      Number(error?.status) || 500;

    return res.status(status).json({

      success: false,

      error: apiMessage,

      type:
        error?.error?.type ||
        null,

      code:
        error?.error?.code ||
        null

    });

  }

}