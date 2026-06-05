import type { Asset } from "@/lib/db/schema";
import { toMB } from "@/lib/meshinfo";
import { ReviewButtons, Make3dButton, RegenButton, PromptEditor, GenerateButton, DeleteButton, SideViewButton } from "./Controls";

/* eslint-disable @next/next/no-img-element */
export function AssetCard({ a }: { a: Asset }) {
  const src =
    a.status === "uploaded" && a.imageUrl ? a.imageUrl : a.status === "review" ? `/api/preview/${a.id}` : null;

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-2">
      <div className="relative aspect-square w-full overflow-hidden rounded bg-gray-50">
        {src ? (
          <img src={src} alt={a.nameEn} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">
            {a.status === "failed" ? "✕ 失敗" : a.status === "generating" ? "🎨 生成中…" : a.status === "queued" ? "⏳ 已排隊" : "待生成"}
          </div>
        )}
      </div>

      {a.hasSideView && (
        <div className="space-y-0.5">
          <div className="grid grid-cols-2 gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/sideview/${a.id}?kind=left`} alt={`${a.nameEn} side`} className="aspect-square w-full rounded bg-gray-50 object-contain" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/sideview/${a.id}?kind=back`} alt={`${a.nameEn} back`} className="aspect-square w-full rounded bg-gray-50 object-contain" />
          </div>
          <div className="text-[10px] text-gray-400">側視 + 背視（3D 用，不上架）</div>
        </div>
      )}
      {a.sideViewError && (
        <div className="truncate text-[10px] text-amber-600" title={a.sideViewError}>側視圖失敗：{a.sideViewError}</div>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{a.nameEn}</span>
        <span className="text-xs text-gray-400">{a.nameZh}</span>
      </div>

      {a.placement && (
        <div className="text-[10px] text-cyan-700">
          📍 x{a.placement.x} z{a.placement.z} · {a.placement.rotationY}° · {a.placement.sizeM}m
        </div>
      )}

      {a.status === "pending" && <GenerateButton id={a.id} scenarioId={a.scenarioId ?? undefined} />}

      {a.status === "review" && <ReviewButtons id={a.id} scenarioId={a.scenarioId ?? undefined} />}

      {a.status === "uploaded" && (
        <div className="space-y-1">
          <div className="text-[11px] text-gray-500">
            asset_id: <span className="font-mono text-gray-700">{a.ligImageId}</span>
          </div>
          <a href={a.imageUrl ?? "#"} target="_blank" rel="noreferrer"
            className="block truncate text-[11px] text-blue-600 hover:underline">
            {a.imageUrl}
          </a>
          <div className="text-[10px] text-gray-400">
            {a.imageWidth ? `${a.imageWidth}×${a.imageHeight} px` : ""}
            {a.imageBytes ? ` · ${toMB(a.imageBytes)} MB` : ""}
          </div>
          <div className="truncate text-[10px] text-gray-400">tags: {a.tags.join(", ")}</div>

          {a.modelStatus === "done" && a.modelUrl && (
            <div className="space-y-1 rounded bg-cyan-50 p-1">
              {/* @ts-expect-error model-viewer is a web component */}
              <model-viewer src={a.modelUrl} camera-controls auto-rotate disable-zoom
                style={{ width: "100%", height: "140px", backgroundColor: "#f3f4f6" }} />
              <div className="text-[10px] text-cyan-700">
                {a.modelFaces ? `${a.modelFaces.toLocaleString()} 面` : ""}
                {a.modelBytes ? ` · ${toMB(a.modelBytes)} MB` : ""}
                {(() => {
                  const c = (a.generationMeta as { model?: { creditsUsed?: number } } | null)?.model?.creditsUsed;
                  return typeof c === "number" ? ` · 扣 ${c} 點` : "";
                })()}
              </div>
              <div className="text-[10px] text-cyan-700">
                3D asset_id: <span className="font-mono">{a.ligModelId}</span> ·{" "}
                <a href={a.modelUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">glb</a>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <SideViewButton id={a.id} scenarioId={a.scenarioId ?? undefined} status={a.sideViewStatus} has={a.hasSideView} />
            <Make3dButton id={a.id} scenarioId={a.scenarioId ?? undefined} status={a.modelStatus} />
            <RegenButton id={a.id} scenarioId={a.scenarioId ?? undefined} />
          </div>
        </div>
      )}

      {a.status === "failed" && (
        <div className="space-y-1">
          <div className="truncate text-[10px] text-red-500">{a.error}</div>
          <GenerateButton id={a.id} scenarioId={a.scenarioId ?? undefined} label="▶ 重試生成" />
        </div>
      )}

      <div className="flex items-center justify-between">
        <PromptEditor id={a.id} scenarioId={a.scenarioId ?? undefined} subject={a.imagePrompt ?? ""} />
        <DeleteButton id={a.id} scenarioId={a.scenarioId ?? undefined} name={a.nameEn} />
      </div>
    </div>
  );
}
