import Link from "next/link";
import { getConfig } from "@/lib/settings";
import { saveSettingsAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const cfg = await getConfig();
  const field = "rounded border border-gray-300 px-3 py-2 text-sm";

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Link href="/" className="text-sm text-gray-500 hover:underline">← 返回</Link>
      <h1 className="text-2xl font-bold">設定中心</h1>
      <p className="text-sm text-gray-500">集中管理生圖風格與參數，套用到所有新生成。</p>

      <form action={saveSettingsAction} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">情境物件風格（寫實・沉浸感）</span>
          <textarea name="sceneStylePreset" defaultValue={cfg.sceneStylePreset} rows={2} className={`${field} w-full`} />
          <span className="text-xs text-gray-400">套用於 scene_object 與概念圖。寫實 PBR 質感增強沉浸感。</span>
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">關鍵字物件風格（風格化 3D）</span>
          <textarea name="keywordStylePreset" defaultValue={cfg.keywordStylePreset} rows={2} className={`${field} w-full`} />
          <span className="text-xs text-gray-400">套用於 keyword 物件。乾淨風格化 3D render；避免「smooth clay texture」會糊團。</span>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium">尺寸</span>
            <select name="imageSize" defaultValue={cfg.imageSize} className={`${field} w-full`}>
              <option value="1024x1024">1024×1024</option>
              <option value="1024x1536">1024×1536</option>
              <option value="1536x1024">1536×1024</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">品質</span>
            <select name="imageQuality" defaultValue={cfg.imageQuality} className={`${field} w-full`}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">背景</span>
            <select name="background" defaultValue={cfg.background} className={`${field} w-full`}>
              <option value="opaque">白底 opaque</option>
              <option value="transparent">透明 transparent</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">每類物件數</span>
            <input type="number" name="objectsPerCategory" defaultValue={cfg.objectsPerCategory} min={1} max={20} className={`${field} w-full`} />
          </label>
        </div>

        <fieldset className="space-y-3 rounded-lg border border-gray-200 p-4">
          <legend className="px-1 text-sm font-medium">3D 模型（Tripo）— 控制檔案大小</legend>
          <div className="grid grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium">面數上限 face_limit</span>
              <input type="number" name="model3dFaceLimit" defaultValue={cfg.model3dFaceLimit} min={1000} max={300000} step={1000} className={`${field} w-full`} />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">貼圖解析度 (px)</span>
              <select name="model3dTextureSize" defaultValue={cfg.model3dTextureSize} className={`${field} w-full`}>
                <option value={512}>512</option>
                <option value={1024}>1024</option>
                <option value={2048}>2048</option>
                <option value={4096}>4096</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">貼圖品質</span>
              <select name="model3dTextureQuality" defaultValue={cfg.model3dTextureQuality} className={`${field} w-full`}>
                <option value="standard">standard（小）</option>
                <option value="detailed">detailed（大）</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" name="model3dPbr" defaultChecked={cfg.model3dPbr} /> 啟用 PBR 材質（關閉可縮小檔案）
            </label>
          </div>
          <p className="text-xs text-gray-400">目標 1–3MB：面數 ≤ 30000 + 貼圖 512 + standard。檔案仍偏大時可關閉 PBR。</p>
        </fieldset>

        <div className="text-xs text-gray-400">生圖模型：{cfg.gptImageModel}・命名模型：{cfg.namingModel}（於 .env 調整）</div>
        <button className="rounded bg-pink-600 px-4 py-2 text-sm font-medium text-white">儲存設定</button>
      </form>
    </main>
  );
}
