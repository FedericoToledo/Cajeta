// Ensambla las piezas (bandeja, tapa y dos puentes de suspensión) en una o
// más láminas, separadas por un margen, listas para exportar.
import makerjs from "makerjs";
import { Params } from "./types";
import { buildTray, buildLid, buildChest, buildSuspensionInsert } from "./dielines";

const GAP = 15; // separación entre piezas (mm)

interface Placed {
  key: string;
  model: makerjs.IModel;
}

/** Normaliza un modelo para que su esquina inferior-izquierda quede en (0,0). */
function zero(model: makerjs.IModel): makerjs.IModel {
  const e = makerjs.measure.modelExtents(model);
  if (!e) return model;
  return makerjs.model.move(makerjs.cloneObject(model), [-e.low[0], -e.low[1]]);
}

function width(model: makerjs.IModel): number {
  const e = makerjs.measure.modelExtents(model);
  return e ? e.high[0] - e.low[0] : 0;
}

/** Coloca las piezas en fila (separadas por GAP), cada una normalizada a (0,0). */
function layout(pieces: Placed[]): makerjs.IModel {
  const models: Record<string, makerjs.IModel> = {};
  let cursorX = 0;
  for (const piece of pieces) {
    const m = zero(piece.model);
    models[piece.key] = makerjs.model.move(m, [cursorX, 0]);
    cursorX += width(m) + GAP;
  }
  return { models };
}

/** Piezas de la CAJA (bandeja + tapa, o cofre) — DXF/SVG separado. */
export function assembleBox(p: Params): makerjs.IModel {
  const pieces: Placed[] =
    p.boxType === "chest"
      ? [{ key: "cofre", model: buildChest(p) }]
      : [
          { key: "bandeja", model: buildTray(p) },
          { key: "tapa", model: buildLid(p) },
        ];
  return layout(pieces);
}

/** Pieza del INSERT — DXF/SVG separado. */
export function assembleInsert(p: Params): makerjs.IModel {
  return layout([{ key: "insert", model: buildSuspensionInsert(p) }]);
}

/** Todo junto (para cálculo de material en la orientación óptima). */
export function assembleSheet(p: Params): makerjs.IModel {
  return layout([
    ...(p.boxType === "chest"
      ? [{ key: "cofre", model: buildChest(p) }]
      : [
          { key: "bandeja", model: buildTray(p) },
          { key: "tapa", model: buildLid(p) },
        ]),
    { key: "insert", model: buildSuspensionInsert(p) },
  ]);
}
