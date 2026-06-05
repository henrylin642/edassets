import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ConceptButton, ProcessNextButton, RegenAllButton, AddObjectForm, AutoRefresh, Batch3dButton, DeleteSceneButton, ReplanLayoutButton } from "@/app/_components/Controls";
import { AssetCard } from "@/app/_components/AssetCard";
import { LayoutMap } from "@/app/_components/LayoutMap";
import { SceneViewer } from "@/app/_components/SceneViewer";
import { ensureWorker } from "@/lib/worker";
import { getConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";
const { asset, scenario } = schema;

export default async function ScenePage({ params }: { params: Promise<{ id: string }> }) {
  ensureWorker();
  const { id } = await params;
  const sc = (await db.select().from(scenario).where(eq(scenario.id, id)))[0];
  if (!sc) notFound();

  const config = await getConfig();
  const assets = await db.select().from(asset).where(eq(asset.scenarioId, id)).orderBy(asc(asset.nameEn));
  const sceneObjects = assets.filter((a) => a.type === "scene_object");
  const keywordObjects = assets.filter((a) => a.type === "keyword");
  const pending = assets.filter((a) => a.status === "pending").length;
  const no3d = assets.filter((a) => a.status === "uploaded" && a.modelStatus === "none").length;
  const busy =
    assets.some(
      (a) =>
        ["queued", "generating"].includes(a.status) ||
        ["requested", "generating"].includes(a.modelStatus) ||
        ["requested", "generating"].includes(a.sideViewStatus),
    ) || ["requested", "generating"].includes(sc.conceptStatus);

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <Link href="/" className="text-sm text-gray-500 hover:underline">← 返回</Link>

      <header className="space-y-4">
        <div className="w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
          {sc.conceptImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sc.conceptImageUrl} alt={sc.nameEn} className="mx-auto max-h-[560px] w-full object-contain" />
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-gray-400">尚無概念圖（Tom）— 按下方「生成概念圖」</div>
          )}
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{sc.nameEn} <span className="text-gray-400">{sc.nameZh}</span></h1>
          <p className="text-sm leading-relaxed text-gray-600">{sc.conceptPrompt}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <ConceptButton scenarioId={sc.id} has={!!sc.conceptImageUrl} status={sc.conceptStatus} />
            <ProcessNextButton count={pending} scenarioId={sc.id} />
            <Batch3dButton scenarioId={sc.id} count={no3d} />
            <RegenAllButton scenarioId={sc.id} />
            <ReplanLayoutButton scenarioId={sc.id} count={sceneObjects.length} />
            <DeleteSceneButton scenarioId={sc.id} name={sc.nameEn} />
            <AutoRefresh active={busy} />
          </div>
          {sc.conceptImageUrl && (
            <div className="pt-1 text-[11px] text-gray-500">
              概念圖 asset_id: <span className="font-mono">{sc.conceptLigId}</span> ·{" "}
              <a href={sc.conceptImageUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">url</a>
            </div>
          )}
        </div>
      </header>

      <LayoutMap
        bounds={{ left: config.arLeft, right: config.arRight, front: config.arFront, back: config.arBack }}
        scenarioId={sc.id}
        conceptUrl={sc.layoutConceptUrl}
        objects={sceneObjects
          .filter((a) => a.placement)
          .map((a) => ({ name: a.nameEn, ...a.placement! }))}
      />

      {sceneObjects.some((a) => a.placement) && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">
            3D 場景預覽 <span className="text-sm font-normal text-gray-400">— 依座標擺放已生成的 GLB</span>
          </h2>
          <SceneViewer
            scenarioId={sc.id}
            bounds={{ left: config.arLeft, right: config.arRight, front: config.arFront, back: config.arBack }}
            objects={sceneObjects
              .filter((a) => a.placement)
              .map((a) => ({
                id: a.id,
                name: a.nameEn,
                modelUrl: a.modelStatus === "done" ? a.modelUrl : null,
                ...a.placement!,
              }))}
          />
        </section>
      )}

      <Section title="情境物件 scene objects" hint="維持沉浸感的場景道具" items={sceneObjects} scenarioId={id} type="scene_object" addLabel="情境物件" />
      <Section title="關鍵字物件 keyword objects" hint="用戶練習用的關鍵字實物" items={keywordObjects} scenarioId={id} type="keyword" addLabel="關鍵字物件" />
    </main>
  );
}

function Section({ title, hint, items, scenarioId, type, addLabel }: {
  title: string; hint: string; items: (typeof schema.asset.$inferSelect)[];
  scenarioId: string; type: "scene_object" | "keyword"; addLabel: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title} <span className="text-sm font-normal text-gray-400">— {hint}（{items.length}）</span></h2>
      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {items.map((a) => <AssetCard key={a.id} a={a} />)}
        </div>
      )}
      <AddObjectForm scenarioId={scenarioId} type={type} label={addLabel} />
    </section>
  );
}
