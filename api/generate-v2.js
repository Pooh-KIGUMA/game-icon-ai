import generateFast from './generate-fast.js';

const DESIGN_RE = /(文字|テキスト|ロゴ|名前|チーム名|クラン名|同盟名|ギルド名|入れて|書いて|デザイン|かっこよく|おしゃれ|ロゴ風|wordmark|logo|text)/iu;

const PREMIUM_DIRECTIVE = `\n\n[ICONIA PREMIUM DESIGN DIRECTIVE]\nTreat this as a professional game-icon logo art-direction pass. Do not paste text on top of the artwork. Before rendering, inspect the actual reference for focal point, face/eyes, silhouette, negative space, frame geometry, lighting direction, palette and visual hierarchy. Mentally compare at least three different logo compositions and select the strongest one for THIS image. The subject must remain the primary focal point and the requested wordmark must be secondary. Avoid covering eyes, face or defining details. Do not default to centered or giant bottom text. For short names, build a compact bespoke wordmark/emblem with intentional letter silhouette, spacing, angle, material, bevel, outline, shadow, highlight and restrained glow derived from the image. Integrate the wordmark with the existing frame, energy, ornaments and lighting so it feels physically native to the artwork. Prefer negative space, an arc, a side lane, a lower corner, or a controlled frame overlap when that produces better hierarchy. Keep the wordmark readable at thumbnail size without turning it into an oversized title. Include the requested text exactly once and do not invent any other text, watermark or signature. If a previous version already exists, make the new composition meaningfully different rather than merely recoloring or moving the same template. Preserve the character/person and all unrequested artwork exactly. Final result should look like a finished commercial game icon designed specifically around this reference, not an AI text overlay.`;

export default async function handler(req, res) {
  if (req.method === 'POST' && req.body && DESIGN_RE.test(String(req.body.message || ''))) {
    const body = { ...req.body, message: `${String(req.body.message || '').trim()}${PREMIUM_DIRECTIVE}` };
    const wrappedReq = Object.create(req);
    wrappedReq.body = body;
    return generateFast(wrappedReq, res);
  }
  return generateFast(req, res);
}
