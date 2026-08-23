import OpenAI, { toFile } from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const IMAGE_MODEL = "gpt-image-2";

function clean(value, max = 7000) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(
    /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/
  );

  if (!match) {
    throw new Error("画像データの形式が正しくありません。");
  }

  return Buffer.from(match[1], "base64");
}

function buildPrompt(message, history, hasImage) {

  const previous = Array.isArray(history)
    ? history
        .slice(-8)
        .map(item => {
          const role =
            item.role === "user"
              ? "USER"
              : "ASSISTANT";

          return `${role}: ${clean(item.text, 1200)}`;
        })
        .join("\n")
    : "";

  return `
You are the image creation engine for Iconia AI.

The user wants to create or edit an image through a natural conversation.

IMPORTANT:
- Follow the user's latest instruction.
- Use previous conversation only when it helps understand references such as "this", "that", "the previous image", "make it bigger", "change only the background", etc.
- Do NOT invent names.
- Do NOT add player names, alliance names, clan names, logos, watermarks, signatures or UI unless the user explicitly requests them.
- Never automatically add "Pooh", "AxLF", "GAME ICON", "Player name", or any other sample text.
- If the user requests text, preserve spelling, capitalization, symbols and numbers as accurately as possible.
- If the user says to keep the original image/person/face/clothes/etc., preserve those parts as much as possible.
- If the user says "原画をほぼそのまま", preserve the composition and identity of the source image and make only the requested changes.
- If the user asks for only a background change, do not redesign the character.
- If the user asks for only text, do not redesign the image.
- If the user asks for a new original character and no image is supplied, create an original character.
- If the user asks for an SNS icon/header, optimize composition for the requested platform.
- Do not ask the user to fill out complicated settings.
- The user's natural-language instruction is the primary control.

Previous conversation:
${previous || "(none)"}

Latest user instruction:
${message}

Image supplied:
${hasImage ? "YES - edit the supplied image according to the instruction." : "NO - create a new image."}

Create a detailed image-generation/editing instruction from the user's request.

The result should be visually polished, professional and suitable for a high-quality AI image service.

Do not add anything the user did not request.
`;
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST only"
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error:
        "OPENAI_API_KEY がVercelに設定されていません。"
    });
  }

  try {

    const body = req.body || {};

    const message = clean(
      body.message,
      7000
    );

    const image =
      body.image || null;

    const history =
      Array.isArray(body.history)
        ? body.history
        : [];

    if (!message && !image) {
      return res.status(400).json({
        error:
          "画像または指示を送ってください。"
      });
    }

    const prompt = buildPrompt(
      message,
      history,
      Boolean(image)
    );

    let result;

    /*
     * 画像編集
     */

    if (image) {

      const buffer =
        decodeDataUrl(image);

      const file =
        await toFile(
          buffer,
          "reference.png",
          {
            type: "image/png"
          }
        );

      result =
        await client.images.edit({

          model: IMAGE_MODEL,

          image: file,

          prompt,

          size: "1024x1024",

          quality: "medium",

          output_format: "jpeg",

          output_compression: 55,

          n: 1

        });

    }

    /*
     * 新規画像
     */

    else {

      result =
        await client.images.generate({

          model: IMAGE_MODEL,

          prompt,

          size: "1024x1024",

          quality: "medium",

          output_format: "jpeg",

          output_compression: 55,

          n: 1

        });

    }

    const base64 =
      result?.data?.[0]?.b64_json;

    if (!base64) {

      throw new Error(
        "画像データが返されませんでした。"
      );

    }

    const imageData =
      `data:image/jpeg;base64,${base64}`;

    /*
     * 念のためレスポンスサイズを確認
     */

    const responseSize =
      Buffer.byteLength(
        imageData,
        "utf8"
      );

    console.log(
      "IMAGE RESPONSE:",
      Math.round(
        responseSize / 1024 / 1024 * 100
      ) / 100,
      "MB"
    );

    if (
      responseSize >
      4 * 1024 * 1024
    ) {

      return res.status(413).json({

        error:
          "画像サイズが大きすぎました。もう一度生成してください。"

      });

    }

    return res.status(200).json({

      success: true,

      image:
        imageData,

      reply:
        "できました。気になるところがあれば、そのまま続けて指示してください。"

    });

  } catch (error) {

    console.error(
      "ICONIA GENERATION ERROR:",
      error
    );

    return res.status(500).json({

      error:
        error?.message ||
        "画像生成中にエラーが発生しました。"

    });

  }
}