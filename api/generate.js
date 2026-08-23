import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const clean = (value, max) =>
  String(value ?? "").trim().slice(0, max);

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

    const character =
      clean(body.character, 80);

    const mood =
      clean(body.mood, 80);

    const color =
      clean(body.color, 40);

    const colorHex =
      clean(body.colorHex, 12);

    const backgroundPreset =
      clean(body.backgroundPreset, 100);

    const background =
      clean(body.background, 1000);

    const extraPrompt =
      clean(body.extraPrompt, 2000);


    const scene =
      background ||
      backgroundPreset ||
      "キャラクターを引き立てる高品質なゲーム背景";


    const prompt = `

Create an ORIGINAL premium square game profile icon
for a competitive mobile game.

IMPORTANT:

This image is the ARTWORK ONLY.

DO NOT render ANY:

- text
- letters
- numbers
- words
- names
- usernames
- alliance names
- clan names
- logos
- UI
- watermark
- title
- typography
- fake symbols

The website will add all text after generation.

Canvas:

1024 x 1024 pixels.

Aspect ratio:

1:1

Character type:

${character || "cool powerful original game character"}

Mood:

${mood || "cool"}

Primary color:

${color || "purple"}

Color:

${colorHex || "#8b5cf6"}

Background / scene:

${scene}


USER'S DETAILED INSTRUCTIONS:

${extraPrompt || "Make the character large, powerful, polished and visually impressive."}


IMPORTANT INSTRUCTION:

Follow the user's detailed instructions carefully.

The user's detailed instructions should control:

- hairstyle
- hair color
- clothing
- armor
- accessories
- facial expression
- pose
- camera angle
- character size
- lighting
- atmosphere
- background
- special effects
- composition


QUALITY:

Create a premium mobile game avatar.

Use:

- highly detailed digital illustration
- cinematic lighting
- strong character silhouette
- dramatic depth
- beautiful atmosphere
- polished professional game artwork
- high-quality materials
- detailed face
- detailed clothing
- attractive composition
- strong contrast
- character should be large and dominant
- keep the head fully inside the image
- keep important details away from the extreme edges


STYLE:

Original high-end game artwork.

Do NOT copy an existing copyrighted character.

Create an original character based on the user's description.

Again:

NO TEXT.

NO LETTERS.

NO NUMBERS.

NO LOGOS.

NO WATERMARK.

NO UI.

`;


    const result =
      await client.images.generate({

        model: "gpt-image-1",

        prompt,

        size: "1024x1024",

        quality: "medium",

        n: 1,

        output_format: "png"

      });


    const image =
      result?.data?.[0]?.b64_json;


    if (!image) {

      throw new Error(
        "画像データが返されませんでした。"
      );

    }


    return res.status(200).json({

      image:
        `data:image/png;base64,${image}`

    });


  } catch (error) {

    console.error(error);


    return res.status(500).json({

      error:
        error?.message ||
        "画像生成に失敗しました。"

    });

  }

}