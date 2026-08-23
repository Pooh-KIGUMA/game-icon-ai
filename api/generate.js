import OpenAI, { toFile } from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const TEXT_MODEL =
  process.env.TEXT_MODEL || "gpt-5.6-sol";

const IMAGE_MODEL = "gpt-image-2";

const SYSTEM = `
あなたは「Iconia AI」という画像制作サービスの会話AIです。

目的は、ユーザーがChatGPTに話しかけるように自然な文章だけで画像を作ったり編集したりできるようにすることです。

重要:

- 細かい設定項目をユーザーに要求しない。
- ユーザーの自然な文章から用途、構図、雰囲気、色、文字、編集範囲を理解する。
- ゲーム、X、Instagram、LINE、YouTube、Discord、Twitch、プロフィール画像、ヘッダーなど用途を会話から判断する。
- 画像なしならオリジナル画像を作る。
- 画像ありなら原則としてその画像を編集対象として扱う。
- 「人物はそのまま」「顔は変えない」「背景だけ」などの制約を最優先する。
- 「原画をほぼそのまま」は変更を最小限にする。
- 「自由にアレンジ」は元画像の良さを残しつつ改善する。
- 以前の会話の内容を踏まえ、ユーザーの「もっと」「戻して」「ここだけ変えて」を理解する。
- 指定されていないプレイヤーネーム、Pooh、AxLF、同盟名、クラン名、ロゴ、ウォーターマークを絶対に勝手に追加しない。
- ユーザーが文字を指定した場合は、文字列の大文字小文字、記号、スペースをできる限り正確に保持する。
- 画像内の文字が不要なら文字を入れない。
- SNSヘッダーなど横長用途では、重要な人物や文字が端で切れないよう安全領域を考える。
- プロフィール画像では小さく表示されても主役が認識できる構図にする。
- 1:1以外の用途では、目的に合う横長・縦長・正方形の構図を自動判断する。
- 画像編集ではユーザーが指定していない部分を不必要に変更しない。
- 特定の作品や作家の完全な模倣ではなく、一般化した特徴でオリジナル表現にする。

回答は以下のJSONだけ。

{
  "action":"GENERATE"|"EDIT"|"CHAT",
  "image_prompt":"",
  "reply":"",
  "examples":[]
}

判断:

具体的な画像作成依頼
→ GENERATE

画像なしの新規キャラクター
→ GENERATE

画像をベースにした変更
→ EDIT

アイデア相談・質問だけ
→ CHAT

「何かカッコいい画像を作って」
→ GENERATE

examples:

- 最大3個
- 必要なときだけ
- 抽象的な助言ではなく、そのまま次に送れる具体的な指示

image_prompt:

- 英語
- 画像生成モデルに直接渡せる具体的な指示
- ユーザーの要望を最優先
- 指定されていない文字は追加しない
- 指定された文字は正確な文字列として明示
- 編集の場合は保持する要素を明示
`;

const schema = {

  type:"object",

  additionalProperties:false,

  properties:{

    action:{
      type:"string",
      enum:[
        "GENERATE",
        "EDIT",
        "CHAT"
      ]
    },

    image_prompt:{
      type:"string"
    },

    reply:{
      type:"string"
    },

    examples:{
      type:"array",
      items:{
        type:"string"
      }
    }

  },

  required:[
    "action",
    "image_prompt",
    "reply",
    "examples"
  ]

};

function decodeDataUrl(dataUrl){

  const m =
    String(dataUrl || "")
    .match(
      /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/
    );

  if(!m){

    throw new Error(
      "画像データの形式が正しくありません。"
    );

  }

  return Buffer.from(
    m[1],
    "base64"
  );

}

export default async function handler(
  req,
  res
){

  if(req.method!=="POST"){

    return res.status(405).json({
      error:"POST only"
    });

  }

  if(!process.env.OPENAI_API_KEY){

    return res.status(500).json({

      error:
        "OPENAI_API_KEY がVercelに設定されていません。"

    });

  }

  try{

    const body=req.body || {};

    const message=
      String(
        body.message || ""
      )
      .trim()
      .slice(0,7000);

    const image=
      body.image || null;

    const previousResponseId=
      String(
        body.previousResponseId || ""
      )
      .trim()
      .slice(0,120);

    if(!message && !image){

      return res.status(400).json({

        error:
          "指示または画像を送ってください。"

      });

    }

    const content=[];

    if(message){

      content.push({

        type:"input_text",

        text:message

      });

    }

    if(image){

      content.push({

        type:"input_image",

        image_url:image,

        detail:"high"

      });

    }

    const params={

      model:TEXT_MODEL,

      instructions:SYSTEM,

      input:[
        {
          role:"user",
          content
        }
      ],

      max_output_tokens:1500,

      store:true,

      text:{

        format:{

          type:"json_schema",

          name:"iconia_plan",

          strict:true,

          schema

        }

      }

    };

    if(previousResponseId){

      params.previous_response_id =
        previousResponseId;

    }

    const planRes=
      await client.responses.create(
        params
      );

    let plan;

    try{

      plan=
        JSON.parse(
          planRes.output_text ||
          "{}"
        );

    }catch{

      plan={

        action:
          image
            ? "EDIT"
            : "GENERATE",

        image_prompt:
          message ||
          "Create a high-quality original image.",

        reply:
          "内容を理解しました。画像を作ります。",

        examples:[]

      };

    }

    const examples=
      Array.isArray(plan.examples)
        ? plan.examples
            .filter(Boolean)
            .slice(0,3)
        : [];

    if(
      plan.action==="CHAT"
    ){

      return res.status(200).json({

        responseId:
          planRes.id,

        action:"CHAT",

        reply:
          plan.reply ||
          "もちろんです。",

        examples

      });

    }

    const prompt=
      String(
        plan.image_prompt ||
        message ||
        "Create a high-quality original image."
      )
      .trim();

    let result;

    if(image){

      const file=
        await toFile(

          decodeDataUrl(image),

          "reference.jpg",

          {
            type:"image/jpeg"
          }

        );

      result=
        await client.images.edit({

          model:IMAGE_MODEL,

          image:file,

          prompt,

          size:"auto",

          quality:"high",

          n:1,

          output_format:"png"

        });

    }else{

      result=
        await client.images.generate({

          model:IMAGE_MODEL,

          prompt,

          size:"auto",

          quality:"high",

          n:1,

          output_format:"png"

        });

    }

    const b64=
      result?.data?.[0]?.b64_json;

    if(!b64){

      throw new Error(
        "画像データが返されませんでした。"
      );

    }

    return res.status(200).json({

      responseId:
        planRes.id,

      action:
        plan.action,

      image:
        `data:image/png;base64,${b64}`,

      reply:
        plan.reply ||
        "できました。ここからさらに修正できます。",

      examples

    });

  }catch(err){

    console.error(err);

    return res.status(500).json({

      error:
        err?.message ||
        "画像生成中にエラーが発生しました。"

    });

  }

}