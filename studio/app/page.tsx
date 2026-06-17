import Link from "next/link";
import { sql, desc, eq, inArray, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CreateSceneForm, ProcessNextButton, AutoRefresh, Batch3dButton } from "./_components/Controls";
import { AssetCard } from "./_components/AssetCard";
import { ensureWorker } from "@/lib/worker";

export const dynamic = "force-dynamic";
const { asset, scenario } = schema;

async function getData() {
  ensureWorker();
  // Run all independent queries in parallel (one round-trip instead of nine).
  const [counts, scenarios, perScene, review, imgQueue, modelQueue, conceptQueue, b3rows, svrows] = await Promise.all([
    db.select({ status: asset.status, n: sql<number>`count(*)::int` }).from(asset).groupBy(asset.status),
    db.select().from(scenario).orderBy(desc(scenario.createdAt)),
    db
      .select({ scenarioId: asset.scenarioId, n: sql<number>`count(*)::int`, up: sql<number>`count(*) filter (where ${asset.status}='uploaded')::int` })
      .from(asset)
      .groupBy(asset.scenarioId),
    db.select().from(asset).where(eq(asset.status, "review")).orderBy(desc(asset.updatedAt)),
    db.select({ nameEn: asset.nameEn, status: asset.status }).from(asset).where(inArray(asset.status, ["queued", "generating"])).orderBy(asset.updatedAt),
    db.select({ nameEn: asset.nameEn, modelStatus: asset.modelStatus }).from(asset).where(inArray(asset.modelStatus, ["requested", "generating"])).orderBy(asset.updatedAt),
    db.select({ nameEn: scenario.nameEn }).from(scenario).where(inArray(scenario.conceptStatus, ["requested", "generating"])),
    db.select({ n: sql<number>`count(*)::int` }).from(asset).where(and(eq(asset.status, "uploaded"), eq(asset.modelStatus, "none"))),
    db.select({ n: sql<number>`count(*)::int` }).from(asset).where(inArray(asset.sideViewStatus, ["requested", "generating"])),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>;
  const sv = svrows[0];
  const busy = imgQueue.length + modelQueue.length + conceptQueue.length + (sv?.n ?? 0) > 0;

  return { byStatus, scenarios, perScene, review, busy, imgQueue, modelQueue, conceptQueue, batch3dCount: b3rows[0]?.n ?? 0 };
}

function StatPill({ label, n, color }: { label: string; n: number; color: string }) {
  return <div className={`rounded-lg px-4 py-3 ${color}`}><div className="text-2xl font-bold">{n ?? 0}</div><div className="text-xs opacity-80">{label}</div></div>;
}

export default async function Home() {
  const { byStatus, scenarios, perScene, review, busy, imgQueue, modelQueue, conceptQueue, batch3dCount } = await getData();
  const counts = new Map(perScene.map((p) => [p.scenarioId, p]));

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AR Assets Studio</h1>
          <p className="text-sm text-gray-500">場域 → AI 物件清單 → 生圖 → 審核 → LiG 素材庫</p>
        </div>
        <div className="flex gap-2">
          <a href="/api/feed" target="_blank" rel="noreferrer" className="rounded border border-gray-300 px-3 py-1.5 text-sm">🔗 JSON Feed</a>
          <Link href="/settings" className="rounded border border-gray-300 px-3 py-1.5 text-sm">⚙ 設定中心</Link>
        </div>
      </header>

      <section className="space-y-3">
        <CreateSceneForm />
        <div className="grid grid-cols-5 gap-3">
          <StatPill label="待生成" n={byStatus.pending} color="bg-amber-100 text-amber-800" />
          <StatPill label="生成中" n={(byStatus.queued ?? 0) + (byStatus.generating ?? 0)} color="bg-blue-100 text-blue-800" />
          <StatPill label="待審" n={byStatus.review} color="bg-fuchsia-100 text-fuchsia-800" />
          <StatPill label="已上架" n={byStatus.uploaded} color="bg-green-100 text-green-800" />
          <StatPill label="失敗" n={byStatus.failed} color="bg-red-100 text-red-700" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ProcessNextButton count={byStatus.pending ?? 0} />
          <Batch3dButton count={batch3dCount} />
          <AutoRefresh active={busy} />
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
          <div className="mb-1 font-medium text-gray-600">生成佇列</div>
          {imgQueue.length === 0 && modelQueue.length === 0 && conceptQueue.length === 0 ? (
            <div className="text-gray-400">佇列空閒。按「生成全部待生成」或物件的生成鈕開始。</div>
          ) : (
            <div className="space-y-1 text-gray-700">
              {conceptQueue.length > 0 && (
                <div>🎨 概念圖：{conceptQueue.map((c) => c.nameEn).join("、")}</div>
              )}
              {imgQueue.length > 0 && (
                <div>🖼 圖片：{imgQueue.map((q) => `${q.nameEn}${q.status === "generating" ? "（生成中）" : "（排隊）"}`).join("、")}</div>
              )}
              {modelQueue.length > 0 && (
                <div>🧊 3D：{modelQueue.map((q) => `${q.nameEn}${q.modelStatus === "generating" ? "（生成中）" : "（排隊）"}`).join("、")}</div>
              )}
            </div>
          )}
        </div>
      </section>

      {review.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">待審核（{review.length}）</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {review.map((a) => <AssetCard key={a.id} a={a} />)}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">場域（{scenarios.length}）</h2>
        {scenarios.length === 0 ? (
          <p className="text-sm text-gray-400">尚無場域。在上方輸入一個場域開始（例如 convenience store）。</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {scenarios.map((s) => {
              const c = counts.get(s.id);
              return (
                <Link key={s.id} href={`/scene/${s.id}`} className="block overflow-hidden rounded-lg border border-gray-200 hover:border-pink-400">
                  <div className="aspect-video w-full bg-gray-50">
                    {s.conceptImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.conceptImageUrl} alt={s.nameEn} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-gray-400">尚無概念圖</div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="font-medium">{s.nameEn} <span className="text-gray-400">{s.nameZh}</span></div>
                    <div className="text-xs text-gray-500">物件 {c?.n ?? 0}・已上架 {c?.up ?? 0}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
