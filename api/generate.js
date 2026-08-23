import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function clean(value, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST only"
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY が設定されていません。"
    });
  }

  try {
    const body = req.body || {};

    const playerName = clean(body.playerName, 24);
    const allianceName = clean(body.allianceName, 24);
    const clanName = clean(body.clanName, 24);
    const color = clean(body.color, 30);
    const colorHex = clean(body.colorHex, 12);
    const character = clean(body.character, 60);
    const mood = clean(body.mood, 40);
    const background = clean(body.background, 50);
    const textPosition = clean(body.textPosition, 40);
    const extraPrompt = clean(body.extraPrompt, 300);

    if (!playerName && !allianceName && !clanName) {
      return res.status(400).json({
        error:
          "名前・同盟名・クラン名のいずれかを入力してください。"
      });
    }

    const textLines = [
      playerName
        ? `Player name: ${playerName}`
        : "",
      allianceName
        ? `Alliance name: ${allianceName}`
        : "",
      clanName
        ? `Clan/team name: ${clanName}`
        : ""
    ]
      .filter(Boolean)
      .join(", ");

    const prompt = `
Create a premium original square game profile icon for a competitive mobile game.

Canvas:
1:1 square composition.

Character:
${character || "cool heroic character"}

Mood:
${mood || "ultra cool"}

Background:
${background || "neon fantasy"}

Primary color:
${color || "purple"}
${colorHex || "#8b5cf6"}

Make the character large and clearly visible.

Use:
- high detail
- professional game avatar quality
- polished digital illustration
- strong lighting
- dynamic depth
- crisp silhouette
- beautiful background effects

No watermark.
No logos.
No UI.

Typography requirement:

Place the requested text at:
${textPosition || "bottom center"}

Requested text:
${textLines || "GAME ICON"}

Preserve spelling and capitalization exactly.

Do not invent additional names.

Keep text away from the face and important character details.

Additional direction:
${extraPrompt || "Make the design unique, premium, stylish and suitable for a competitive game player avatar."}
`;

    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      quality: "medium",
      n: 1,
      output_format: "png"
    });

    const b64 = result?.data?.[0]?.b64_json;

    if (!b64) {
      throw new Error(
        "画像データが返されませんでした。"
      );
    }

    return res.status(200).json({
      image: `data:image/png;base64,${b64}`
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        error?.message ||
        "画像生成中にエラーが発生しました。"
    });
  }
}