// Decoración de la caja para grabado láser.
// Coloca imágenes (raster) sobre las caras del dieline PLANO (tapa top + costados
// de tapa y bandeja) y exporta un SVG en mm: líneas de corte/pliegue (vector) +
// imágenes embebidas en base64 (grabado). Compatible con LightBurn y similares.
import makerjs from "makerjs";
import { Params, innerDims } from "./types";
import { boxPieces, GAP } from "./assemble";
import { toSVG } from "./exporters";

export type PieceKey = "bandeja" | "tapa";
export type FaceKey = "top" | "front" | "back" | "left" | "right";

/** Rectángulo de una cara en las MISMAS coordenadas (mm) que assembleBox(p). */
export interface FaceRect {
  id: string; // `${piece}:${face}`
  piece: PieceKey;
  face: FaceKey;
  label: string;
  x: number; // esquina inferior-izquierda (modelo, y hacia arriba)
  y: number;
  w: number;
  h: number;
}

const FACE_LABEL: Record<FaceKey, string> = {
  top: "Superior",
  front: "Frente",
  back: "Fondo",
  left: "Izquierda",
  right: "Derecha",
};

/** Caras locales de una pieza tipo bandeja de interior L×W y pared H. */
function localFaces(L: number, W: number, H: number): Omit<FaceRect, "id" | "piece" | "label">[] {
  return [
    { face: "top", x: 0, y: 0, w: L, h: W },
    { face: "front", x: 0, y: -H, w: L, h: H },
    { face: "back", x: 0, y: W, w: L, h: H },
    { face: "left", x: -H, y: 0, w: H, h: W },
    { face: "right", x: L, y: 0, w: H, h: W },
  ];
}

/**
 * Caras decorables en coordenadas de assembleBox(p). Replica el layout de
 * `assemble.ts` (zero() + cursor con GAP) para que los rectángulos coincidan
 * exactamente con el dieline exportado. Soporta bandeja+tapa y cofre.
 */
export function faceRects(p: Params): FaceRect[] {
  if (p.boxType === "chest") return chestFaceRects(p);
  const pieces = boxPieces(p); // [bandeja, tapa]
  const inner = innerDims(p);
  const grow = 2 * (p.thickness + p.lidClearance);
  const dims: Record<string, { L: number; W: number; H: number }> = {
    bandeja: { L: inner.L, W: inner.W, H: inner.H },
    tapa: { L: inner.L + grow, W: inner.W + grow, H: p.lidHeight },
  };

  // layout() posiciona el bbox de cada pieza en (cursorX - low[0], -low[1]); las
  // caras (en coords locales de la pieza) se trasladan por ese mismo offset.
  const out: FaceRect[] = [];
  let cursorX = 0;
  for (const piece of pieces) {
    const e = makerjs.measure.modelExtents(piece.model);
    const lo0 = e ? e.low[0] : 0, lo1 = e ? e.low[1] : 0;
    const d = dims[piece.key];
    const key = piece.key as PieceKey;
    for (const f of localFaces(d.L, d.W, d.H)) {
      // La cara "top" de la bandeja es el piso exterior (no visible): se omite.
      if (key === "bandeja" && f.face === "top") continue;
      out.push({
        id: `${key}:${f.face}`,
        piece: key,
        face: f.face,
        label: `${key === "tapa" ? "Tapa" : "Bandeja"} · ${FACE_LABEL[f.face]}`,
        x: f.x + cursorX - lo0,
        y: f.y - lo1,
        w: f.w,
        h: f.h,
      });
    }
    cursorX += (e ? e.high[0] - e.low[0] : 0) + GAP;
  }
  return out;
}

// --- Cofre (chest) ---
const CHEST_LABEL: Record<string, string> = {
  "bandeja:front": "Cofre · Frente",
  "bandeja:back": "Cofre · Fondo",
  "bandeja:left": "Cofre · Izquierda",
  "bandeja:right": "Cofre · Derecha",
  "tapa:top": "Tapa (cubierta)",
  "tapa:front": "Tapa · Labio",
};

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Aplica la MISMA transposición que dielines.ts `transpose` sobre el modelo.
 * Verificado empíricamente contra buildChest: equivale a una rotación 90° CCW,
 * (x, y) -> (-y, x). (Las ops de makerjs.model.* difieren de makerjs.point.*.)
 */
function transposePt([x, y]: [number, number]): [number, number] {
  return [-y, x];
}

/** AABB de un rectángulo tras (opcionalmente) transponer sus esquinas. */
function rectAABB(r: Rect, swap: boolean): Rect {
  const corners: [number, number][] = [
    [r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h],
  ].map((c) => (swap ? transposePt(c as [number, number]) : (c as [number, number])));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Caras del cofre en coords de buildChest(p) (= assembleBox, pieza única en el
 * origen). El cofre canónico tiene la tapa con bisagra en la cara larga; si W>L
 * el dieline se transpone. Calculamos cada cara en el marco canónico y aplicamos
 * la misma transposición que `buildChest`, luego asignamos el rol de cada pared
 * de la base (front/back/left/right) según su posición respecto del piso — misma
 * convención que trayDieline (front=y<0, back=y>alto, left=x<0, right=x>ancho).
 */
function chestFaceRects(p: Params): FaceRect[] {
  const { L, W, H } = innerDims(p);
  const t = p.thickness;
  const lip = Math.max(10, p.lidHeight * 0.6);
  const swap = W > L;
  const longLen = swap ? W : L;
  const shortLen = swap ? L : W;
  const lidDepth = shortLen + t;

  const canon: { piece: PieceKey; face: FaceKey; rect: Rect }[] = [
    { piece: "bandeja", face: "front", rect: { x: 0, y: -H, w: longLen, h: H } },
    { piece: "bandeja", face: "back", rect: { x: 0, y: shortLen, w: longLen, h: H } },
    { piece: "bandeja", face: "left", rect: { x: -H, y: 0, w: H, h: shortLen } },
    { piece: "bandeja", face: "right", rect: { x: longLen, y: 0, w: H, h: shortLen } },
    { piece: "tapa", face: "top", rect: { x: 0, y: shortLen + H, w: longLen, h: lidDepth } },
    { piece: "tapa", face: "front", rect: { x: 0, y: shortLen + H + lidDepth, w: longLen, h: lip } },
  ];

  // Piso transpuesto: referencia para asignar el rol de las paredes de la base.
  const floor = rectAABB({ x: 0, y: 0, w: longLen, h: shortLen }, swap);
  const fcx = floor.x + floor.w / 2, fcy = floor.y + floor.h / 2;

  // layout() traslada la pieza (cofre) por (-low[0], -low[1]); aplicamos el mismo offset.
  const e = makerjs.measure.modelExtents(boxPieces(p)[0].model);
  const ox = e ? -e.low[0] : 0, oy = e ? -e.low[1] : 0;

  return canon.map((c) => {
    const rect = rectAABB(c.rect, swap);
    let face = c.face;
    if (c.piece === "bandeja") {
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
      // La pared está a un lado del piso; el mayor desplazamiento define el eje.
      if (Math.abs(cx - fcx) > Math.abs(cy - fcy)) face = cx < fcx ? "left" : "right";
      else face = cy < fcy ? "front" : "back";
    }
    const id = `${c.piece}:${face}`;
    return { id, piece: c.piece, face, label: CHEST_LABEL[id] ?? id, x: rect.x + ox, y: rect.y + oy, w: rect.w, h: rect.h };
  });
}

/** Imagen subida por el usuario (data URL base64). */
export interface DesignImage {
  id: string;
  name: string;
  dataUrl: string;
}

/** Colocación de una imagen sobre una cara. */
export interface Placement {
  id: string;
  imageId: string;
  faceId: string; // FaceRect.id
  fit: "cover" | "contain";
  scale: number; // 1 = ocupa la cara
  offX: number; // desplazamiento en mm (x hacia la derecha)
  offY: number; // desplazamiento en mm (y hacia arriba)
  rot: number; // giro en grados (libre)
}

/** Placement por defecto centrado y ajustado a la cara. */
export function defaultPlacement(imageId: string, faceId: string): Placement {
  return { id: `pl-${Math.random().toString(36).slice(2, 8)}`, imageId, faceId, fit: "cover", scale: 1, offX: 0, offY: 0, rot: 0 };
}

/** Límites del modelo ensamblado y su tamaño, para mapear coordenadas. */
export function modelBounds(model: makerjs.IModel) {
  const e = makerjs.measure.modelExtents(model);
  const low0 = e ? e.low[0] : 0, low1 = e ? e.low[1] : 0;
  const high0 = e ? e.high[0] : 0, high1 = e ? e.high[1] : 0;
  return { low0, low1, high0, high1, w: high0 - low0, h: high1 - low1 };
}

/** Centro y tamaño (en coords SVG del preview) de una colocación sobre su cara. */
export function placementSVGBox(
  pl: Placement, f: FaceRect, b: { low0: number; high1: number }
) {
  const cx = f.x - b.low0 + f.w / 2 + pl.offX;
  const cy = b.high1 - (f.y + f.h / 2) - pl.offY;
  return { cx, cy, w: f.w * pl.scale, h: f.h * pl.scale };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * SVG del dieline de la caja + imágenes de decoración embebidas, en mm.
 *  - responsive: escala al contenedor (para preview).
 * Las imágenes se pintan DEBAJO de las líneas (se inyectan al inicio del grupo).
 */
export function designToSVG(
  p: Params,
  placements: Placement[],
  images: Record<string, DesignImage>,
  model: makerjs.IModel,
  opts: { responsive?: boolean } = {}
): string {
  const base = toSVG(model, { stroke: "1.2", responsive: opts.responsive });
  const e = makerjs.measure.modelExtents(model);
  if (!e) return base;
  const low0 = e.low[0];
  const high1 = e.high[1];

  const faces = new Map(faceRects(p).map((f) => [f.id, f]));
  const parts: string[] = [];
  for (const pl of placements) {
    const f = faces.get(pl.faceId);
    const img = images[pl.imageId];
    if (!f || !img) continue;

    // Centro/tamaño de la colocación en coordenadas SVG (y hacia abajo).
    const box = placementSVGBox(pl, f, { low0, high1 });
    const cx = box.cx, cy = box.cy, boxW = box.w, boxH = box.h;
    const x = (cx - boxW / 2).toFixed(3);
    const y = (cy - boxH / 2).toFixed(3);
    const par = pl.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
    const transform = pl.rot ? ` transform="rotate(${pl.rot} ${cx.toFixed(3)} ${cy.toFixed(3)})"` : "";
    const href = esc(img.dataUrl);
    // href (SVG2) + xlink:href por compatibilidad con software láser/Inkscape.
    parts.push(
      `<image x="${x}" y="${y}" width="${boxW.toFixed(3)}" height="${boxH.toFixed(3)}" ` +
        `preserveAspectRatio="${par}"${transform} href="${href}" xlink:href="${href}"/>`
    );
  }
  if (!parts.length) return base;

  // Declara el namespace xlink en el <svg> raíz (makerjs no lo incluye).
  let out = base;
  if (!out.includes("xmlns:xlink")) {
    out = out.replace("<svg ", '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ');
  }
  // Inyecta las imágenes justo después de abrir el grupo <g ...> para que queden
  // por debajo de las líneas de corte/pliegue.
  const gOpen = out.indexOf(">", out.indexOf("<g "));
  if (gOpen < 0) return out;
  return out.slice(0, gOpen + 1) + parts.join("") + out.slice(gOpen + 1);
}
