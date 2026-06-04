/** Lightweight metric extraction for generated assets (no deps). */

/** Read PNG pixel dimensions from the IHDR chunk. */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  // PNG signature (8 bytes) then IHDR: len(4)+"IHDR"(4)+width(4 BE)+height(4 BE)
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Count triangles (faces) in a binary GLB by parsing its JSON chunk + accessors.
 * Sums indices/3 per primitive (or POSITION count/3 for non-indexed).
 */
export function glbFaceCount(buf: Buffer): number | null {
  try {
    if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return null; // 'glTF'
    const jsonLen = buf.readUInt32LE(12);
    const jsonType = buf.readUInt32LE(16);
    if (jsonType !== 0x4e4f534a) return null; // 'JSON'
    const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen)) as {
      meshes?: { primitives?: { indices?: number; attributes?: Record<string, number> }[] }[];
      accessors?: { count?: number }[];
    };
    const accessors = json.accessors ?? [];
    let tris = 0;
    for (const mesh of json.meshes ?? []) {
      for (const p of mesh.primitives ?? []) {
        const idx = p.indices;
        if (typeof idx === "number" && accessors[idx]?.count) {
          tris += Math.floor((accessors[idx].count as number) / 3);
        } else if (p.attributes?.POSITION != null && accessors[p.attributes.POSITION]?.count) {
          tris += Math.floor((accessors[p.attributes.POSITION].count as number) / 3);
        }
      }
    }
    return tris || null;
  } catch {
    return null;
  }
}

/** Bytes → MB string, e.g. 3.21 */
export function toMB(bytes: number | null | undefined): number | null {
  return bytes ? Math.round((bytes / 1048576) * 100) / 100 : null;
}
