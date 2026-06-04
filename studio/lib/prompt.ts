/**
 * Image prompt templates.
 *
 * Style decision (Q-D): white background, single centered object, child-friendly
 * illustration, no text/watermark — optimized for later image-to-3D conversion
 * and AR compositing (clean cutout).
 */

import type { ComfyParams } from "./comfy";
import type { SemanticClass } from "./classify";

// z_image responds best to short, descriptive prompts (cf. its own example
// "a cute red panda, 3D clay render style"). Keep it minimal; over-instructing
// produces gibberish/text artifacts. White bg + centered for clean AR cutout.
const STYLE = "cute 3D clay render style, plain white background, centered, soft lighting";

const NEGATIVE =
  "text, words, letters, embossed text, engraved letters, typography, label, sign, " +
  "packaging, brand, multiple objects, busy background, scenery, watermark, logo, " +
  "blurry, low quality, realistic photo, grainy background";

/**
 * Build ComfyUI params for one asset.
 * NOTE: never inject scene context — it makes ComfyUI render the whole scene
 * instead of the subject (validated in M0).
 */
export function buildImageParams(
  s: { en: string; semanticClass: SemanticClass; subject?: string | null },
  overrides: Partial<ComfyParams> = {},
): ComfyParams {
  // Always wrap the subject with stable style anchors (single object, centered…);
  // z_image renders gibberish/text if these are dropped. `subject` is an
  // LLM-disambiguated noun phrase (e.g. "a bag of potato chips") when available.
  const positive = s.subject
    ? `${s.subject}, single object, ${STYLE}`
    : s.semanticClass === "abstract"
      ? `a cute child character feeling ${s.en}, ${STYLE}`
      : `a ${s.en}, single object, ${STYLE}`;
  return {
    positive_prompt: positive,
    negative_prompt: NEGATIVE,
    steps: 24,
    cfg: 3.2,
    width: 1024,
    height: 1024,
    ...overrides,
  };
}

/** Only concrete assets are eligible for image-to-3D (M2). */
export function is3dEligible(semanticClass: SemanticClass): boolean {
  return semanticClass === "concrete";
}

/** Normalize an English keyword into a tag (lowercase, trimmed, spaces→hyphen). */
export function toTag(en: string): string {
  return en.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Build the tag set for an asset: english tag + aliases (zh, raw en). */
export function buildTags(en: string, zh?: string): string[] {
  const tags = new Set<string>();
  tags.add(toTag(en));
  if (en.trim().toLowerCase() !== toTag(en)) tags.add(en.trim().toLowerCase());
  if (zh) tags.add(zh.trim());
  return [...tags].filter(Boolean);
}
