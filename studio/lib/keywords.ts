/**
 * Keyword curation — turn Dify's raw keywords into a clean list of
 * 3D-modelable concrete nouns, each with an optimized image prompt.
 *
 * Strategy goal (per product decision): the library is primarily concrete
 * nouns that can become a standalone 3D model for a kids' AR vocab card.
 * Drop function words, numbers, pronouns, abstract feelings, verbs/phrases.
 *
 * Two paths, same output shape:
 *   - LLM path (OPENAI_API_KEY set): filters + writes a tailored prompt.
 *   - Heuristic path (no key): rule-based noun filter, prompt = null
 *     (processAsset falls back to the template builder).
 */

import OpenAI from "openai";
import type { FlatKeyword } from "./dify";

export interface CuratedKeyword {
  en: string;
  zh: string;
  example: string;
  /** optimized single-object clay-render prompt, or null → use template */
  imagePrompt: string | null;
}

// ── heuristic fallback ─────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  "yes", "no", "okay", "ok", "please", "thanks", "thank you", "hello", "hi", "bye",
  "let's go", "lets go", "go", "come", "ready", "buy", "pay", "want", "need", "have",
  "this", "that", "here", "there", "it", "me", "you", "i", "he", "she", "we", "they",
  "mom", "dad", "mother", "father", "teacher", "friend", "sister", "brother", "me too",
]);

const ABSTRACT_WORDS = new Set([
  "hungry", "thirsty", "tired", "full", "sad", "happy", "angry", "scared", "bad",
  "sick", "excited", "bored", "shy", "proud", "nervous", "calm", "lonely", "good",
  "honor", "honour", "kindness", "honesty", "respect", "courage", "love", "fear",
]);

/** Keep only concrete, single-word-ish physical nouns. */
export function heuristicCurate(keywords: FlatKeyword[]): CuratedKeyword[] {
  const out: CuratedKeyword[] = [];
  for (const kw of keywords) {
    const w = kw.en.trim().toLowerCase();
    if (!w) continue;
    if (/^\d+$/.test(w)) continue; // numbers
    if (STOP_WORDS.has(w)) continue;
    if (ABSTRACT_WORDS.has(w)) continue;
    if (kw.bracket && ["adjective", "feeling", "emotion", "verb"].includes(kw.bracket)) continue;
    if (w.split(/\s+/).length > 2) continue; // long phrases
    out.push({ en: kw.en.trim(), zh: kw.zh, example: kw.example, imagePrompt: null });
  }
  return out;
}

// ── LLM path ───────────────────────────────────────────────────────────────
const SYSTEM = `You curate vocabulary for a children's AR English app, for a SPECIFIC scene. You receive the scene and a list of candidate keywords. Keep ONLY words that are concrete, physical, countable nouns that can be a single standalone 3D model on a vocab card.

DROP: feelings/adjectives (hungry, happy), numbers, pronouns, people roles (mom, teacher), verbs, greetings, function words (yes, okay, please), and abstract ideas.

For each KEPT word, write "subject": a noun phrase depicting the object IN THE FORM IT TYPICALLY APPEARS AS A PURCHASABLE ITEM IN THIS SCENE, as ONE recognizable item. Use the scene to pick the right form. Example — scene "convenience store": "chips" → "a bag of potato chips", "candy" → "a wrapped candy bar", "juice" → "a juice carton", "cookie" → "a pack of cookies", "cake" → "a slice of cake in a plastic box". 2-6 words. Do NOT mention any brand, logo, or written text (the engine renders gibberish if asked for text). No style words (no clay/render/background/3D) — added downstream.

Return ONLY JSON: {"keep":[{"en":"...","subject":"..."}]}. Use the exact original "en" spelling.`;

export async function llmCurate(
  scene: string,
  concreteScene: string,
  keywords: FlatKeyword[],
  opts: { apiKey?: string; model?: string } = {},
): Promise<CuratedKeyword[]> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return heuristicCurate(keywords);

  const client = new OpenAI({ apiKey });
  const model = opts.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  const user = `Scene: ${scene} (${concreteScene})
Candidate keywords:
${keywords.map((k) => `- ${k.en} (${k.zh})`).join("\n")}`;

  try {
    const res = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { keep?: { en: string; subject?: string }[] };
    const byEn = new Map(keywords.map((k) => [k.en.trim().toLowerCase(), k]));

    const out: CuratedKeyword[] = [];
    for (const item of parsed.keep ?? []) {
      const orig = byEn.get(item.en.trim().toLowerCase());
      if (!orig) continue;
      out.push({
        en: orig.en.trim(),
        zh: orig.zh,
        example: orig.example,
        imagePrompt: item.subject?.trim() || null, // subject phrase, wrapped with style downstream
      });
    }
    return out.length ? out : heuristicCurate(keywords);
  } catch {
    // LLM failure → don't block the pipeline
    return heuristicCurate(keywords);
  }
}
