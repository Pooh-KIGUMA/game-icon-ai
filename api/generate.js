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
    throw new Error(
      "画像データの形式が正しくありません。"
    );
  }

  return Buffer.from(
    match[1],
    "base64"
  );
}

function buildPrompt(
  message,
  history,
  hasImage
) {

  const previous =
    Array.isArray(history)
      ? history
          .slice(-8)
          .map(item => {

            const role =
              item.role === "user"
                ? "USER"
                : "ASSISTANT";

            return (
              role +
              ": " +
              clean(
                item.text,
                1500
              )
            );

          })
          .join("\n")
      : "";

  return `

You are the image generation and editing engine for Iconia AI.

The user interacts with you naturally, like a conversational AI image assistant.

Your job is to turn the user's request directly into a high-quality image.

IMPORTANT RULES:

1. Follow the latest user instruction precisely.

2. Use the previous conversation to understand references such as:
   - this character
   - this image
   - the previous image
   - make it bigger
   - change only the background
   - keep the face
   - use the same character
   - make it more cool
   - make it brighter
   - change the pose

3. NEVER invent player names.

4. NEVER invent alliance names.

5. NEVER invent clan names.

6. NEVER add watermarks.

7. NEVER add signatures.

8. NEVER add logos unless the user specifically asks for them.

9. NEVER add:
   Pooh
   AxLF
   Player name
   Game Icon AI
   Iconia AI
   SAMPLE
   watermark

   unless explicitly requested by the user.

10. If the user asks for text, reproduce the requested text as accurately as possible.

11. If the user asks for only text to be added to an image, preserve the original image.

12. If the user asks for only a background change, preserve the subject.

13. If the user asks to preserve the original image, preserve:
    - face
    - hairstyle
    - clothing
    - body
    - identity
    - composition

    as much as possible.

14. If the user says:
    "原画をほぼそのまま"
    prioritize preservation over redesign.

15. If the user supplies an image, treat it as the primary visual reference.

16. Do not redesign the supplied image unless the user asks you to.

17. If no image is supplied, create an original character or scene according to the request.

18. The user does NOT need to choose complicated settings.

19. Natural language is the primary control.

20. Make the final result polished and suitable for:
    - game icons
    - X profile images
    - Instagram profile images
    - LINE profile images
    - SNS headers
    - banners
    - thumbnails
    - other social media graphics

21. When the user specifies an aspect ratio or platform, compose accordingly.

22. If the user does not specify an aspect ratio, use a square 1:1 composition suitable for an icon.

23. Do not add text simply because the image is intended for a game icon.

24. Do not add decorative elements that the user did not request when preserving an original image.

25. Prioritize the user's latest request over old preferences.

PREVIOUS CONVERSATION:

${previous || "(none)"}

LATEST USER REQUEST:

${message || "(image editing request)"}

IMAGE SUPPLIED:

${
  hasImage
    ? "YES. The supplied image is the primary reference and should be edited according to the user's request."
    : "NO. Create a new original image."
}

Create the final image according to the request.

Do not explain the process.
Do not invent missing names.
Do not add sample text.
Do not add watermarks.

`;

}


export default async function handler(
  req,
  res
) {

  if (
    req.method !== "POST"
  ) {

    return res
      .status(405)
      .json({
        error:
          "POST only"
      });

  }


  if (
    !process.env.OPENAI_API_KEY
  ) {

    return res
      .status(500)
      .json({

        error:
          "OPENAI_API_KEY が設定されていません。"

      });

  }


  try {

    const body =
      req.body || {};

    const message =
      clean(
        body.message,
        7000
      );

    const image =
      body.image || null;

    const history =
      Array.isArray(
        body.history
      )
        ? body.history
        : [];


    if (
      !message &&
      !image
    ) {

      return res
        .status(400)
        .json({

          error:
            "画像または指示を入力してください。"

        });

    }


    const prompt =
      buildPrompt(
        message,
        history,
        Boolean(image)
      );


    let result;


    /*
     * ========================
     * IMAGE EDIT
     * ========================
     */

    if (image) {

      const buffer =
        decodeDataUrl(
          image
        );


      const file =
        await toFile(
          buffer,
          "reference.jpg",
          {
            type:
              "image/jpeg"
          }
        );


      result =
        await client.images.edit({

          model:
            IMAGE_MODEL,

          image:
            file,

          prompt,

          size:
            "1024x1024",

          quality:
            "medium",

          output_format:
            "jpeg",

          output_compression:
            60,

          n:
            1

        });

    }


    /*
     * ========================
     * NEW IMAGE
     * ========================
     */

    else {

      result =
        await client.images.generate({

          model:
            IMAGE_MODEL,

          prompt,

          size:
            "1024x1024",

          quality:
            "medium",

          output_format:
            "jpeg",

          output_compression:
            60,

          n:
            1

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
      "data:image/jpeg;base64," +
      base64;


    /*
     * 大きすぎるレスポンスを
     * ブラウザに返さない
     */

    const sizeMB =
      Buffer.byteLength(
        imageData,
        "utf8"
      ) /
      1024 /
      1024;


    console.log(
      "Image response:",
      sizeMB.toFixed(2),
      "MB"
    );


    if (
      sizeMB > 4
    ) {

      throw new Error(
        "生成画像のサイズが大きすぎました。もう一度生成してください。"
      );

    }


    return res
      .status(200)
      .json({

        success:
          true,

        image:
          imageData,

        reply:
          "できました。気になるところがあれば、そのまま続けて指示してください。"

      });


  } catch (error) {

    console.error(
      "ICONIA ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        error:
          error?.message ||
          "画像生成中にエラーが発生しました。"

      });

  }

}