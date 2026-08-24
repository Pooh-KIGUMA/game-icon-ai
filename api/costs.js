// Iconia AI: centralized cost-estimation configuration.
// This file is intentionally independent from image generation so pricing changes
// never risk breaking the working image pipeline.

const envNumber = (name, fallback = 0) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

export const COST_CONFIG = Object.freeze({
  planner: Object.freeze({
    model: "gpt-5.6",
    inputUsdPer1M: envNumber("ICONIA_PLANNER_INPUT_USD_PER_1M"),
    cachedInputUsdPer1M: envNumber("ICONIA_PLANNER_CACHED_INPUT_USD_PER_1M"),
    outputUsdPer1M: envNumber("ICONIA_PLANNER_OUTPUT_USD_PER_1M"),
  }),
  image: Object.freeze({
    model: "gpt-image-2",
    lowUsd: envNumber("ICONIA_IMAGE_LOW_USD"),
    mediumUsd: envNumber("ICONIA_IMAGE_MEDIUM_USD"),
    highUsd: envNumber("ICONIA_IMAGE_HIGH_USD"),
  }),
});

export function plannerCostUsd(usage = {}) {
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const cached = Number(
    usage.input_token_details?.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ?? 0
  ) || 0;
  const uncached = Math.max(0, input - cached);

  return (
    (uncached / 1_000_000) * COST_CONFIG.planner.inputUsdPer1M +
    (cached / 1_000_000) * COST_CONFIG.planner.cachedInputUsdPer1M +
    (output / 1_000_000) * COST_CONFIG.planner.outputUsdPer1M
  );
}

export function imageCostUsd(quality = "medium", count = 1) {
  const q = String(quality).toLowerCase();
  const unit = q === "high"
    ? COST_CONFIG.image.highUsd
    : q === "low"
      ? COST_CONFIG.image.lowUsd
      : COST_CONFIG.image.mediumUsd;
  return unit * Math.max(0, Number(count) || 0);
}

export function buildCostSnapshot({ usage, quality, imageCount = 1 } = {}) {
  const planner = plannerCostUsd(usage);
  const image = imageCostUsd(quality, imageCount);
  return {
    plannerUsd: Number(planner.toFixed(8)),
    imageUsd: Number(image.toFixed(8)),
    totalUsd: Number((planner + image).toFixed(8)),
    plannerModel: COST_CONFIG.planner.model,
    imageModel: COST_CONFIG.image.model,
    quality: quality || "medium",
    imageCount: Math.max(0, Number(imageCount) || 0),
  };
}
