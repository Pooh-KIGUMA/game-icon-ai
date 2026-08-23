import OpenAI, { toFile } from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = "gpt-image-2";

function cleanText(value, max = 8000) {
  return String(value ?? "").trim().slice(0, max);
}

function getImageBuffer(dataUrl) {
  const match = String(dataUrl || "").match(
    /^data:image\/[^;]+;base64,(.+)$/
  );

  if (!match) {
    throw new Error("画像データを読み込めませんでした。");
  }

  return Buffer.from(match[1], "base64");
}

function detectSize(message) {
  const text = String(message || "").toLowerCase();

  if (
    text.includes("ヘッダー") ||
    text.includes("header") ||
    text.includes("横長") ||
    text.includes("xのヘッダー") ||
    text.includes("twitter")
  ) {
    return "1536x1024";
  }

  if (
    text.includes("縦長") ||
    text.includes("portrait") ||
    text.includes("ストーリー")
  ) {
    return "1024x1536";
  }

  return "1024x1024";
}

function buildPrompt({
  message,
  history,
  hasImage,
}) {
  const previousConversation = Array.isArray(history)
    ? history
        .slice(-10)
        .map((item) => {
          const role =
            item.role === "user"
              ? "USER"
              : "ASSISTANT";

          return `${role}: ${cleanText(item.text, 1500)}`;
        })
        .join("\n")
    : "";

  return `
You are Iconia AI, a professional conversational image creation assistant.

The user interacts with you naturally in Japanese.

Your job is to turn the user's visual request into the best possible image.

LATEST USER REQUEST:
${cleanText(message)}

RECENT CONVERSATION:
${previousConversation || "No previous conversation."}

REFERENCE IMAGE:
${hasImage ? "YES - an image is provided." : "NO IMAGE."}

IMPORTANT RULES:

1. FOLLOW THE LATEST REQUEST
The latest user message is the highest priority.

2. CONVERSATIONAL CONTINUITY
If the user says:
- "もっとかっこよく"
- "髪を長くして"
- "背景だけ変えて"
- "このキャラのまま"
- "さっきの画像"
- "もう少し明るく"
- "文字を右側に"

understand what they mean from the previous conversation and previous image.

3. IMAGE PRESERVATION
When an image is supplied and the user wants to keep it:
preserve the original character, face, clothing, composition and important details as much as possible.

Only change the things the user requested.

4. ORIGINAL CREATION
When there is no reference image:
create a completely original character/image based on the user's description.

5. TEXT
NEVER invent text.

NEVER add:
- player names
- alliance names
- clan names
- usernames
- logos
- watermarks
- signatures
- "Pooh"
- "AxLF"
- "Player name"
- "Iconia AI"
- "Game Icon AI"

unless the user explicitly requests that exact text.

If the user asks for text, reproduce the requested text as accurately as possible.

6. DO NOT CHANGE UNREQUESTED ELEMENTS
If the user asks only to change the background, keep the character.
If the user asks only to change the text, keep the image.
If the user asks only to brighten the image, do not redesign it.

7. IMAGE QUALITY
Prioritize:
- attractive composition
- clear face
- detailed character
- strong lighting
- professional game/SNS artwork
- clean composition
- appropriate subject scale

8. SNS / GAME USE
If the user asks for:
- game icon
- X icon
- Instagram icon
- LINE icon
- profile image

favor a centered subject and composition that works well as a profile picture.

If the user asks for:
- X header
- Twitter header
- banner
- YouTube banner

favor a wide composition and leave useful negative space when appropriate.

9. USER FREEDOM
Do not force the user into predefined character types, moods, colors or backgrounds.

Interpret natural language freely.

10. CONTINUOUS EDITING
When editing a previous generated image, treat the previous image as the main visual source.

11. NO EXPLANATION
Generate the image.
Do not explain the prompt.
Do not describe what you are doing.

Create the best possible image from the user's request.
`;
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "POSTリクエストのみ対応しています。",
    });
  }

  try {

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error:
          "OPENAI_API_KEY がVercelに設定されていません。",
      });
    }

    const body = req.body || {};

    const message = cleanText(body.message);

    const image =
      typeof body.image === "string"
        ? body.image
        : null;

    const history =
      Array.isArray(body.history)
        ? body.history
        : [];

    if (!message && !image) {
      return res.status(400).json({
        success: false,
        error:
          "画像またはメッセージを入力してください。",
      });
    }

    const size = detectSize(message);

    const prompt = buildPrompt({
      message,
      history,
      hasImage: Boolean(image),
    });

    let response;

    /*
     * ================================
     * 新規生成
     * ================================
     */

    if (!image) {

      response = await client.images.generate({
        model: MODEL,
        prompt,
        size,
        quality: "medium",
        output_format: "jpeg",
        output_compression: 75,
        n: 1,
      });

    }

    /*
     * ================================
     * 画像編集
     * ================================
     */

    else {

      const buffer = getImageBuffer(image);

      const file = await toFile(
        buffer,
        "reference.jpg",
        {
          type: "image/jpeg",
        }
      );

      response = await client.images.edit({
        model: MODEL,
        image: file,
        prompt,
        size,
        quality: "medium",
        output_format: "jpeg",
        output_compression: 75,
        n: 1,
      });

    }

    const base64 =
      response?.data?.[0]?.b64_json;

    if (!base64) {
      throw new Error(
        "画像データがOpenAIから返されませんでした。"
      );
    }

    return res.status(200).json({
      success: true,

      image:
        `data:image/jpeg;base64,${base64}`,

      reply:
        "できました。気になるところがあれば、そのまま続けて指示してください。",
    });

  } catch (error) {

    console.error(
      "========== ICONIA API ERROR =========="
    );

    console.error(error);

    console.error(
      "======================================"
    );

    const message =
      error?.error?.message ||
      error?.message ||
      "不明なエラーが発生しました。";

    const code =
      error?.error?.code ||
      error?.code ||
      null;

    const type =
      error?.error?.type ||
      error?.type ||
      null;

    return res.status(
      Number(error?.status) || 500
    ).json({

      success: false,

      error: message,

      code,

      type,

    });

  }
}