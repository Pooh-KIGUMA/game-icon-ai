import OpenAI, { toFile } from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const TEXT_MODEL =
  process.env.TEXT_MODEL || "gpt-5.6-sol";

const IMAGE_MODEL = "gpt-image-2";

const INSTRUCTIONS = `
あなたは「Game Icon AI」の画像ディレクター兼会話アシスタントです。

ユーザーと日本語で自然に会話しながら、
ゲーム用の1:1アイコンを一緒に完成させます。

重要:

- 細かいフォームや選択項目をユーザーに強制しない。
- ユーザーの自然な文章から意図を理解する。
- 曖昧な依頼でも生成意図があれば自分で良い方向を考える。
- ユーザーが曖昧なら具体的な候補を最大3個提示する。
- 過去の会話を踏まえて修正する。
- 「もっと」「やっぱり戻して」「ここだけ変えて」などの指示を理解する。

画像がある場合:

- 画像は編集対象。
- ユーザーが「そのまま」と言った部分は可能な限り維持する。
- 「顔は変えない」なら顔を変更しない。
- 「人物はそのまま、背景だけ変更」なら人物を維持する。
- 「原画をほぼそのまま」と言われたら変更を最小限にする。
- 「自由にアレンジ」と言われた場合は元画像の良さを残しながら改善する。

画像がない場合:

- 完全オリジナルのキャラクターを作る。

文字について:

- ユーザーが指定した文字列は正確に使う。
- 大文字小文字や記号を勝手に変更しない。
- ユーザーが指定していない名前を絶対に追加しない。
- Pooh、AxLF、Player nameなどを勝手に入れない。
- 同盟名、クラン名、プレイヤー名も指定がない限り入れない。
- ウォーターマークも勝手に入れない。
- 「文字だけ追加」と言われた場合、人物や背景を大幅に変更しない。

ゲームアイコンなので:

- 1:1 square
- 主役を見やすくする
- 必要なら人物を大きくする
- 顔を見やすくする
- 高品質
- 印象的
- ゲームプロフィール画像として成立する構図

以下のJSONだけを返してください。

{
  "action": "GENERATE" | "EDIT" | "CHAT",
  "image_prompt": "",
  "reply": "",
  "examples": []
}

判断:

具体的に画像を作る
→ GENERATE

画像なしで新しいキャラクター
→ GENERATE

参考画像を変更
→ EDIT

相談・アイデア出しだけ
→ CHAT

「何かカッコいいの作って」
→ GENERATE

examplesは必要な場合のみ最大3個。

image_prompt:

- 必ず英語
- 1:1 square game icon
- ユーザーの指定を最優先
- 指定されていない文字は入れない
- 文字を指定された場合は正確な文字列を入れる
- 編集では変更しない部分を明示する
`;

const schema = {

  type: "object",

  additionalProperties: false,

  properties: {

    action: {
      type: "string",
      enum: [
        "GENERATE",
        "EDIT",
        "CHAT"
      ]
    },

    image_prompt: {
      type: "string"
    },

    reply: {
      type: "string"
    },

    examples: {

      type: "array",

      items: {
        type: "string"
      }

    }

  },

  required: [
    "action",
    "image_prompt",
    "reply",
    "examples"
  ]

};

function dataUrlToBuffer(dataUrl){

  const match =
    String(dataUrl || "")
    .match(
      /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/
    );

  if(!match){

    throw new Error(
      "画像データの形式が正しくありません。"
    );

  }

  return Buffer.from(
    match[2],
    "base64"
  );

}

function limitText(value,max){

  return String(
    value ?? ""
  )
  .trim()
  .slice(0,max);

}

function normalizePlan(raw){

  const plan =
    raw &&
    typeof raw === "object"
      ? raw
      : {};

  const action =
    [
      "GENERATE",
      "EDIT",
      "CHAT"
    ].includes(plan.action)
      ? plan.action
      : "GENERATE";

  const examples =
    Array.isArray(plan.examples)
      ? plan.examples
          .map(x=>String(x).trim())
          .filter(Boolean)
          .slice(0,3)
      : [];

  return {

    action,

    image_prompt:
      String(
        plan.image_prompt || ""
      ).trim(),

    reply:
      String(
        plan.reply ||
        "できました。ここからさらに修正できます。"
      ).trim(),

    examples

  };

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
        "OPENAI_API_KEY がVercelのEnvironment Variablesに設定されていません。"

    });

  }

  try{

    const body=req.body || {};

    const message=
      limitText(
        body.message,
        7000
      );

    const image=
      body.image || null;

    const previousResponseId=
      limitText(
        body.previousResponseId,
        120
      );

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

    const responseParams={

      model:TEXT_MODEL,

      instructions:INSTRUCTIONS,

      input:[
        {
          role:"user",
          content
        }
      ],

      max_output_tokens:1400,

      store:true,

      text:{

        format:{

          type:"json_schema",

          name:"game_icon_plan",

          strict:true,

          schema

        }

      }

    };

    if(previousResponseId){

      responseParams.previous_response_id =
        previousResponseId;

    }

    const planResponse =
      await client.responses.create(
        responseParams
      );

    let plan;

    try{

      plan=
        normalizePlan(
          JSON.parse(
            planResponse.output_text ||
            "{}"
          )
        );

    }catch{

      plan={

        action:
          image
            ? "EDIT"
            : "GENERATE",

        image_prompt:
          message ||
          "Create a high-quality original game icon.",

        reply:
          "内容を理解しました。画像を作ります。",

        examples:[]

      };

    }

    if(plan.action==="CHAT"){

      return res.status(200).json({

        responseId:
          planResponse.id,

        action:"CHAT",

        reply:plan.reply,

        examples:plan.examples

      });

    }

    if(!plan.image_prompt){

      plan.image_prompt =
        message ||
        "Create a high-quality original game icon.";

    }

    let result;

    if(image){

      const buffer =
        dataUrlToBuffer(image);

      const file =
        await toFile(
          buffer,
          "reference.jpg",
          {
            type:"image/jpeg"
          }
        );

      result =
        await client.images.edit({

          model:IMAGE_MODEL,

          image:file,

          prompt:plan.image_prompt,

          size:"1024x1024",

          quality:"high",

          n:1,

          output_format:"png"

        });

    }else{

      result =
        await client.images.generate({

          model:IMAGE_MODEL,

          prompt:plan.image_prompt,

          size:"1024x1024",

          quality:"high",

          n:1,

          output_format:"png"

        });

    }

    const b64 =
      result?.data?.[0]?.b64_json;

    if(!b64){

      throw new Error(
        "画像データが返されませんでした。"
      );

    }

    return res.status(200).json({

      responseId:
        planResponse.id,

      action:
        plan.action,

      image:
        `data:image/png;base64,${b64}`,

      reply:
        plan.reply ||
        "できました。ここからさらに普通に修正できます。",

      examples:
        plan.examples

    });

  }catch(error){

    console.error(error);

    return res.status(500).json({

      error:
        error?.message ||
        "画像生成中にエラーが発生しました。"

    });

  }

}