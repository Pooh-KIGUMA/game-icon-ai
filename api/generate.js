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
      dark: "dark, cool and mysterious game character",
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
      styleMap[style] ||
      "high quality game character illustration";

    const selectedColor =
      colorMap[color] ||
      "black";

    let finalPrompt = `
Create a premium professional game profile icon.

USER IDEA:
${prompt}

STYLE:
${selectedStyle}

MAIN COLOR:
${selectedColor}

PLAYER NAME:
${playerName || "None"}

IMPORTANT:
- Square 1:1 composition
- Professional mobile game profile icon
- Character should be large and clearly visible
- Character is the main focus
- High quality detailed illustration
- Detailed face and eyes
- Strong dramatic lighting
- Premium gaming artwork
- Beautiful background
- Clean composition
- High visual impact
- No watermark
`;

    /*
     * 画像アップロードあり
     */
    if (mode === "image" && image) {
      finalPrompt += `

Use the uploaded image as the MAIN CHARACTER REFERENCE.

Preserve the recognizable identity of the character:
- face
- hairstyle
- hair color
- clothing
- accessories
- important character features

Do not replace the character with a completely different person.

Transform the uploaded character into a professional game profile icon.

Keep the character recognizable while improving:
- lighting
- composition
- background
- visual quality
- gaming aesthetic
`;
    }

    /*
     * OpenAI画像生成
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

    const data = await response.json();

    /*
     * APIエラー
     */
    if (!response.ok) {
      console.error(
        "OpenAI API Error:",
        JSON.stringify(data)
      );

      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "OpenAI image generation failed."
      });
    }

    /*
     * Base64画像を取得
     */
    const base64Image =
      data?.data?.[0]?.b64_json;

    if (!base64Image) {
      return res.status(500).json({
        error:
          "The AI did not return an image."
      });
    }

    /*
     * ブラウザ表示用
     */
    const imageUrl =
      `data:image/png;base64,${base64Image}`;

    return res.status(200).json({
      success: true,
      image: imageUrl
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