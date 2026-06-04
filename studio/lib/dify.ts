/**
 * Dify client — Principal Fang Planner (教案) as the keyword source.
 *
 * The app is an `advanced-chat` workflow. We call /v1/chat-messages in
 * `blocking` mode and read the `answer` string, which embeds the workflow's
 * final_json ({ concrete_scene, greeting, objectives[] }).
 *
 * ⚠️ Known workflow quirk: when teaching_materials is empty, the false branch
 * ALSO reaches a "Material Cannot be Empty" answer node, so `answer` ends with
 * trailing non-JSON text, e.g.  `...}Message: Material Cannot be Empty!`.
 * We therefore extract the first complete balanced `{...}` object instead of
 * JSON.parse-ing the whole string.
 */

export type StudentLevel = "L1" | "L2" | "L3";

export interface DifyKeyword {
  en: string;
  zh: string;
  example: string;
  image_url?: string; // Pixabay — ignored by us
}

export interface DifyObjective {
  index: number;
  goal: string;
  zh_goal?: string;
  pattern: string;
  example: string;
  next_q: string;
  keywords: DifyKeyword[];
}

export interface DifyLessonPlan {
  concrete_scene: string;
  greeting: string;
  objectives: DifyObjective[];
}

export interface DifyParams {
  scene: string;
  student_level?: StudentLevel;
  objective_steps?: number;
  number_of_keywords?: number;
}

/** Pull the first balanced top-level JSON object out of a noisy string. */
export function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No '{' found in Dify answer");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("Unbalanced braces in Dify answer");
}

export function parseLessonPlan(answer: string): DifyLessonPlan {
  const json = extractFirstJsonObject(answer);
  const plan = JSON.parse(json) as DifyLessonPlan;
  if (!Array.isArray(plan.objectives)) {
    throw new Error("Dify answer missing objectives[]");
  }
  return plan;
}

/** A keyword enriched with the bracket label of the objective it came from. */
export interface FlatKeyword extends DifyKeyword {
  /** lowercased bracket label from the objective pattern, e.g. "adjective", "snack", "body part" */
  bracket: string | null;
}

/** First [bracket] label inside a pattern string, lowercased. */
export function bracketLabel(pattern: string): string | null {
  const m = pattern?.match(/\[([^\]]+)\]/);
  return m ? m[1].trim().toLowerCase() : null;
}

/** Flatten all objectives' keywords, de-duplicated by lowercased en. */
export function flattenKeywords(plan: DifyLessonPlan): FlatKeyword[] {
  const seen = new Set<string>();
  const out: FlatKeyword[] = [];
  for (const obj of plan.objectives) {
    const bracket = bracketLabel(obj.pattern ?? "");
    for (const kw of obj.keywords ?? []) {
      const key = kw.en?.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ en: kw.en.trim(), zh: kw.zh, example: kw.example, bracket });
    }
  }
  return out;
}

/** Call the Dify教案 workflow for one scene and return the parsed lesson plan. */
export async function generateLessonPlan(
  params: DifyParams,
  opts: { base?: string; appKey?: string } = {},
): Promise<DifyLessonPlan> {
  const base = opts.base ?? process.env.DIFY_BASE;
  const appKey = opts.appKey ?? process.env.DIFY_APP_KEY;
  if (!base || !appKey) throw new Error("DIFY_BASE / DIFY_APP_KEY not set");

  const res = await fetch(`${base}/v1/chat-messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: {
        scene: params.scene,
        student_level: params.student_level ?? "L1",
        objective_steps: params.objective_steps ?? 5,
        number_of_keywords: params.number_of_keywords ?? 10,
      },
      query: "generate",
      response_mode: "blocking",
      conversation_id: "", // empty → fresh conversation each call
      user: "ar-assets-studio",
    }),
  });

  if (!res.ok) {
    throw new Error(`Dify ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { answer?: string };
  if (!data.answer) throw new Error("Dify response missing answer");
  return parseLessonPlan(data.answer);
}
