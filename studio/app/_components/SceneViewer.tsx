"use client";

/**
 * 3D preview of the AR scene: loads each object's GLB and places it at its
 * placement coordinates (meters) around Tom at the origin. three.js + OrbitControls.
 *
 * Coords: same numbers as the layout map / feed. World = three.js right-handed,
 * Y up; +X right, +Z toward the camera/user (Tom at origin faces +Z).
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type ViewerObject = {
  name: string;
  modelUrl?: string | null;
  x: number;
  z: number;
  rotationY: number;
  sizeM: number;
};

export function SceneViewer({
  bounds,
  objects,
}: {
  bounds: { left: number; right: number; front: number; back: number };
  objects: ViewerObject[];
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState({ loaded: 0, failed: 0, total: objects.filter((o) => o.modelUrl).length });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;

    const { left, right, front, back } = bounds;
    const width = mount.clientWidth || 800;
    const height = 460;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1020);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(right - left, 4.5, front + 3.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.8, 0);
    controls.enableDamping = true;

    // lights
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(3, 8, 5);
    scene.add(dir);

    // floor: bounds rectangle + grid, centered on the actual box
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

    // axes hint at Tom (X red, Z blue)
    scene.add(new THREE.AxesHelper(1));

    // Tom marker: capsule body + cone facing +Z (toward the user)
    const tom = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.25, 1.2, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0xec4899 }),
    );
    body.position.y = 0.85;
    tom.add(body);
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.3, 12),
      new THREE.MeshStandardMaterial({ color: 0xec4899 }),
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.4, 0.35);
    tom.add(nose);
    scene.add(tom);

    // load objects
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    const loaded: THREE.Object3D[] = [];

    const placeBox = (o: ViewerObject) => {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, o.sizeM, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.25, wireframe: false }),
      );
      box.position.set(o.x, o.sizeM / 2, o.z);
      box.rotation.y = THREE.MathUtils.degToRad(o.rotationY);
      scene.add(box);
    };

    for (const o of objects) {
      if (!o.modelUrl) {
        placeBox(o);
        continue;
      }
      loader.load(
        o.modelUrl,
        (gltf) => {
          if (disposed) return;
          const root = gltf.scene;
          // scale so the model's height == sizeM, then sit it on the floor at (x,z)
          const bbox = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();
          bbox.getSize(size);
          const h = size.y || 1;
          const s = o.sizeM / h;
          root.scale.setScalar(s);
          const bbox2 = new THREE.Box3().setFromObject(root);
          const center = new THREE.Vector3();
          bbox2.getCenter(center);
          root.position.x += o.x - center.x;
          root.position.z += o.z - center.z;
          root.position.y += -bbox2.min.y; // rest on the ground
          root.rotation.y = THREE.MathUtils.degToRad(o.rotationY);
          scene.add(root);
          loaded.push(root);
          setStatus((st) => ({ ...st, loaded: st.loaded + 1 }));
        },
        undefined,
        () => {
          if (disposed) return;
          placeBox(o); // fall back to a slot box if the GLB fails
          setStatus((st) => ({ ...st, failed: st.failed + 1 }));
        },
      );
    }

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      const wNew = mount.clientWidth || width;
      camera.aspect = wNew / height;
      camera.updateProjectionMatrix();
      renderer.setSize(wNew, height);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
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

  return (
    <div className="space-y-1">
      <div ref={mountRef} className="w-full overflow-hidden rounded-lg border border-gray-200" style={{ height: 460 }} />
      <div className="text-[11px] text-gray-400">
        拖曳旋轉・滾輪縮放。粉紅膠囊=Tom（錐尖朝使用者 +Z）。已載入 3D：{status.loaded}/{status.total}
        {status.failed ? `・失敗 ${status.failed}` : ""}・半透明藍框=尚無 3D 的物件佔位。座標與 /api/feed 一致（Unity 端為最終精準擺放）。
      </div>
    </div>
  );
}
