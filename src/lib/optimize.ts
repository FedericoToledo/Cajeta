// Orientación óptima automática: prueba cada eje vertical y elige el que
// minimiza el área de lámina (material) del conjunto bandeja + tapa + insert.
import makerjs from "makerjs";
import { analyze, Orientation, UpAxis } from "./product";
import { defaultParams } from "./types";
import { assembleSheet } from "./assemble";

export interface OrientationResult {
  orientation: Orientation;
  area: number; // mm² del bounding de la lámina
}

/** Área de lámina para una orientación dada. */
function sheetArea(vertices: Float32Array, orientation: Orientation, sliceCount: number): number {
  const product = analyze(vertices, orientation, sliceCount);
  const params = defaultParams(product, orientation);
  const e = makerjs.measure.modelExtents(assembleSheet(params));
  if (!e) return Infinity;
  return (e.high[0] - e.low[0]) * (e.high[1] - e.low[1]);
}

/** Devuelve la orientación (eje vertical) que minimiza el material. */
export function bestOrientation(
  vertices: Float32Array,
  sliceCount: number
): OrientationResult {
  const axes: UpAxis[] = ["x", "y", "z"];
  let best: OrientationResult = {
    orientation: { up: "z", rotateDeg: 0, flip: false },
    area: Infinity,
  };
  for (const up of axes) {
    const orientation: Orientation = { up, rotateDeg: 0, flip: false };
    const area = sheetArea(vertices, orientation, sliceCount);
    if (area < best.area) best = { orientation, area };
  }
  return best;
}
