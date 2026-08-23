export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({
        error: "Prompt is required"
      });
    }

    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: prompt,
          size: "1024x1024",
          quality: "auto"
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Image generation failed"
      });
    }

    // GPT ImageのBase64画像をURL形式に変換
    if (data?.data?.[0]?.b64_json) {
      data.data[0].url =
        `data:image/png;base64,${data.data[0].b64_json}`;
    }

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}