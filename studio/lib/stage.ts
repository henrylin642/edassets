/**
 * Admin-facing generation stage for an asset — the single source of truth for
 * the card colour swatch and the work-console grouping. Pure (no server deps),
 * so it can be imported by both server and client components.
 */
import type { Asset } from "./db/schema";

export type StageKey = "no_image" | "gen_image" | "need_3d" | "gen_3d" | "done" | "failed";

export interface Stage {
  key: StageKey;
  label: string;
  dot: string; // colour dot classes
  border: string; // card border classes
  badge: string; // pill classes
  /** true → still has work pending (shows in the console todo groups) */
  pending: boolean;
}

const STAGES: Record<StageKey, Omit<Stage, "key">> = {
  no_image: { label: "待生圖", dot: "bg-gray-400", border: "border-gray-300", badge: "bg-gray-100 text-gray-600", pending: true },
  gen_image: { label: "生成中", dot: "bg-blue-500 animate-pulse", border: "border-blue-300", badge: "bg-blue-100 text-blue-700", pending: true },
  need_3d: { label: "待生 3D", dot: "bg-amber-400", border: "border-amber-400", badge: "bg-amber-100 text-amber-700", pending: true },
  gen_3d: { label: "3D 生成中", dot: "bg-violet-500 animate-pulse", border: "border-violet-300", badge: "bg-violet-100 text-violet-700", pending: true },
  done: { label: "完成", dot: "bg-green-500", border: "border-green-200", badge: "bg-green-100 text-green-700", pending: false },
  failed: { label: "失敗", dot: "bg-red-500", border: "border-red-300", badge: "bg-red-100 text-red-700", pending: true },
};

export function stageKey(a: Pick<Asset, "status" | "modelStatus">): StageKey {
  if (a.status === "failed") return "failed";
  if (a.status === "queued" || a.status === "generating") return "gen_image";
  if (a.status === "pending" || a.status === "review") return "no_image";
  // status === "uploaded" → has an image; branch on 3D state
  if (a.modelStatus === "requested" || a.modelStatus === "generating") return "gen_3d";
  if (a.modelStatus === "done") return "done";
  return "need_3d"; // uploaded but modelStatus none | failed
}

export function assetStage(a: Pick<Asset, "status" | "modelStatus">): Stage {
  const key = stageKey(a);
  return { key, ...STAGES[key] };
}
