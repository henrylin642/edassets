"use client";

/**
 * 3D preview + editor of the AR scene. Each object is wrapped in a "holder"
 * Group whose transform IS its placement: position=(x,y,z) meters, rotation.y
 * = rotationY, uniform scale = sizeM (the model inside is normalized to 1m tall,
 * XZ-centered, base on y=0). So editing the holder maps straight back to placement.
 *
 * Coords match the layout map / feed: +X right, +Z toward the camera/user,
 * Tom at origin facing +Z. y = elevation above the floor (0 = on floor).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { savePlacementsAction } from "../actions";

export type ViewerObject = {
  id: string;
  name: string;
  modelUrl?: string | null;
  x: number;
  z: number;
  y?: number;
  rotationY: number;
  sizeM: number;
};
type Sel = { id: string; name: string; x: number; y: number; z: number; rotationY: number; sizeM: number };
type SaveItem = { id: string; placement: { x: number; y: number; z: number; rotationY: number; sizeM: number } };

const deg = (r: number) => ((THREE.MathUtils.radToDeg(r) % 360) + 360) % 360;

export function SceneViewer({
  scenarioId,
  bounds,
  objects,
}: {
  scenarioId: string;
  bounds: { left: number; right: number; front: number; back: number };
  objects: ViewerObject[];
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const total = objects.filter((o) => o.modelUrl).length;
  const [status, setStatus] = useState({ loaded: 0, failed: 0 });
  const [edit, setEdit] = useState(false);
  const [mode, setMode] = useState<"translate" | "rotate">("translate");
  const [sel, setSel] = useState<Sel | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // imperative API set up inside the three.js effect, called from React handlers
  const api = useRef<{
    setMode: (m: "translate" | "rotate") => void;
    setEdit: (on: boolean) => void;
    apply: (patch: Partial<Sel>) => void;
    collect: () => SaveItem[];
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;

    const { left, right, front, back } = bounds;
    const width = mount.clientWidth || 800;
    const height = 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1020);
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(right - left, 4.5, front + 3.5);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0.8, 0);
    orbit.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight.position.set(3, 8, 5);
    scene.add(dirLight);

    // floor + grid + axes
    const cx = (right - left) / 2;
    const cz = (front - back) / 2;
    const w = left + right;
    const d = front + back;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    scene.add(floor);
    const grid = new THREE.GridHelper(Math.max(w, d), Math.max(w, d), 0x3b82f6, 0x1e293b);
    grid.position.set(cx, 0.01, cz);
    scene.add(grid);
    scene.add(new THREE.AxesHelper(1));

    // Tom marker
    const tom = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.2, 6, 12), new THREE.MeshStandardMaterial({ color: 0xec4899 }));
    body.position.y = 0.85;
    tom.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0xec4899 }));
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.4, 0.35);
    tom.add(nose);
    scene.add(tom);

    // holders (one per object); transform = placement
    const holders: THREE.Group[] = [];
    const makeHolder = (o: ViewerObject) => {
      const holder = new THREE.Group();
      holder.position.set(o.x, o.y ?? 0, o.z);
      holder.rotation.y = THREE.MathUtils.degToRad(o.rotationY);
      holder.scale.setScalar(o.sizeM);
      holder.userData = { assetId: o.id, name: o.name };
      scene.add(holder);
      holders.push(holder);
      return holder;
    };
    const addUnitBox = (holder: THREE.Group) => {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 1, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.28 }),
      );
      box.position.y = 0.5; // base on holder origin
      holder.add(box);
    };

    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    for (const o of objects) {
      const holder = makeHolder(o);
      if (!o.modelUrl) {
        addUnitBox(holder);
        continue;
      }
      loader.load(
        o.modelUrl,
        (gltf) => {
          if (disposed) return;
          const root = gltf.scene;
          const bbox = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();
          bbox.getSize(size);
          root.scale.setScalar(1 / (size.y || 1)); // normalize to 1m tall
          const b2 = new THREE.Box3().setFromObject(root);
          const c2 = new THREE.Vector3();
          b2.getCenter(c2);
          root.position.x -= c2.x;
          root.position.z -= c2.z;
          root.position.y -= b2.min.y; // base at holder origin (y=0)
          holder.add(root);
          setStatus((s) => ({ ...s, loaded: s.loaded + 1 }));
        },
        undefined,
        () => {
          if (disposed) return;
          addUnitBox(holder);
          setStatus((s) => ({ ...s, failed: s.failed + 1 }));
        },
      );
    }

    // selection + transform gizmo
    const boxHelper = new THREE.BoxHelper(new THREE.Object3D(), 0xfbbf24);
    boxHelper.visible = false;
    scene.add(boxHelper);
    const control = new TransformControls(camera, renderer.domElement);
    control.setSpace("local");
    control.setMode("translate");
    const gizmo = control.getHelper();
    scene.add(gizmo);
    let selected: THREE.Group | null = null;
    let editing = false;

    const pushSel = () => {
      if (!selected) return setSel(null);
      setSel({
        id: selected.userData.assetId,
        name: selected.userData.name,
        x: +selected.position.x.toFixed(2),
        y: +selected.position.y.toFixed(2),
        z: +selected.position.z.toFixed(2),
        rotationY: Math.round(deg(selected.rotation.y)),
        sizeM: +selected.scale.x.toFixed(2),
      });
    };
    const select = (h: THREE.Group | null) => {
      selected = h;
      if (h) {
        control.attach(h);
        boxHelper.setFromObject(h);
        boxHelper.visible = true;
      } else {
        control.detach();
        boxHelper.visible = false;
      }
      pushSel();
    };
    control.addEventListener("dragging-changed", (e) => {
      orbit.enabled = !e.value;
    });
    control.addEventListener("objectChange", () => {
      if (selected) boxHelper.setFromObject(selected);
      pushSel();
      setDirty(true);
    });

    const raycaster = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    const onDown = (e: PointerEvent) => {
      if (!editing || control.dragging) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ptr, camera);
      const hits = raycaster.intersectObjects(holders, true);
      if (hits.length === 0) return select(null);
      let obj: THREE.Object3D | null = hits[0].object;
      while (obj && !obj.userData?.assetId) obj = obj.parent;
      select((obj as THREE.Group) ?? null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);

    api.current = {
      setMode: (m) => control.setMode(m),
      setEdit: (on) => {
        editing = on;
        control.enabled = on;
        gizmo.visible = on;
        if (!on) select(null);
      },
      apply: (patch) => {
        if (!selected) return;
        if (patch.x !== undefined) selected.position.x = patch.x;
        if (patch.y !== undefined) selected.position.y = patch.y;
        if (patch.z !== undefined) selected.position.z = patch.z;
        if (patch.rotationY !== undefined) selected.rotation.y = THREE.MathUtils.degToRad(patch.rotationY);
        if (patch.sizeM !== undefined) selected.scale.setScalar(patch.sizeM);
        boxHelper.setFromObject(selected);
        pushSel();
        setDirty(true);
      },
      collect: () =>
        holders.map((h) => ({
          id: h.userData.assetId,
          placement: {
            x: +h.position.x.toFixed(3),
            y: +h.position.y.toFixed(3),
            z: +h.position.z.toFixed(3),
            rotationY: Math.round(deg(h.rotation.y)),
            sizeM: +h.scale.x.toFixed(3),
          },
        })),
    };
    control.enabled = false;
    gizmo.visible = false;

    let raf = 0;
    const animate = () => {
      orbit.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      const wn = mount.clientWidth || width;
      camera.aspect = wn / height;
      camera.updateProjectionMatrix();
      renderer.setSize(wn, height);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      api.current = null;
      control.detach();
      control.dispose();
      orbit.dispose();
      draco.dispose();
      renderer.dispose();
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [bounds, objects]);

  // push React UI state → three.js
  useEffect(() => { api.current?.setEdit(edit); }, [edit]);
  useEffect(() => { api.current?.setMode(mode); }, [mode]);

  const save = async () => {
    const items = api.current?.collect() ?? [];
    if (items.length === 0) return;
    setSaving(true);
    try {
      await savePlacementsAction(scenarioId, items);
      setDirty(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const slider = (label: string, key: keyof Sel, min: number, max: number, step: number) =>
    sel && (
      <label className="flex items-center gap-2 text-xs">
        <span className="w-10 text-gray-500">{label}</span>
        <input type="range" min={min} max={max} step={step} value={sel[key] as number}
          onChange={(e) => api.current?.apply({ [key]: Number(e.target.value) })} className="flex-1" />
        <span className="w-12 text-right font-mono text-gray-600">{sel[key]}</span>
      </label>
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setEdit((v) => !v)}
          className={`rounded px-3 py-1.5 text-xs font-medium ${edit ? "bg-amber-600 text-white" : "border border-gray-400 text-gray-600"}`}>
          {edit ? "✓ 編輯中（點物件選取）" : "✎ 編輯佈局"}
        </button>
        {edit && (
          <>
            <div className="inline-flex overflow-hidden rounded border border-gray-300 text-xs">
              <button onClick={() => setMode("translate")} className={`px-2 py-1 ${mode === "translate" ? "bg-indigo-600 text-white" : "text-gray-600"}`}>移動</button>
              <button onClick={() => setMode("rotate")} className={`px-2 py-1 ${mode === "rotate" ? "bg-indigo-600 text-white" : "text-gray-600"}`}>旋轉</button>
            </div>
            <button disabled={!dirty || saving} onClick={save}
              className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {saving ? "儲存中…" : dirty ? "💾 儲存佈局" : "已儲存"}
            </button>
            {dirty && <span className="text-xs text-amber-600">● 未儲存</span>}
          </>
        )}
      </div>

      {edit && sel && (
        <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2">
          <div className="text-xs font-medium text-amber-800">選取：{sel.name}</div>
          {slider("大小", "sizeM", 0.1, 4, 0.05)}
          {slider("高度", "y", 0, 3, 0.05)}
          {slider("角度", "rotationY", 0, 360, 5)}
          <div className="flex gap-2 pt-1">
            <button onClick={() => api.current?.apply({ y: 0 })} className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600">放到地面</button>
            <button onClick={() => api.current?.apply({ y: 1.0 })} className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600">放到檯面 (1.0m)</button>
          </div>
        </div>
      )}

      <div ref={mountRef} className="w-full overflow-hidden rounded-lg border border-gray-200" style={{ height: 480 }} />
      <div className="text-[11px] text-gray-400">
        拖曳旋轉・滾輪縮放。粉紅膠囊=Tom（錐尖朝使用者 +Z）。已載入 3D：{status.loaded}/{total}
        {status.failed ? `・失敗 ${status.failed}` : ""}・半透明藍框=尚無 3D 佔位。
        {edit ? "　點選物件 → 用 gizmo 拖移/旋轉或下方滑桿調整 → 儲存。" : ""}
      </div>
    </div>
  );
}
