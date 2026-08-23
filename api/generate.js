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
      fidelity,
      image
    } = req.body || {};

    // =========================
    // 基本チェック
    // =========================

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        error: "Prompt is required."
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is not configured."
      });
    }

    // =========================
    // スタイル
    // =========================

    const styleMap = {
      anime:
        "high quality Japanese anime game illustration",

      dark:
        "dark, cool, mysterious and dramatic game character",

      cyber:
        "futuristic cyberpunk game character with advanced technology",

      battle:
        "powerful action battle game character with dynamic energy",

      fantasy:
        "beautiful fantasy game character with magical atmosphere",

      cute:
        "cute, stylish and charming game character"
    };

    const selectedStyle =
      styleMap[style] ||
      styleMap.anime;

    // =========================
    // カラー
    // =========================

    const colorMap = {
      black: "black",

      blue:
        "blue",

      red:
        "red",

      purple:
        "purple",

      gold:
        "gold",

      white:
        "white"
    };

    const selectedColor =
      colorMap[color] ||
      colorMap.black;

    // =========================
    // 忠実度
    // =========================

    const fidelityMap = {

      standard: `
Use the uploaded image as a character reference.

Keep the character recognizable,
but allow creative AI interpretation.

Preserve the general:
- face
- hairstyle
- hair color
- clothing
- character appearance

The AI may creatively improve the design,
lighting and composition.
`,

      high: `
HIGH CHARACTER FIDELITY IS REQUIRED.

The uploaded image is the primary character reference.

Preserve the character's recognizable identity.

Carefully preserve:

- facial structure
- eyes
- nose
- mouth
- face shape
- hairstyle
- hair length
- hair color
- eyebrows
- skin tone
- clothing
- clothing colors
- accessories
- body proportions
- distinctive character details

Do not unnecessarily redesign the character.

The final character should clearly look like
the same character from the uploaded image.

Only modify elements requested by the user,
such as:

- background
- lighting
- atmosphere
- visual effects
- pose
- composition
`,

      maximum: `
MAXIMUM CHARACTER FIDELITY.

The uploaded image is the PRIMARY SOURCE OF TRUTH.

Preserve the character as accurately as possible.

Do NOT turn the character into a different person.

Do NOT unnecessarily change:

- face
- facial structure
- eyes
- nose
- mouth
- hairstyle
- hair length
- hair color
- eyebrows
- skin tone
- clothing
- clothing colors
- accessories
- body proportions
- distinctive marks
- recognizable features

The character must remain clearly recognizable
as the same character shown in the uploaded image.

Only change what the user explicitly requests.

The requested visual style, background,
lighting and effects should be applied
WITHOUT sacrificing character identity.

Character fidelity has higher priority
than creative reinterpretation.
`
    };

    const selectedFidelity =
      fidelityMap[fidelity] ||
      fidelityMap.high;

    // =========================
    // 共通プロンプト
    // =========================

    let finalPrompt = `
Create a premium professional mobile game profile icon.

USER REQUEST:
${prompt}

VISUAL STYLE:
${selectedStyle}

MAIN COLOR:
${selectedColor}

PLAYER NAME:
${playerName || "None"}

GENERAL REQUIREMENTS:

- Square 1:1 composition
- Premium mobile game artwork
- Character should be large and clearly visible
- Character should be the main focus
- Detailed face
- Detailed eyes
- High quality illustration
- Strong dramatic lighting
- Beautiful background
- Clean professional composition
- High visual impact
- Game profile icon aesthetic
- No watermark
- No unnecessary text
`;

    // =========================
    // 画像アップロード
    // =========================

    if (mode === "image" && image) {

      const match =
        image.match(
          /^data:(.+);base64,(.+)$/
        );

      if (!match) {
        return res.status(400).json({
          error:
            "Invalid uploaded image format."
        });
      }

      const mimeType =
        match[1];

      const base64Data =
        match[2];

      let extension = "jpg";

      if (mimeType.includes("png")) {
        extension = "png";
      }

      if (mimeType.includes("webp")) {
        extension = "webp";
      }

      const imageBuffer =
        Buffer.from(
          base64Data,
          "base64"
        );

      const imageFile =
        new File(
          [imageBuffer],
          `character.${extension}`,
          {
            type: mimeType
          }
        );

      // =========================
      // 忠実度指示
      // =========================

      finalPrompt += `

CHARACTER REFERENCE:

Use the uploaded image as the primary
reference for the character.

${selectedFidelity}

The uploaded character should remain
clearly recognizable.

Create a polished professional
game profile icon from the reference image.

Improve:

- lighting
- background
- composition
- visual quality
- atmosphere
- game artwork quality

while maintaining the character identity.
`;

      // =========================
      // OpenAI Image Edit
      // =========================

      const formData =
        new FormData();

      formData.append(
        "model",
        "gpt-image-1"
      );

      formData.append(
        "image",
        imageFile
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

      const response =
        await fetch(
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

      // =========================
      // APIエラー
      // =========================

      if (!response.ok) {

        console.error(
          "OpenAI Image Edit Error:",
          JSON.stringify(data)
        );

        return res.status(
          response.status
        ).json({
          error:
            data?.error?.message ||
            "Image editing failed."
        });
      }

      // =========================
      // 画像取得
      // =========================

      const base64Image =
        data?.data?.[0]?.b64_json;

      if (!base64Image) {

        console.error(
          "No image returned:",
          JSON.stringify(data)
        );

        return res.status(500).json({
          error:
            "The AI did not return an edited image."
        });
      }

      const imageUrl =
        `data:image/png;base64,${base64Image}`;

      return res.status(200).json({
        success: true,
        image: imageUrl,
        mode: "image",
        fidelity:
          fidelity || "high"
      });
    }

    // =========================
    // 画像なし
    // 新規AI画像生成
    // =========================

    const response =
      await fetch(
        "https://api.openai.com/v1/images/generations",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Authorization":
              `Bearer ${process.env.OPENAI_API_KEY}`
          },

          body: JSON.stringify({

            model:
              "gpt-image-1",

            prompt:
              finalPrompt,

            size:
              "1024x1024",

            quality:
              "auto",

            n:
              1

          })
        }
      );

    const data =
      await response.json();

    // =========================
    // APIエラー
    // =========================

    if (!response.ok) {

      console.error(
        "OpenAI Image Generation Error:",
        JSON.stringify(data)
      );

      return res.status(
        response.status
      ).json({
        error:
          data?.error?.message ||
          "Image generation failed."
      });
    }

    // =========================
    // 画像取得
    // =========================

    const base64Image =
      data?.data?.[0]?.b64_json;

    if (!base64Image) {

      console.error(
        "No generated image:",
        JSON.stringify(data)
      );

      return res.status(500).json({
        error:
          "The AI did not return an image."
      });
    }

    const imageUrl =
      `data:image/png;base64,${base64Image}`;

    return res.status(200).json({
      success: true,
      image: imageUrl,
      mode: "idea"
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