export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      mode,
      prompt,
      playerName,
      style,
      color,
      image
    } = req.body || {};

    if (!prompt) {
      return res.status(400).json({
        error: "Prompt is required."
      });
    }

    const styleMap = {
      anime: "high quality Japanese anime game illustration",
      dark: "dark and mysterious game character",
      cyber: "futuristic cyberpunk game character",
      battle: "powerful action battle game character",
      fantasy: "beautiful fantasy game character",
      cute: "cute and stylish game character"
    };

    const colorMap = {
      black: "black",
      blue: "blue",
      red: "red",
      purple: "purple",
      gold: "gold",
      white: "white"
    };

    const selectedStyle =
      styleMap[style] || styleMap.anime;

    const selectedColor =
      colorMap[color] || colorMap.black;

    let finalPrompt = `
Create a premium square 1:1 game profile icon.

USER REQUEST:
${prompt}

STYLE:
${selectedStyle}

MAIN COLOR:
${selectedColor}

PLAYER NAME:
${playerName || "None"}

Requirements:
- Square 1:1
- Character is large and clearly visible
- Professional mobile game icon
- High quality detailed illustration
- Dramatic lighting
- Beautiful background
- Strong visual impact
- Premium gaming artwork
- No watermark
`;

    /*
     * ==========================================
     * 画像アップロードあり
     * ==========================================
     */

    if (mode === "image" && image) {

      /*
       * Data URLからMIMEタイプとBase64を取得
       */

      const match =
        image.match(/^data:(.+);base64,(.+)$/);

      if (!match) {
        return res.status(400).json({
          error: "Invalid uploaded image."
        });
      }

      const mimeType = match[1];
      const base64Data = match[2];

      const extension =
        mimeType.includes("png")
          ? "png"
          : mimeType.includes("webp")
          ? "webp"
          : "jpg";

      const imageBuffer =
        Buffer.from(base64Data, "base64");

      /*
       * Fileオブジェクトを作成
       */

      const imageFile = new File(
        [imageBuffer],
        `character.${extension}`,
        {
          type: mimeType
        }
      );

      /*
       * 元キャラクターを維持する指示
       */

      finalPrompt += `

IMPORTANT CHARACTER REFERENCE:

Use the uploaded image as the primary character reference.

Preserve the character's recognizable identity:

- face
- hairstyle
- hair color
- clothing
- accessories
- body proportions
- distinctive features

Do NOT replace the character with a completely different character.

Transform the uploaded character into a professional game profile icon.

Improve:
- lighting
- background
- composition
- detail
- game-art quality

Keep the original character clearly recognizable.

The final image must be square 1:1.
`;

      /*
       * OpenAI Image Edit API
       */

      const formData = new FormData();

      formData.append(
        "model",
        "gpt-image-1"
      );

      formData.append(
        "prompt",
        finalPrompt
      );

      formData.append(
        "size",
        "1024x1024"
      );

      formData.append(
        "quality",
        "auto"
      );

      formData.append(
        "image",
        imageFile
      );

      const response = await fetch(
        "https://api.openai.com/v1/images/edits",
        {
          method: "POST",

          headers: {
            "Authorization":
              `Bearer ${process.env.OPENAI_API_KEY}`
          },

          body: formData
        }
      );

      const data =
        await response.json();

      if (!response.ok) {

        console.error(
          "OpenAI Edit Error:",
          JSON.stringify(data)
        );

        return res.status(response.status).json({
          error:
            data?.error?.message ||
            "Image editing failed."
        });
      }

      const base64Image =
        data?.data?.[0]?.b64_json;

      if (!base64Image) {
        return res.status(500).json({
          error:
            "No edited image was returned."
        });
      }

      return res.status(200).json({
        success: true,
        image:
          `data:image/png;base64,${base64Image}`
      });
    }

    /*
     * ==========================================
     * 画像なし → 新規生成
     * ==========================================
     */

    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${process.env.OPENAI_API_KEY}`
        },

        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: finalPrompt,
          size: "1024x1024",
          quality: "auto",
          n: 1
        })
      }
    );

    const data =
      await response.json();

    if (!response.ok) {

      console.error(
        "OpenAI Generation Error:",
        JSON.stringify(data)
      );

      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "Image generation failed."
      });
    }

    const base64Image =
      data?.data?.[0]?.b64_json;

    if (!base64Image) {
      return res.status(500).json({
        error:
          "No image was returned."
      });
    }

    return res.status(200).json({
      success: true,
      image:
        `data:image/png;base64,${base64Image}`
    });

  } catch (error) {

    console.error(
      "Server Error:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Server error occurred."
    });
  }
}