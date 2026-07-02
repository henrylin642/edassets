"use client";

import { useState, useTransition } from "react";
import { saveModelYawAction } from "../actions";

/**
 * 3D preview with a facing-correction slider. Tripo models don't reliably face +Z,
 * so the admin rotates the model about Y until its front faces the camera; the value
 * is saved as model_yaw and exposed in the feed for the AR client to apply.
 * Fixed front camera (no auto-rotate) so the correction is judged consistently.
 */
export function ModelPreview({
  id,
  scenarioId,
  modelUrl,
  initialYaw,
}: {
  id: string;
  scenarioId?: string;
  modelUrl: string;
  initialYaw: number;
}) {
  const norm = (v: number) => ((v % 360) + 360) % 360;
  const [yaw, setYaw] = useState(norm(initialYaw));
  const [saved, setSaved] = useState(norm(initialYaw));
  const [pending, start] = useTransition();
  const dirty = yaw !== saved;

  const save = () =>
    start(async () => {
      await saveModelYawAction(id, yaw, scenarioId);
      setSaved(yaw);
    });

  const btn = "rounded border px-1.5 py-0.5 text-[10px] disabled:opacity-40";

  return (
    <div className="space-y-1">
      {/* @ts-expect-error model-viewer is a web component */}
      <model-viewer
        src={modelUrl}
        camera-controls
        disable-zoom
        interaction-prompt="none"
        camera-orbit="0deg 80deg auto"
        orientation={`0deg 0deg ${yaw}deg`}
        style={{ width: "100%", height: "140px", backgroundColor: "#f3f4f6" }}
      />
      <div className="flex items-center gap-1">
        <span className="w-14 shrink-0 text-[10px] text-gray-500">朝向 {yaw}°</span>
        <input
          type="range"
          min={0}
          max={360}
          step={5}
          value={yaw}
          onChange={(e) => setYaw(Number(e.target.value))}
          className="flex-1"
          title="拖曳讓模型正面朝向鏡頭（AR 用）"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button className={`${btn} border-gray-300 text-gray-600`} onClick={() => setYaw((y) => norm(y - 90))}>−90°</button>
        <button className={`${btn} border-gray-300 text-gray-600`} onClick={() => setYaw((y) => norm(y + 90))}>+90°</button>
        <button className={`${btn} border-gray-300 text-gray-500`} onClick={() => setYaw(0)}>歸零</button>
        <button
          disabled={pending || !dirty}
          onClick={save}
          className={`${btn} ml-auto border-pink-500 font-medium text-pink-600`}
        >
          {pending ? "儲存中…" : dirty ? "💾 儲存朝向" : "✓ 已儲存"}
        </button>
      </div>
    </div>
  );
}
