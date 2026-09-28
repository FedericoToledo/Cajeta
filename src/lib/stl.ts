// Parseo de STL (binario o ASCII). Devuelve los vértices crudos y metadatos.
// La orientación, bounding box orientado y secciones se calculan en product.ts.

export interface ParsedSTL {
  vertices: Float32Array; // [x,y,z, x,y,z, ...] en coordenadas del STL (mm)
  triangles: number;
  // Bounding box crudo (sin orientar), útil para info rápida.
  size: [number, number, number];
}

/** Detecta si el ArrayBuffer es un STL binario. */
function isBinary(buffer: ArrayBuffer): boolean {
  const HEADER = 80;
  if (buffer.byteLength < HEADER + 4) return false;
  const view = new DataView(buffer);
  const nTriangles = view.getUint32(HEADER, true);
  const expected = HEADER + 4 + nTriangles * 50;
  if (expected === buffer.byteLength) return true;
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, 5)).toLowerCase();
  return head !== "solid";
}

function parseBinary(buffer: ArrayBuffer): ParsedSTL {
  const view = new DataView(buffer);
  const nTriangles = view.getUint32(80, true);
  const vertices = new Float32Array(nTriangles * 9);
  let offset = 84;
  let vi = 0;
  for (let i = 0; i < nTriangles; i++) {
    offset += 12; // saltar normal
    for (let v = 0; v < 3; v++) {
      vertices[vi++] = view.getFloat32(offset, true);
      vertices[vi++] = view.getFloat32(offset + 4, true);
      vertices[vi++] = view.getFloat32(offset + 8, true);
      offset += 12;
    }
    offset += 2; // attribute byte count
  }
  return finalize(vertices, nTriangles);
}

function parseAscii(text: string): ParsedSTL {
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  const coords: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    coords.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  return finalize(Float32Array.from(coords), Math.floor(coords.length / 9));
}

function finalize(vertices: Float32Array, triangles: number): ParsedSTL {
  if (vertices.length === 0) {
    throw new Error("El STL no contiene geometría válida.");
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    vertices,
    triangles,
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

/** Punto de entrada: recibe el ArrayBuffer del archivo STL. */
export function parseSTL(buffer: ArrayBuffer): ParsedSTL {
  if (isBinary(buffer)) return parseBinary(buffer);
  return parseAscii(new TextDecoder().decode(buffer));
}
