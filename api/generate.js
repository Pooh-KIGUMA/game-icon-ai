import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const clean = (value, maxLength) =>
  String(value ?? "")
    .trim()
    .slice(0, maxLength);


function dataUrlToBuffer(dataUrl) {

  const match = String(dataUrl).match(
    /^data:([^;]+);base64,(.+)$/
  );

  if (!match) {
    throw new Error("画像データの形式が正しくありません。");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };

}


function extensionFromMime(mimeType) {

  if (mimeType === "image/png") {
    return "png";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "jpg";

}


function buildPrompt(body) {

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
    clean(body.extraPrompt, 3000);


  const backgroundText =
    background ||
    backgroundPreset ||
    "キャラクターを引き立てる美しいゲーム背景";


  return `

Create an original premium mobile game profile icon.

IMPORTANT:
The website will add all text AFTER image generation.

DO NOT create:

- player names
- usernames
- alliance names
- clan names
- team names
- letters
- numbers
- words
- logos
- watermarks
- UI elements
- captions
- typography
- fake signatures

The artwork itself must contain ZERO readable text.

Canvas:
1024 x 1024 pixels.

Aspect ratio:
1:1.


CHARACTER:

${character || "original powerful game character"}


MOOD:

${mood || "cool and cinematic"}


PRIMARY COLOR:

${color || "purple"}

COLOR HEX:
${colorHex || "#8b5cf6"}


BACKGROUND:

${backgroundText}


DETAILED USER INSTRUCTIONS:

${extraPrompt || "Create a powerful, attractive and highly detailed game character."}


FOLLOW THE USER'S DETAILED INSTRUCTIONS.

Pay particular attention to:

- hairstyle
- hair color
- eyes
- facial expression
- clothing
- armor
- accessories
- weapons
- pose
- body position
- camera angle
- character size
- lighting
- background
- atmosphere
- special effects
- composition
- color balance


CHARACTER SIZE:

The main character should be large and visually dominant.

The face should be clearly visible.

Do not make the character too small.

Keep important parts of the character inside the frame.


QUALITY:

Premium high-end mobile game artwork.

Highly detailed digital illustration.

Cinematic lighting.

Strong silhouette.

Professional game-avatar composition.

Detailed face.

Detailed clothing.

Beautiful materials.

Strong depth.

High visual impact.

Original character design.

Do not copy an existing copyrighted character.


ABSOLUTELY NO TEXT:

No names.
No letters.
No numbers.
No logos.
No watermark.
No UI.
No typography.

The website will add the player's text later.

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

    const mode =
      clean(body.mode, 20) || "create";


    /*
     * =====================================================
     * 新規生成
     * =====================================================
     */

    if (
      mode !== "edit" ||
      !body.imageBase64
    ) {

      const prompt =
        buildPrompt(body);


      const result =
        await openai.images.generate({

          model: "gpt-image-1",

          prompt,

          size: "1024x1024",

          quality: "medium",

          n: 1

        });


      const image =
        result?.data?.[0]?.b64_json;


      if (!image) {

        throw new Error(
          "AIから画像データが返されませんでした。"
        );

      }


      return res.status(200).json({

        image:
          `data:image/png;base64,${image}`

      });

    }


    /*
     * =====================================================
     * アップロード画像を編集
     * =====================================================
     */

    const imageData =
      dataUrlToBuffer(
        body.imageBase64
      );


    const extension =
      extensionFromMime(
        imageData.mimeType
      );


    const prompt = `

EDIT THE PROVIDED IMAGE.

Use the uploaded image as the primary visual reference.

Preserve the identity and important visual characteristics
of the original character unless the user explicitly asks
to change them.

The user wants an original premium mobile game icon.

IMPORTANT:

DO NOT add any text to the image.

DO NOT add:

- player names
- usernames
- alliance names
- clan names
- team names
- letters
- numbers
- logos
- watermarks
- UI
- captions
- typography

The website will add all names AFTER generation.

USER'S CHARACTER TYPE:

${clean(body.character,80)}


USER'S MOOD:

${clean(body.mood,80)}


USER'S PRIMARY COLOR:

${clean(body.color,40)}

${clean(body.colorHex,12)}


USER'S BACKGROUND REQUEST:

${clean(body.backgroundPreset,100)}

${clean(body.background,1000)}


DETAILED EDITING INSTRUCTIONS:

${clean(body.extraPrompt,3000) ||
"Improve the image into a premium high-quality mobile game icon while preserving the character."}


IMPORTANT:

Follow the detailed editing instructions carefully.

If the user asks to change only one element,
keep everything else as close to the original as possible.

Examples:

If they ask to change the background,
do not unnecessarily change the face.

If they ask to change clothing,
keep the character identity and pose.

If they ask to change hair,
keep the rest of the character consistent.

If they ask to make the character larger,
increase the character's visual dominance while keeping
the composition natural.


QUALITY:

Premium mobile game artwork.

Highly detailed.

Cinematic lighting.

Professional character design.

Strong depth.

Beautiful materials.

Clean composition.

High-quality face rendering.

The final result must remain a square 1:1 game icon.


ABSOLUTELY NO TEXT.

NO LETTERS.

NO NUMBERS.

NO LOGOS.

NO WATERMARK.

NO UI.

`;


    const file =
      await OpenAI.toFile(
        imageData.buffer,
        `reference.${extension}`,
        {
          type:
            imageData.mimeType
        }
      );


    const result =
      await openai.images.edit({

        model: "gpt-image-1",

        image: file,

        prompt,

        size: "1024x1024",

        quality: "medium",

        n: 1

      });


    const image =
      result?.data?.[0]?.b64_json;


    if (!image) {

      throw new Error(
        "AI編集後の画像データが返されませんでした。"
      );

    }


    return res.status(200).json({

      image:
        `data:image/png;base64,${image}`

    });


  } catch (error) {

    console.error(
      "IMAGE GENERATION ERROR:",
      error
    );


    let message =
      error?.message ||
      "画像生成に失敗しました。";


    if (
      String(message)
        .toLowerCase()
        .includes("payload")
    ) {

      message =
        "画像データが大きすぎます。別の画像を試してください。";

    }


    return res.status(500).json({

      error: message

    });

  }

}