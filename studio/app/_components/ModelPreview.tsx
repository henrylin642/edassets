"use client";

import { useRef, useState, useTransition } from "react";
import { saveModelYawAction } from "../actions";

/**
 * 3D preview with a facing-correction slider. Tripo models don't reliably face +Z,
 * so the admin rotates the model about Y (the slider / ±90 buttons) until its front
 * faces the fixed front camera; the value auto-saves as model_yaw and is exposed in
 * the feed for the AR client. Camera drag only inspects other sides (not saved).
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
  const norm = (v: number) => ((Math.round(v) % 360) + 360) % 360;
  const [yaw, setYaw] = useState(norm(initialYaw));
  const [saved, setSaved] = useState(norm(initialYaw));
  const [pending, start] = useTransition();
  const yawRef = useRef(yaw);

  const setY = (y: number) => {
    const n = norm(y);
    yawRef.current = n;
    setYaw(n);
  };
  // Persist the current yaw. Called on slider release / button press → "adjust = saved".
  const commit = () =>
    start(async () => {
      const y = yawRef.current;
      await saveModelYawAction(id, y, scenarioId);
      setSaved(y);
    });
  const bump = (d: number) => { setY(yaw + d); commit(); };

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
          onChange={(e) => setY(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          className="flex-1"
          title="拖曳讓模型正面朝向鏡頭（放開即自動儲存）"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button className={`${btn} border-gray-300 text-gray-600`} onClick={() => bump(-90)}>−90°</button>
        <button className={`${btn} border-gray-300 text-gray-600`} onClick={() => bump(90)}>+90°</button>
        <button className={`${btn} border-gray-300 text-gray-500`} onClick={() => { setY(0); commit(); }}>歸零</button>
        <span className="ml-auto text-[10px]">
          {pending ? <span className="text-gray-400">儲存中…</span> : saved === yaw ? <span className="text-green-600">✓ 已儲存 {saved}°</span> : <span className="text-amber-600">未儲存</span>}
        </span>
      </div>
      <div className="text-[10px] text-gray-400">用滑桿/±90 調整正面朝向（自動儲存）· 直接拖曳模型只是檢視其他面</div>
    </div>
  );
}
