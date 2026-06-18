"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  createSceneAction,
  generateConceptAction,
  processNextAction,
  approveAction,
  rejectAction,
  request3dAction,
  regenAction,
  regenSceneAction,
  updatePromptAction,
  generateAssetAction,
  addObjectAction,
  deleteAssetAction,
  batch3dAction,
  sideViewAction,
  clearSideViewAction,
  deleteSceneAction,
  replanLayoutAction,
  extractObjectsAction,
  generateLayoutConceptAction,
  generateTopViewAction,
  attachExistingAction,
} from "../actions";
import type { AddObjectResult } from "../actions";
import type { KeywordMatch } from "@/lib/pipeline";

/**
 * While background work is queued: poll a worker tick (drives generation on
 * serverless/Hobby where there's no cron) and refresh the page to show progress.
 */
export function AutoRefresh({ active, ms = 4000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const run = async () => {
      try { await fetch("/api/worker/tick"); } catch {}
      if (!stop) router.refresh();
    };
    const t = setInterval(run, ms);
    void run();
    return () => { stop = true; clearInterval(t); };
  }, [active, ms, router]);
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">
      <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" /> 背景生成中…自動更新
    </span>
  ) : null;
}

export function CreateSceneForm() {
  const [pending, start] = useTransition();
  return (
    <form action={(fd) => start(() => createSceneAction(fd))} className="space-y-2">
      <textarea
        name="script"
        rows={3}
        placeholder="用文案描述情境，例如：學生走進便利商店，跟店員 Tom 點一杯咖啡和一個飯糰，學會用英文詢問價格與付款。（可只寫場域名稱）"
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        required
      />
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded bg-pink-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "建立中…（AI 解析文案）" : "+ 由文案建立場景"}
        </button>
        <span className="text-xs text-gray-400">建立後自動生概念圖 → 再到場景頁「從概念圖萃取情境物件」</span>
      </div>
    </form>
  );
}

export function ProcessNextButton({ count, scenarioId }: { count: number; scenarioId?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending || count === 0}
      onClick={() => start(async () => { await processNextAction(scenarioId); })}
      className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
    >
      {pending ? "排入中…" : `▶ 生成全部待生成（${count}）`}
    </button>
  );
}

export function Batch3dButton({ scenarioId, count }: { scenarioId?: string; count: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending || count === 0}
      onClick={() => { if (confirm(`批量製作 ${count} 個 3D 模型？（背景生成，每個約 1–2 分）`)) start(async () => { await batch3dAction(scenarioId); }); }}
      className="rounded bg-cyan-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
    >
      {pending ? "排入中…" : `🧊 批量製作 3D（${count}）`}
    </button>
  );
}

export function ExtractObjectsButton({ scenarioId, hasConcept, count }: { scenarioId: string; hasConcept: boolean; count: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        disabled={pending || !hasConcept}
        title={hasConcept ? "用 AI 視覺讀概念圖，萃取畫面中的情境物件並估算佈局" : "請先生成概念圖"}
        onClick={() => start(async () => { const r = await extractObjectsAction(scenarioId); setMsg(`新增 ${r.added} 個情境物件`); })}
        className="rounded bg-teal-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "🔍 讀概念圖萃取中…" : count > 0 ? "↻ 再次從概念圖萃取" : "🔍 從概念圖萃取情境物件"}
      </button>
      {msg && <span className="text-xs text-teal-700">{msg}</span>}
    </span>
  );
}

export function ConceptButton({ scenarioId, has, status }: { scenarioId: string; has: boolean; status?: string }) {
  const [pending, start] = useTransition();
  const busy = status === "requested" || status === "generating";
  return (
    <button
      disabled={pending || busy}
      onClick={() => start(async () => { await generateConceptAction(scenarioId); })}
      className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
    >
      {busy ? "🎨 概念圖生成中…" : has ? "↻ 重生概念圖" : "🎨 生成概念圖 (Tom)"}
    </button>
  );
}

export function ReviewButtons({ id, scenarioId }: { id: string; scenarioId?: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2">
      <button disabled={pending} onClick={() => start(async () => { await approveAction(id, scenarioId); })}
        className="flex-1 rounded bg-green-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">✓ 通過上傳</button>
      <button disabled={pending} onClick={() => start(async () => { await rejectAction(id, scenarioId); })}
        className="flex-1 rounded bg-gray-500 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">✕ 退回重生</button>
    </div>
  );
}

export function RegenButton({ id, scenarioId }: { id: string; scenarioId?: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => start(async () => { await regenAction(id, scenarioId); })}
      className="rounded border border-gray-400 px-2 py-1 text-xs font-medium text-gray-600 disabled:opacity-50">
      {pending ? "…" : "↻ 重生"}
    </button>
  );
}

export function RegenAllButton({ scenarioId }: { scenarioId: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending}
      onClick={() => { if (confirm("把此場景所有已上架/失敗的物件重設為待生成，用目前風格重生？")) start(async () => { await regenSceneAction(scenarioId); }); }}
      className="rounded border border-orange-500 px-3 py-1.5 text-xs font-medium text-orange-600 disabled:opacity-50">
      {pending ? "重設中…" : "↻ 全部重生"}
    </button>
  );
}

export function GenerateButton({ id, scenarioId, label = "▶ 生成此物件" }: { id: string; scenarioId?: string; label?: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => start(async () => { await generateAssetAction(id, scenarioId); })}
      className="w-full rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
      {pending ? "生成中…（約 15s）" : label}
    </button>
  );
}

export function AddObjectForm({ scenarioId, type, label }: { scenarioId: string; type: "scene_object" | "keyword"; label: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const [dup, setDup] = useState<{ matches: KeywordMatch[]; resolved: { en: string; zh: string; subject: string } } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const handle = (r: AddObjectResult) => {
    if (r.status === "added") { setMsg({ kind: "ok", text: `已加入「${r.name}」` }); setDup(null); formRef.current?.reset(); }
    else if (r.status === "duplicate") { setMsg(null); setDup({ matches: r.matches, resolved: r.resolved }); }
    else if (r.status === "exists") setMsg({ kind: "warn", text: "此物件已存在，未重複新增。" });
    else if (r.status === "empty") setMsg({ kind: "warn", text: "請至少填中文名或英文名。" });
    else setMsg({ kind: "err", text: `操作失敗：${r.message ?? "未知錯誤"}` });
  };

  const forceAdd = () => {
    if (!dup) return;
    start(async () => {
      const fd = new FormData();
      fd.set("scenarioId", scenarioId); fd.set("type", type); fd.set("force", "1");
      fd.set("nameEn", dup.resolved.en); fd.set("nameZh", dup.resolved.zh); fd.set("subject", dup.resolved.subject);
      handle(await addObjectAction(fd));
    });
  };

  return (
    <div className="space-y-2">
      <form
        ref={formRef}
        action={(fd) => start(async () => handle(await addObjectAction(fd)))}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-gray-300 p-3"
      >
        <input type="hidden" name="scenarioId" value={scenarioId} />
        <input type="hidden" name="type" value={type} />
        <label className="text-xs text-gray-500">中文名<input name="nameZh" placeholder="微波爐" className="mt-0.5 block w-28 rounded border border-gray-300 px-2 py-1 text-sm" /></label>
        <label className="text-xs text-gray-500">英文名（留空 AI 翻譯）<input name="nameEn" placeholder="自動翻譯" className="mt-0.5 block w-32 rounded border border-gray-300 px-2 py-1 text-sm" /></label>
        <label className="text-xs text-gray-500">生圖描述（選填）<input name="subject" placeholder="留空 AI 自動產生" className="mt-0.5 block w-52 rounded border border-gray-300 px-2 py-1 text-sm" /></label>
        <button disabled={pending} className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{pending ? "處理中…" : `+ 新增${label}`}</button>
        {msg && (
          <span className={`w-full text-xs ${msg.kind === "ok" ? "text-green-600" : msg.kind === "warn" ? "text-amber-600" : "text-red-600"}`}>{msg.text}</span>
        )}
      </form>

      {dup && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="text-xs font-medium text-amber-800">
            已有「{dup.resolved.en}」相同關鍵字的物件（{dup.matches.length}）。要沿用既有，還是新增一個不同的變體？
          </div>
          <div className="flex flex-wrap gap-2">
            {dup.matches.map((m) => {
              const thumb = m.imageUrl ?? (m.status === "review" ? `/api/preview/${m.id}` : null);
              return (
                <div key={m.id} className="w-32 space-y-1 rounded border border-gray-200 bg-white p-1.5">
                  <div className="aspect-square w-full overflow-hidden rounded bg-gray-50">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt={m.nameEn} className="h-full w-full object-contain" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-gray-400">無圖</div>
                    )}
                  </div>
                  <div className="text-[11px] font-medium">{m.nameEn} <span className="text-gray-400">{m.nameZh}</span></div>
                  <div className="text-[10px] text-gray-400">{m.modelStatus === "done" ? "✓ 有 3D" : "無 3D"}</div>
                  <div className="text-[10px] text-gray-500">出現在：{m.scenes.length ? m.scenes.join("、") : "—"}</div>
                  <button disabled={pending}
                    onClick={() => start(async () => handle(await attachExistingAction(scenarioId, m.id)))}
                    className="w-full rounded bg-green-600 px-1 py-1 text-[11px] font-medium text-white disabled:opacity-50">
                    ✓ 在本場景使用
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button disabled={pending} onClick={forceAdd}
              className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              ＋ 仍要新增不同的「{dup.resolved.en}」
            </button>
            <button disabled={pending} onClick={() => setDup(null)}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 disabled:opacity-50">取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DeleteButton({ id, scenarioId, name }: { id: string; scenarioId?: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending}
      onClick={() => { if (confirm(`刪除物件「${name}」？此動作無法復原。`)) start(async () => { await deleteAssetAction(id, scenarioId); }); }}
      className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
      {pending ? "…" : "🗑 刪除"}
    </button>
  );
}

export function PromptEditor({ id, scenarioId, subject }: { id: string; scenarioId?: string; subject: string }) {
  const [pending, start] = useTransition();
  const [val, setVal] = useState(subject);
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-gray-500 hover:text-gray-700">✎ 編輯生圖描述</summary>
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
        placeholder="用中文或英文描述要畫的單一物件，例如：便利商店的直立式廣告立牌，上面有海報"
      />
      <button
        disabled={pending}
        onClick={() => start(async () => { await updatePromptAction(id, val, scenarioId); })}
        className="mt-1 rounded bg-pink-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "儲存中…" : "儲存並重生"}
      </button>
      <p className="mt-1 text-[10px] text-gray-400">儲存後設為「待生成」，按「生成下一個」即用新描述重生。風格後綴自動附加（見設定中心）。</p>
    </details>
  );
}

export function SideViewButton({ id, scenarioId, status, has }: { id: string; scenarioId?: string; status: string; has: boolean }) {
  const [pending, start] = useTransition();
  if (status === "requested" || status === "generating") {
    return <span className="rounded bg-violet-50 px-2 py-1 text-xs text-violet-600">🪞 側/背視圖生成中…</span>;
  }
  return (
    <span className="inline-flex gap-1">
      <button disabled={pending} onClick={() => start(async () => { await sideViewAction(id, scenarioId); })}
        className="rounded border border-violet-500 px-2 py-1 text-xs font-medium text-violet-700 disabled:opacity-50">
        {pending ? "…" : has ? "🪞 重生側/背視圖" : "🪞 生成側/背視圖"}
      </button>
      {has && (
        <button disabled={pending} onClick={() => start(async () => { await clearSideViewAction(id, scenarioId); })}
          title="清除側視圖 → 此物件改用單圖做 3D"
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 disabled:opacity-50">
          ✕ 用單圖
        </button>
      )}
    </span>
  );
}

export function ReplanLayoutButton({ scenarioId, count }: { scenarioId: string; count: number }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending || count === 0}
      onClick={() => start(async () => { await replanLayoutAction(scenarioId); })}
      title="用 AI 把現有情境物件排進座標（不重生圖）"
      className="rounded border border-cyan-600 px-3 py-1.5 text-xs font-medium text-cyan-700 disabled:opacity-50">
      {pending ? "排佈局中…" : `🗺 重算佈局（${count}）`}
    </button>
  );
}

export function LayoutConceptButton({ scenarioId, has, count }: { scenarioId: string; has: boolean; count: number }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending || count === 0}
      onClick={() => start(async () => { await generateLayoutConceptAction(scenarioId); })}
      title="依佈局座標生成一張使用者視角的概念圖（約 30s）"
      className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
      {pending ? "🎨 依佈局生成中…（約 30s）" : has ? "↻ 重生佈局概念圖" : "🎨 依佈局生成概念圖"}
    </button>
  );
}

export function TopViewButton({ scenarioId, has, count }: { scenarioId: string; has: boolean; count: number }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending || count === 0}
      onClick={() => start(async () => { await generateTopViewAction(scenarioId); })}
      title="依佈局座標+概念圖生成一張俯瞰參考圖（約 30s）"
      className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
      {pending ? "🛰 生成上視圖中…（約 30s）" : has ? "↻ 重生上視圖" : "🛰 生成上視圖"}
    </button>
  );
}

export function DeleteSceneButton({ scenarioId, name }: { scenarioId: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending}
      onClick={() => { if (confirm(`刪除整個場景「${name}」及其所有物件、側視圖？此動作無法復原。`)) start(async () => { await deleteSceneAction(scenarioId); }); }}
      className="rounded border border-red-400 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
      {pending ? "刪除中…" : "🗑 刪除場景"}
    </button>
  );
}

export function Make3dButton({ id, scenarioId, status }: { id: string; scenarioId?: string; status: string }) {
  const [pending, start] = useTransition();
  if (status === "requested") return <span className="rounded bg-cyan-50 px-2 py-1 text-xs text-cyan-600">⏳ 已排入 3D</span>;
  if (status === "generating") return <span className="rounded bg-cyan-100 px-2 py-1 text-xs text-cyan-700">🧊 3D 生成中…</span>;
  const label = status === "done" ? "↻ 重做 3D" : status === "failed" ? "↻ 重做 3D（失敗）" : "🧊 製作 3D 模型";
  return (
    <button disabled={pending} onClick={() => start(async () => { await request3dAction(id, scenarioId); })}
      className="rounded border border-cyan-600 px-2 py-1 text-xs font-medium text-cyan-700 disabled:opacity-50">
      {pending ? "排入中…" : label}
    </button>
  );
}
