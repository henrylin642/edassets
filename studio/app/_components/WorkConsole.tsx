"use client";

import { useState } from "react";
import type { Asset } from "@/lib/db/schema";
import { assetStage, type StageKey } from "@/lib/stage";

export interface WorkItem {
  id: string;
  name: string;
  type: Asset["type"];
  status: Asset["status"];
  modelStatus: Asset["modelStatus"];
}

/** Admin work console: a fixed, collapsible bar listing this scene's unfinished work. */
export function WorkConsole({ items }: { items: WorkItem[] }) {
  const [open, setOpen] = useState(false);
  const withStage = items.map((i) => ({ ...i, stage: assetStage(i) }));
  const group = (k: StageKey) => withStage.filter((i) => i.stage.key === k);
  const noImage = group("no_image");
  const need3d = group("need_3d");
  const inProgress = [...group("gen_image"), ...group("gen_3d")];
  const failed = group("failed");
  const doneN = group("done").length;
  const todo = noImage.length + need3d.length + inProgress.length + failed.length;

  const jump = (id: string) => {
    const el = document.getElementById(`asset-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-pink-400");
    setTimeout(() => el.classList.remove("ring-2", "ring-pink-400"), 1600);
  };

  const Group = ({ title, list }: { title: string; list: typeof withStage }) =>
    list.length === 0 ? null : (
      <div className="space-y-1">
        <div className="text-[11px] font-medium text-gray-500">{title}（{list.length}）</div>
        <div className="flex flex-wrap gap-1">
          {list.map((i) => (
            <button
              key={i.id}
              onClick={() => jump(i.id)}
              title={`${i.type === "keyword" ? "關鍵字" : "情境"}物件 · ${i.stage.label} · 點擊定位`}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${i.stage.badge} hover:brightness-95`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${i.stage.dot}`} />
              {i.name}
            </button>
          ))}
        </div>
      </div>
    );

  const stat = (label: string, n: number, cls = "text-gray-600") => (
    <span className={cls}>{label} <span className="font-mono font-semibold">{n}</span></span>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 shadow-[0_-2px_8px_rgba(0,0,0,0.05)] backdrop-blur">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-xs"
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="font-semibold text-gray-800">🛠 工作台</span>
          {stat("待辦", todo, todo > 0 ? "text-pink-600" : "text-gray-400")}
          <span className="text-gray-300">|</span>
          {stat("待生圖", noImage.length, "text-gray-600")}
          {stat("待生 3D", need3d.length, "text-amber-700")}
          {stat("進行中", inProgress.length, "text-blue-700")}
          {failed.length > 0 && stat("失敗", failed.length, "text-red-600")}
          {stat("完成", doneN, "text-green-700")}
        </span>
        <span className="text-gray-400">{open ? "收合 ▾" : "展開 ▸"}</span>
      </button>
      {open && (
        <div className="max-h-64 space-y-3 overflow-auto border-t border-gray-100 px-4 py-3">
          {todo === 0 ? (
            <div className="text-xs text-green-700">🎉 此場景全部完成，沒有待辦工作。</div>
          ) : (
            <>
              <Group title="① 待生成圖片" list={noImage} />
              <Group title="② 有圖・待生成 3D" list={need3d} />
              <Group title="③ 進行中（生圖 / 3D）" list={inProgress} />
              <Group title="⚠ 失敗（需重試）" list={failed} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
