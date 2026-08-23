export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
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

    /*
     * スタイル
     */
    const styleMap = {
      anime: "high quality Japanese anime game illustration",
      dark: "dark, cool and mysterious game character",
      cyber: "futuristic cyberpunk game character",
      battle: "powerful action battle game character",
      fantasy: "beautiful fantasy game character",
      cute: "cute and stylish game character"
    };

    /*
     * カラー
     */
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

    /*
     * AIへの指示
     */
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

IMPORTANT DESIGN REQUIREMENTS:

- Square 1:1 composition
- Professional mobile game profile icon
- Character should be large and clearly visible
- Character should be the main focus
- High quality detailed illustration
- Beautiful face and detailed eyes
- Strong dramatic lighting
- Premium gaming artwork
- Clean composition
- High contrast
- Beautiful background
- Professional typography if a player name is provided
- No watermark
- No unnecessary text
`;

    /*
     * アップロード画像がある場合
     */
    if (image) {
      finalPrompt += `

IMPORTANT:

Use the uploaded image as the main character reference.

Preserve the recognizable identity of the character,
including:

- face
- hairstyle
- hair color
- clothing
- important accessories
- overall character appearance

Transform the character into a premium game profile icon.

Do not completely replace the character.
Keep the character recognizable.
`;
    }

    /*
     * OpenAI API
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
     * OpenAI側のエラー
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

      console.error(
        "No image returned:",
        JSON.stringify(data)
      );

      return res.status(500).json({
        error:
          "The AI did not return an image."
      });
    }

    /*
     * ブラウザで表示できる形式に変換
     */
    const imageUrl =
      `data:image/png;base64,${base64Image}`;

    /*
     * index.htmlへ画像だけ返す
     */
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