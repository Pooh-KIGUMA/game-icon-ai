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
      image,

      // 追加：生成後の画像編集
      editMode,
      editPrompt,
      editImage
    } = req.body || {};

    // ==========================================
    // API KEY CHECK
    // ==========================================

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is not configured."
      });
    }

    // ==========================================
    // AI微調整
    // ==========================================

    if (editMode === true) {

      if (!editPrompt || !editPrompt.trim()) {
        return res.status(400).json({
          error: "Please enter an editing instruction."
        });
      }

      if (!editImage) {
        return res.status(400).json({
          error: "No image was provided for editing."
        });
      }

      // ------------------------------------------
      // Base64画像をFileへ変換
      // ------------------------------------------

      const match = editImage.match(
        /^data:(.+);base64,(.+)$/
      );

      if (!match) {
        return res.status(400).json({
          error: "Invalid image format."
        });
      }

      const mimeType = match[1];
      const base64Data = match[2];

      let extension = "png";

      if (mimeType.includes("jpeg")) {
        extension = "jpg";
      }

      if (mimeType.includes("webp")) {
        extension = "webp";
      }

      const imageBuffer = Buffer.from(
        base64Data,
        "base64"
      );

      const imageFile = new File(
        [imageBuffer],
        `game-icon.${extension}`,
        {
          type: mimeType
        }
      );

      // ------------------------------------------
      // AI編集プロンプト
      // ------------------------------------------

      const editInstructions = `
Edit the uploaded game profile icon.

USER EDIT REQUEST:
${editPrompt}

IMPORTANT:

Use the uploaded image as the primary reference.

Only change what the user requested.

Preserve all other parts of the image.

If the user says "keep the face",
do not change the face.

If the user says "keep the character",
preserve the character identity.

If the user says "change only the background",
do not modify the character.

If the user says "change only the text",
do not modify the character or background.

Maintain the original square 1:1 composition.

Maintain high quality professional game artwork.

Do not add unnecessary objects.

Do not change unrelated elements.

Do not add watermarks.
`;

      // ------------------------------------------
      // OpenAI Image Edit
      // ------------------------------------------

      const formData = new FormData();

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
        editInstructions
      );

      formData.append(
        "size",
        "1024x1024"
      );

      formData.append(
        "quality",
        "auto"
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

      const data = await response.json();

      // ------------------------------------------
      // API ERROR
      // ------------------------------------------

      if (!response.ok) {

        console.error(
          "OpenAI Edit Error:",
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

      // ------------------------------------------
      // GET IMAGE
      // ------------------------------------------

      const base64Image =
        data?.data?.[0]?.b64_json;

      if (!base64Image) {
        return res.status(500).json({
          error:
            "The AI did not return an edited image."
        });
      }

      return res.status(200).json({
        success: true,

        image:
          `data:image/png;base64,${base64Image}`,

        mode: "edit"
      });
    }

    // ==========================================
    // 通常の画像生成
    // ==========================================

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        error: "Prompt is required."
      });
    }

    // ==========================================
    // STYLE
    // ==========================================

    const styleMap = {

      anime:
        "high quality Japanese anime game illustration",

      dark:
        "dark, cool, mysterious and dramatic game character",

      cyber:
        "futuristic cyberpunk game character",

      battle:
        "powerful action battle game character",

      fantasy:
        "beautiful fantasy game character",

      cute:
        "cute, stylish and charming game character"

    };

    const selectedStyle =
      styleMap[style] ||
      styleMap.anime;

    // ==========================================
    // COLOR
    // ==========================================

    const colorMap = {

      black: "black",

      blue: "blue",

      red: "red",

      purple: "purple",

      gold: "gold",

      white: "white"

    };

    const selectedColor =
      colorMap[color] ||
      colorMap.black;

    // ==========================================
    // FIDELITY
    // ==========================================

    const fidelityMap = {

      standard: `
Use the uploaded image as a character reference.
Keep the character recognizable.
Allow creative AI interpretation.
`,

      high: `
HIGH CHARACTER FIDELITY.

Preserve:

- face
- eyes
- facial structure
- hairstyle
- hair color
- clothing
- accessories
- body proportions
- distinctive features

Keep the character clearly recognizable.
`,

      maximum: `
MAXIMUM CHARACTER FIDELITY.

The uploaded image is the primary source of truth.

Do NOT unnecessarily change:

- face
- eyes
- facial structure
- hairstyle
- hair length
- hair color
- skin tone
- clothing
- accessories
- body proportions
- distinctive features

The final character must remain clearly recognizable
as the same character.

Only change elements explicitly requested.
`

    };

    const selectedFidelity =
      fidelityMap[fidelity] ||
      fidelityMap.high;

    // ==========================================
    // COMMON PROMPT
    // ==========================================

    let finalPrompt = `

Create a premium professional mobile game profile icon.

USER REQUEST:
${prompt}

STYLE:
${selectedStyle}

MAIN COLOR:
${selectedColor}

PLAYER NAME:
${playerName || "None"}

REQUIREMENTS:

- Square 1:1 composition
- Premium mobile game artwork
- Character should be large
- Character is the main focus
- Detailed face
- Detailed eyes
- Strong dramatic lighting
- Beautiful background
- High quality illustration
- Professional gaming aesthetic
- No watermark
- No unnecessary text
`;

    // ==========================================
    // IMAGE UPLOAD
    // ==========================================

    if (mode === "image" && image) {

      const match = image.match(
        /^data:(.+);base64,(.+)$/
      );

      if (!match) {
        return res.status(400).json({
          error:
            "Invalid uploaded image format."
        });
      }

      const mimeType = match[1];
      const base64Data = match[2];

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

      finalPrompt += `

CHARACTER REFERENCE:

Use the uploaded image as the primary
character reference.

${selectedFidelity}

Transform the character into a premium
professional game profile icon.

Improve:

- lighting
- background
- composition
- visual quality
- atmosphere
- game artwork quality

while preserving the character identity.
`;

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

      const base64Image =
        data?.data?.[0]?.b64_json;

      if (!base64Image) {
        return res.status(500).json({
          error:
            "The AI did not return an edited image."
        });
      }

      return res.status(200).json({
        success: true,

        image:
          `data:image/png;base64,${base64Image}`,

        mode: "image",

        fidelity:
          fidelity || "high"
      });
    }

    // ==========================================
    // TEXT → IMAGE
    // ==========================================

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

    if (!response.ok) {

      console.error(
        "OpenAI Generation Error:",
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

    const base64Image =
      data?.data?.[0]?.b64_json;

    if (!base64Image) {
      return res.status(500).json({
        error:
          "The AI did not return an image."
      });
    }

    return res.status(200).json({

      success: true,

      image:
        `data:image/png;base64,${base64Image}`,

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