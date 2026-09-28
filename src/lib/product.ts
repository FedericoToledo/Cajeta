// Orientación del producto y análisis geométrico:
//  - reorienta los vértices según el eje elegido como "vertical" (+ giro en plano),
//  - calcula bounding box orientado,
//  - huella (convex hull de la proyección XY),
//  - secciones: convex hull de la sección a N alturas, para que el insert siga
//    la FORMA del producto (no sólo la silueta superior).
import { convexHull, translate, Pt } from "./polygon";

export type UpAxis = "x" | "y" | "z";

export interface Orientation {
  up: UpAxis; // qué eje del STL queda vertical (alto de la caja)
  rotateDeg: number; // giro del producto en el plano horizontal
  flip: boolean; // invertir arriba/abajo (180° sobre un eje horizontal)
}

/** Invierte arriba/abajo: 180° sobre un eje horizontal (según cuál sea el vertical). */
export function flipVertex(x: number, y: number, z: number, up: UpAxis): [number, number, number] {
  return up === "x" ? [-x, y, -z] : [x, -y, -z];
}

export interface ProductModel {
  x: number; // largo interior objetivo (eje X orientado)
  y: number; // ancho  (eje Y orientado)
  z: number; // alto   (eje vertical orientado)
  footprint: Pt[]; // contorno de la huella XY, centrado en (0,0)
  slices: Pt[][]; // contornos por altura (de abajo hacia arriba), centrados en (0,0)
}

/**
 * Reorienta un vértice: rotación propia (sin espejo) que lleva el eje elegido a Z.
 * Luego se aplica el giro en el plano (rotateDeg) sobre el resultado.
 */
function orientVertex(
  x: number,
  y: number,
  z: number,
  up: UpAxis
): [number, number, number] {
  switch (up) {
    case "z":
      return [x, y, z];
    case "y":
      // Rx(+90): (x,y,z) -> (x, -z, y)   [raw Y pasa a vertical]
      return [x, -z, y];
    case "x":
      // Ry(-90): (x,y,z) -> (-z, y, x)   [raw X pasa a vertical]
      return [-z, y, x];
  }
}

/** Análisis completo del producto para una orientación y cantidad de secciones. */
export function analyze(
  vertices: Float32Array,
  orientation: Orientation,
  sliceCount: number
): ProductModel {
  const n = vertices.length / 3;
  const rad = (orientation.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const xy: Pt[] = new Array(n);
  const zs = new Float32Array(n);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < n; i++) {
    let vx = vertices[i * 3], vy = vertices[i * 3 + 1], vz = vertices[i * 3 + 2];
    if (orientation.flip) [vx, vy, vz] = flipVertex(vx, vy, vz, orientation.up);
    const [ox, oy, oz] = orientVertex(vx, vy, vz, orientation.up);
    // Giro en el plano horizontal (sobre eje vertical Z orientado).
    const px = ox * cos - oy * sin;
    const py = ox * sin + oy * cos;
    xy[i] = [px, py];
    zs[i] = oz;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (oz < minZ) minZ = oz;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    if (oz > maxZ) maxZ = oz;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const H = maxZ - minZ || 1;

  // Huella global (todas las proyecciones), centrada.
  const footprint = centered(convexHull(xy), cx, cy);

  // Secciones por altura: para cada banda, hull de los XY cuyos Z caen dentro.
  const N = Math.max(1, Math.floor(sliceCount));
  const slices: Pt[][] = [];
  for (let k = 0; k < N; k++) {
    const zc = minZ + (H * (k + 0.5)) / N;
    const half = H / (2 * N);
    const band: Pt[] = [];
    for (let i = 0; i < n; i++) {
      if (Math.abs(zs[i] - zc) <= half) band.push(xy[i]);
    }
    const hull = convexHull(band);
    // Fallback: si la banda no da hull válido, usamos la huella global.
    const abs = hull.length >= 3 ? hull : translate(footprint, cx, cy);
    slices.push(centered(abs, cx, cy));
  }

  return {
    x: maxX - minX,
    y: maxY - minY,
    z: maxZ - minZ,
    footprint,
    slices,
  };
}

// Centra un polígono (en coords absolutas) restando el centro global (cx, cy).
function centered(poly: Pt[], cx: number, cy: number): Pt[] {
  return translate(poly, -cx, -cy);
}
