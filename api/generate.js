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

const imageData = data?.data?.[0]?.b64_json;

if (!imageData) {
  return res.status(500).json({
    error: "The AI did not return an image."
  });
}

const imageUrl = `data:image/png;base64,${imageData}`;

return res.status(200).json({
  image: imageUrl
});

} catch (error) {
  console.error("Image generation error:", error);

  return res.status(500).json({
    error: error?.message || "Server error"
  });
}