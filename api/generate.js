import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


function clean(value, max = 3000){

  return String(value ?? "")
    .trim()
    .slice(0,max);

}


function dataUrlToBuffer(dataUrl){

  const match =
    String(dataUrl).match(
      /^data:(image\/[^;]+);base64,(.+)$/
    );

  if(!match){

    throw new Error(
      "画像データを読み込めませんでした。"
    );

  }

  return {

    mimeType:match[1],

    buffer:
      Buffer.from(
        match[2],
        "base64"
      )

  };

}


function getExtension(mime){

  if(mime === "image/png"){
    return "png";
  }

  if(mime === "image/webp"){
    return "webp";
  }

  return "jpg";

}


function fidelityToAPI(value){

  const n =
    Number(value || 80);

  /*
   * OpenAI側の入力画像忠実度は
   * high / low で指定。
   *
   * UIでは5段階にして、
   * 80%以上をhigh、
   * それ以下をlowとして扱う。
   */

  return n >= 80
    ? "high"
    : "low";

}


function buildCreatePrompt(body){

  const character =
    clean(body.character,100);

  const mood =
    clean(body.mood,100);

  const color =
    clean(body.color,50);

  const colorHex =
    clean(body.colorHex,20);

  const backgroundPreset =
    clean(
      body.backgroundPreset,
      200
    );

  const background =
    clean(
      body.background,
      1500
    );

  const extra =
    clean(
      body.extraPrompt,
      4000
    );


  let prompt = `

Create a premium original mobile game profile icon.

Canvas:
Square 1:1 composition.

IMPORTANT:
The website will add all text after image generation.

NEVER generate any text inside the artwork.

NO:
- player names
- usernames
- alliance names
- clan names
- team names
- letters
- numbers
- logos
- watermarks
- captions
- UI
- typography

The artwork itself must contain ZERO readable text.

`;

  if(character){

    prompt += `

CHARACTER TYPE:
${character}

`;

  }


  if(mood){

    prompt += `

MOOD:
${mood}

`;

  }


  if(color){

    prompt += `

PRIMARY COLOR:
${color}

COLOR HEX:
${colorHex}

`;

  }


  if(backgroundPreset){

    prompt += `

BACKGROUND STYLE:
${backgroundPreset}

`;

  }


  if(background){

    prompt += `

CUSTOM BACKGROUND INSTRUCTIONS:
${background}

`;

  }


  if(extra){

    prompt += `

USER'S DETAILED INSTRUCTIONS:
${extra}

`;

  }


  prompt += `

Create an original character.

Make the character large and visually dominant.

Make the face clearly visible.

Use professional premium mobile-game artwork.

Strong composition.

Beautiful lighting.

High detail.

Cinematic depth.

Detailed clothing and materials.

Strong silhouette.

High visual impact.

Do not copy a specific copyrighted character.

ABSOLUTELY NO TEXT.

`;

  return prompt;

}


function buildEditPrompt(body){

  const fidelity =
    Number(
      body.fidelity || 80
    );

  const character =
    clean(body.character,100);

  const mood =
    clean(body.mood,100);

  const color =
    clean(body.color,50);

  const colorHex =
    clean(body.colorHex,20);

  const backgroundPreset =
    clean(
      body.backgroundPreset,
      200
    );

  const background =
    clean(
      body.background,
      1500
    );

  const extra =
    clean(
      body.extraPrompt,
      4000
    );


  let prompt = `

EDIT THE PROVIDED ORIGINAL IMAGE.

The uploaded image is the primary source.

PRESERVE THE ORIGINAL IMAGE ACCORDING TO THE
USER'S SELECTED FIDELITY:

${fidelity}% original preservation.

`;

  if(fidelity >= 100){

    prompt += `

Preserve the original image almost exactly.

Do not redesign the character.

Only make explicitly requested changes.

`;

  }else if(fidelity >= 80){

    prompt += `

Strongly preserve the original character identity,
face, hair, clothing and overall composition.

Only make requested changes.

`;

  }else if(fidelity >= 60){

    prompt += `

Maintain the original character and important features,
while allowing moderate artistic changes.

`;

  }else if(fidelity >= 40){

    prompt += `

Use the original image as a strong visual reference,
but allow significant artistic improvements.

`;

  }else{

    prompt += `

Use the original image mainly as inspiration.
Major artistic changes are allowed.

`;

  }


  prompt += `

VERY IMPORTANT:

If the user asks to change only the background,
do NOT unnecessarily change the character.

If the user asks to change only the pose,
preserve the face, hair and clothing as much as possible.

If the user asks to change clothing,
preserve the character identity.

If the user asks to improve lighting,
do not redesign the character.

Follow the user's instructions precisely.

`;


  if(character){

    prompt += `

CHARACTER TYPE:
${character}

`;

  }


  if(mood){

    prompt += `

MOOD:
${mood}

`;

  }


  if(color){

    prompt += `

PRIMARY COLOR:
${color}

COLOR HEX:
${colorHex}

`;

  }


  if(backgroundPreset){

    prompt += `

BACKGROUND:
${backgroundPreset}

`;

  }


  if(background){

    prompt += `

CUSTOM BACKGROUND:
${background}

`;

  }


  if(extra){

    prompt += `

USER'S DETAILED INSTRUCTIONS:
${extra}

`;

  }


  prompt += `

Make the result suitable for a premium 1:1 mobile game icon.

Improve composition, lighting and visual quality
only where appropriate.

DO NOT ADD TEXT.

DO NOT ADD:

- player names
- usernames
- alliance names
- clan names
- team names
- letters
- numbers
- logos
- watermarks
- captions
- UI
- typography

The website will add text separately.

The final image must contain ZERO readable text.

`;

  return prompt;

}


export default async function handler(req,res){

  if(req.method !== "POST"){

    return res.status(405).json({
      error:"POST only"
    });

  }


  if(!process.env.OPENAI_API_KEY){

    return res.status(500).json({

      error:
        "OPENAI_API_KEY が設定されていません。"

    });

  }


  try{

    const body =
      req.body || {};

    const mode =
      clean(body.mode,20);


    /*
     * =========================================
     * 新規生成
     * =========================================
     */

    if(mode === "create"){

      const prompt =
        buildCreatePrompt(body);


      const result =
        await openai.images.generate({

          model:"gpt-image-1",

          prompt,

          size:"1024x1024",

          quality:"medium",

          n:1

        });


      const b64 =
        result?.data?.[0]?.b64_json;


      if(!b64){

        throw new Error(
          "AIから画像が返ってきませんでした。"
        );

      }


      return res.status(200).json({

        image:
          `data:image/png;base64,${b64}`

      });

    }


    /*
     * =========================================
     * 原画編集
     * =========================================
     */

    if(mode === "edit"){

      if(!body.imageBase64){

        throw new Error(
          "編集する原画がありません。"
        );

      }


      const imageData =
        dataUrlToBuffer(
          body.imageBase64
        );


      const extension =
        getExtension(
          imageData.mimeType
        );


      const file =
        await OpenAI.toFile(

          imageData.buffer,

          `original.${extension}`,

          {
            type:
              imageData.mimeType
          }

        );


      const prompt =
        buildEditPrompt(body);


      const result =
        await openai.images.edit({

          model:"gpt-image-1",

          image:file,

          prompt,

          input_fidelity:
            fidelityToAPI(
              body.fidelity
            ),

          size:"1024x1024",

          quality:"medium",

          n:1

        });


      const b64 =
        result?.data?.[0]?.b64_json;


      if(!b64){

        throw new Error(
          "AI編集後の画像が返ってきませんでした。"
        );

      }


      return res.status(200).json({

        image:
          `data:image/png;base64,${b64}`

      });

    }


    return res.status(400).json({

      error:
        "不正な生成モードです。"

    });


  }catch(error){

    console.error(
      "IMAGE API ERROR:",
      error
    );


    let message =
      error?.message ||
      "画像生成に失敗しました。";


    if(
      message.includes(
        "maximum"
      ) ||
      message.includes(
        "payload"
      )
    ){

      message =
        "画像サイズが大きすぎます。12MB以下の画像を使用してください。";

    }


    return res.status(500).json({

      error:message

    });

  }

}