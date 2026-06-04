/**
 * Semantic classification of a keyword into concrete vs abstract.
 *
 * concrete → physical thing → render a single object, eligible for 3D.
 * abstract → feeling/quality/value → render an expressive illustration, no 3D.
 *
 * Signal source: the Dify objective's pattern bracket label is the strongest cue
 * (`I feel [adjective]` → abstract; `I want [snack]` → concrete). We fall back to
 * a small word list, then default to concrete.
 *
 * (Upgrade path: replace with an LLM batch-classify call when an OpenAI/Claude
 *  key is available — see PRD §7.)
 */

export type SemanticClass = "concrete" | "abstract";

/** Bracket labels that denote an abstract slot. */
const ABSTRACT_BRACKETS = new Set([
  "adjective",
  "feeling",
  "feelings",
  "emotion",
  "emotions",
  "mood",
  "quality",
  "value",
  "virtue",
]);

/** Concrete-noun bracket labels (everything physical the student can name). */
const CONCRETE_BRACKETS = new Set([
  "noun",
  "snack",
  "food",
  "drink",
  "animal",
  "color",
  "colour",
  "body part",
  "place",
  "money",
  "object",
  "thing",
  "toy",
  "clothes",
  "fruit",
  "vegetable",
]);

/** Common abstract words seen as keywords (emotions / virtues). */
const ABSTRACT_WORDS = new Set([
  "hungry", "thirsty", "tired", "sad", "happy", "angry", "scared", "bad", "sick",
  "excited", "bored", "shy", "proud", "nervous", "calm", "lonely",
  "honor", "honour", "kindness", "honesty", "respect", "courage", "patience",
  "love", "fear", "hope", "joy",
]);

export function classifyKeyword(
  en: string,
  bracket: string | null,
): SemanticClass {
  const b = bracket?.toLowerCase().trim();
  if (b && ABSTRACT_BRACKETS.has(b)) return "abstract";
  if (b && CONCRETE_BRACKETS.has(b)) return "concrete";

  const w = en.trim().toLowerCase();
  if (ABSTRACT_WORDS.has(w)) return "abstract";

  // Unknown bracket + unknown word → default concrete (object render).
  return "concrete";
}
