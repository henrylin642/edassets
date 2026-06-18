/**
 * Top-down floor plan of the AR scene space (server component, pure SVG).
 * World: meters, Unity left-handed. Tom at origin (0,0) facing +Z (the user).
 * Drawn as a floor plan: +X to the right, +Z (front/user) toward the BOTTOM.
 */
import { LayoutConceptButton, TopViewButton } from "./Controls";

type Obj = { name: string; x: number; z: number; rotationY: number; sizeM: number };

export function LayoutMap({
  bounds,
  objects,
  scenarioId,
  conceptUrl,
  topViewUrl,
}: {
  bounds: { left: number; right: number; front: number; back: number };
  objects: Obj[];
  scenarioId: string;
  conceptUrl?: string | null;
  topViewUrl?: string | null;
}) {
  if (objects.length === 0) return null;

  const { left, right, front, back } = bounds;
  const scale = 38; // px per meter
  const pad = 28; // px margin for axis labels
  const W = (left + right) * scale;
  const H = (front + back) * scale;
  // world (x,z) → svg (px); +z drawn downward so the user/front is at the bottom
  const sx = (x: number) => pad + (x + left) * scale;
  const sy = (z: number) => pad + (back + z) * scale; // z=-back → top, z=+front → bottom
  const ox = sx(0);
  const oz = sy(0);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          擺位佈局 <span className="text-sm font-normal text-gray-400">— 俯視圖（公尺，Tom 在原點面向使用者）（{objects.length}）</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <LayoutConceptButton scenarioId={scenarioId} has={!!conceptUrl} count={objects.length} />
          <TopViewButton scenarioId={scenarioId} has={!!topViewUrl} count={objects.length} />
        </div>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row">
      <div className="overflow-auto rounded-lg border border-gray-200 bg-white p-2">
        <svg width={W + pad * 2} height={H + pad * 2} className="text-gray-600">
          {/* space bounds */}
          <rect x={pad} y={pad} width={W} height={H} fill="#f8fafc" stroke="#cbd5e1" />
          {/* axes through Tom */}
          <line x1={pad} y1={oz} x2={pad + W} y2={oz} stroke="#e2e8f0" />
          <line x1={ox} y1={pad} x2={ox} y2={pad + H} stroke="#e2e8f0" />
          {/* edge labels */}
          <text x={pad + W / 2} y={pad + H + 18} textAnchor="middle" fontSize="11" fill="#64748b">前方 / 使用者 +Z（{front}m）</text>
          <text x={pad + W / 2} y={pad - 10} textAnchor="middle" fontSize="11" fill="#64748b">後方 −Z（{back}m）</text>
          <text x={10} y={pad + H / 2} fontSize="11" fill="#64748b" transform={`rotate(-90 10 ${pad + H / 2})`} textAnchor="middle">左 −X（{left}m）</text>
          <text x={pad + W + 16} y={pad + H / 2} fontSize="11" fill="#64748b" transform={`rotate(90 ${pad + W + 16} ${pad + H / 2})`} textAnchor="middle">右 +X（{right}m）</text>

          {/* objects */}
          {objects.map((o, i) => {
            const cx = sx(o.x);
            const cy = sy(o.z);
            const r = Math.max(6, Math.min(22, o.sizeM * 9));
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={r} fill="#22d3ee33" stroke="#0891b2" />
                <text x={cx} y={cy - r - 2} textAnchor="middle" fontSize="10" fill="#0e7490">{o.name}</text>
                <text x={cx} y={cy + 3} textAnchor="middle" fontSize="8" fill="#155e75">{o.sizeM}m</text>
              </g>
            );
          })}

          {/* Tom at origin, facing +Z (down) */}
          <circle cx={ox} cy={oz} r={9} fill="#ec4899" stroke="#be185d" />
          <polygon points={`${ox - 5},${oz + 9} ${ox + 5},${oz + 9} ${ox},${oz + 18}`} fill="#ec4899" />
          <text x={ox + 12} y={oz + 4} fontSize="11" fontWeight="bold" fill="#be185d">Tom</text>
        </svg>
      </div>
        {conceptUrl && (
          <div className="flex-1 space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={conceptUrl} alt="layout concept" className="w-full rounded-lg border border-gray-200 object-contain" />
            <div className="text-[11px] text-gray-400">依佈局生成的概念圖（使用者視角，gpt-image 近似擺位，非公分級精準）</div>
          </div>
        )}
        {topViewUrl && (
          <div className="flex-1 space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={topViewUrl} alt="top view" className="w-full rounded-lg border border-gray-200 object-contain" />
            <div className="text-[11px] text-gray-400">依佈局生成的上視圖（俯瞰參考，gpt-image 近似）</div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-gray-400">圓圈大小 ≈ 物件實高；座標寫進 /api/feed 的 placement，供 Unity (AR Foundation) 端擺放。</p>
    </section>
  );
}
