import originalHandler from "./generate.js";

// Compatibility endpoint. All image generation/editing now uses the same AI-first
// pipeline so text is rendered by the image model instead of being overlaid later.
export default async function handler(req, res) {
  return originalHandler(req, res);
}
