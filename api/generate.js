import OpenAI, { toFile } from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const TEXT_MODEL = "gpt-5.6-sol";
const IMAGE_MODEL = "gpt-image-2";

const SYSTEM = `
あなたは「Iconia AI」という画像制作サービスの会話AIです。

ユーザーがChatGPTに話しかけるように、自然な文章だけで画像を作れるようにしてください。

重要ルール:

1. 細かい設定項目をユーザーに要求しない。
2. ユーザーの文章から画像の目的を理解する。
3. 画像なしならオリジナル画像を作る。
4. 画像ありなら、その画像をベースに編集する。
5. 「この画像をほぼそのまま」「顔は変えない」「人物はそのまま」などの指定を最優先する。
6. 指定されていない文字は絶対に追加しない。
7. Pooh、AxLFなどの文字を勝手に追加しない。
8. プレイヤーネーム、同盟名、クラン名、ロゴ、透かしなどを勝手に追加しない。
9. ユーザーが文字を指定した場合だけ、その文字を入れる。
10. 指定された文字は大文字・小文字・記号をできる限り正確にする。
11. SNSプロフィール画像、Xヘッダー、Instagram、LINE、YouTubeなど用途に合わせて構図を調整する。
12. ユーザーが「いい感じに」と言った場合は、専門的な判断で完成度を高める。
13. 前の会話を踏まえて「もっと」「少し変えて」「背景だけ変えて」などを理解する。
14. 画像編集では、ユーザーが変更を求めていない部分をなるべく保持する。
15. 特定作品の完全コピーではなく、オリジナルとして成立するデザインにする。

返答は必ずJSONのみ。

{
  "action": "GENERATE" | "EDIT" | "CHAT",
  "image_prompt": "",
  "reply": "",
  "examples": []
}

GENERATE:
新しい画像を作る場合。

EDIT:
ユーザーが送った画像を編集する場合。

CHAT:
画像をまだ作らず相談する場合。

examples:
ユーザーが次に使えそうな具体的な指示を最大3つ。
必要ない場合は空配列。

image_prompt:
画像生成AIに直接渡す英語のプロンプト。
ユーザーの希望をできるだけ詳しく反映する。
指定されていない文字を追加しない。
`;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["GENERATE", "EDIT", "CHAT"]
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

function decodeDataUrl(dataUrl) {

  const match =
    String(dataUrl || "").match(
      /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/
    );

  if (!match) {
    throw new Error("画像データの形式が正しくありません。");
  }

  return Buffer.from(match[1], "base64");
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

    const message =
      String(body.message || "")
        .trim()
        .slice(0, 7000);

    const image =
      body.image || null;

    const previousResponseId =
      String(body.previousResponseId || "")
        .trim()
        .slice(0, 200);

    if (!message && !image) {
      return res.status(400).json({
        error: "指示または画像を送ってください。"
      });
    }

    const content = [];

    if (message) {
      content.push({
        type: "input_text",
        text: message
      });
    }

    if (image) {
      content.push({
        type: "input_image",
        image_url: image,
        detail: "high"
      });
    }

    const responseParams = {

      model: TEXT_MODEL,

      instructions: SYSTEM,

      input: [
        {
          role: "user",
          content
        }
      ],

      max_output_tokens: 1500,

      store: true,

      text: {
        format: {
          type: "json_schema",
          name: "iconia_plan",
          strict: true,
          schema
        }
      }
    };

    if (previousResponseId) {
      responseParams.previous_response_id =
        previousResponseId;
    }

    const planResponse =
      await client.responses.create(
        responseParams
      );

    let plan;

    try {

      plan =
        JSON.parse(
          planResponse.output_text || "{}"
        );

    } catch {

      plan = {
        action: image ? "EDIT" : "GENERATE",
        image_prompt:
          message ||
          "Create a high quality original image.",
        reply:
          "内容を理解しました。画像を作ります。",
        examples: []
      };

    }

    const examples =
      Array.isArray(plan.examples)
        ? plan.examples
            .filter(Boolean)
            .slice(0, 3)
        : [];

    /*
     * まだ画像を作る必要がない場合
     */

    if (plan.action === "CHAT") {

      return res.status(200).json({

        responseId:
          planResponse.id,

        action: "CHAT",

        reply:
          plan.reply ||
          "もちろんです。",

        examples

      });

    }

    const prompt =
      String(
        plan.image_prompt ||
        message ||
        "Create a high quality original image."
      )
      .trim();

    let result;

    /*
     * 画像編集
     */

    if (image) {

      const file =
        await toFile(
          decodeDataUrl(image),
          "reference.jpg",
          {
            type: "image/jpeg"
          }
        );

      result =
        await client.images.edit({

          model: IMAGE_MODEL,

          image: file,

          prompt: prompt,

          /*
           * Vercelのレスポンスサイズを抑える
           */
          size: "1024x1024",

          quality: "high",

          output_format: "jpeg",

          output_compression: 55,

          n: 1

        });

    }

    /*
     * 新規生成
     */

    else {

      result =
        await client.images.generate({

          model: IMAGE_MODEL,

          prompt: prompt,

          size: "1024x1024",

          quality: "high",

          output_format: "jpeg",

          output_compression: 55,

          n: 1

        });

    }

    const base64 =
      result?.data?.[0]?.b64_json;

    if (!base64) {

      throw new Error(
        "画像データが返されませんでした。"
      );

    }

    /*
     * JPEGで返すことで、
     * PNGより大幅にレスポンスを小さくする
     */

    const imageData =
      `data:image/jpeg;base64,${base64}`;

    /*
     * 念のためサイズをチェック
     */

    const sizeMB =
      Buffer.byteLength(
        imageData,
        "utf8"
      ) / 1024 / 1024;

    console.log(
      "Image response size:",
      sizeMB.toFixed(2),
      "MB"
    );

    /*
     * 4MBを超えそうなら明確なエラーにする
     */

    if (sizeMB > 4.0) {

      return res.status(413).json({

        error:
          "生成画像のサイズが大きすぎました。もう一度生成してください。"

      });

    }

    return res.status(200).json({

      responseId:
        planResponse.id,

      action:
        plan.action,

      image:
        imageData,

      reply:
        plan.reply ||
        "できました。さらに修正できます。",

      examples

    });

  } catch (error) {

    console.error(
      "ICONIA API ERROR:",
      error
    );

    return res.status(500).json({

      error:
        error?.message ||
        "画像生成中にエラーが発生しました。"

    });

  }

}