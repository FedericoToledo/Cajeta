// Ensambla las piezas (bandeja, tapa y dos puentes de suspensión) en una o
// más láminas, separadas por un margen, listas para exportar.
import makerjs from "makerjs";
import { Params } from "./types";
import { buildTray, buildLid, buildChest, buildSuspensionInsert, buildMultiInsert } from "./dielines";
import { ProductModel, rectProduct } from "./product";
import { pack } from "./pack";

export const GAP = 15; // separación entre piezas (mm)

interface Placed {
  key: string;
  model: makerjs.IModel;
}

/** Piezas ordenadas de la CAJA (sin insert), fuente única para assembleBox y el diseño. */
export function boxPieces(p: Params): Placed[] {
  return p.boxType === "chest"
    ? [{ key: "cofre", model: buildChest(p) }]
    : [
        { key: "bandeja", model: buildTray(p) },
        { key: "tapa", model: buildLid(p) },
      ];
}

/**
 * Coloca las piezas en fila (separadas por GAP), SIN superponerse: posiciona el
 * bounding de cada pieza con su esquina inferior-izquierda en (cursorX, 0).
 * OJO: makerjs.model.move fija el origin de forma ABSOLUTA, por eso el offset debe
 * ser (cursorX - low[0], -low[1]) para que el bbox arranque en el cursor.
 */
function layout(pieces: Placed[]): makerjs.IModel {
  const models: Record<string, makerjs.IModel> = {};
  let cursorX = 0;
  for (const piece of pieces) {
    const e = makerjs.measure.modelExtents(piece.model);
    const lo0 = e ? e.low[0] : 0, lo1 = e ? e.low[1] : 0, hi0 = e ? e.high[0] : 0;
    models[piece.key] = makerjs.model.move(makerjs.cloneObject(piece.model), [cursorX - lo0, -lo1]);
    cursorX += hi0 - lo0 + GAP;
  }
  return { models };
}

/** Piezas de la CAJA (bandeja + tapa, o cofre) — DXF/SVG separado. */
export function assembleBox(p: Params): makerjs.IModel {
  return layout(boxPieces(p));
}

/** Pieza del INSERT — DXF/SVG separado. */
export function assembleInsert(p: Params): makerjs.IModel {
  return layout([{ key: "insert", model: buildSuspensionInsert(p) }]);
}

// --- Múltiples productos ---

/** Separación entre productos/cajas en el empaquetado (mm). */
function packGap(p: Params): number {
  return Math.max(4, 2 * p.clearance);
}

/**
 * Empaqueta los footprints de los productos y devuelve el producto sintético
 * combinado (rectángulo que los encierra + clearance), las posiciones (centros) y
 * los footprints. Usado por la caja combinada y el insert multi-ventana (Modo A).
 */
export function packProducts(p: Params, products: ProductModel[]) {
  const sizes = products.map((pr) => ({ w: pr.x, h: pr.y }));
  const { pos, W, H } = pack(sizes, packGap(p));
  const z = products.reduce((m, pr) => Math.max(m, pr.z), 0);
  return { pos, W, H, z, product: rectProduct(W, H, z), footprints: products.map((pr) => pr.footprint) };
}

/** Caja combinada (Modo A): una sola caja que encierra todos los productos. */
export function assembleMultiBox(p: Params, products: ProductModel[]): makerjs.IModel {
  return assembleBox({ ...p, product: packProducts(p, products).product });
}

/**
 * Insert multi-ventana (Modo A): una ventana de agarre por producto, sin solapar.
 * `posCentered` (opcional) son centros centrados en el bounding del empaquetado (con
 * el desplazamiento manual del usuario); si se omite, se usa el empaquetado automático.
 */
export function assembleMultiInsert(
  p: Params, products: ProductModel[], posCentered?: { x: number; y: number }[],
  combined?: ProductModel
): makerjs.IModel {
  const pk = packProducts(p, products);
  // `combined` (opcional): producto sintético de la caja ya ajustada al bounding real de las
  // posiciones; si viene, los centros se convierten a esquina con SUS medidas (no las del pack).
  const prod = combined ?? pk.product;
  const pp = { ...p, product: prod };
  const corner = posCentered
    ? posCentered.map((c) => ({ x: c.x + prod.x / 2, y: c.y + prod.y / 2 }))
    : pk.pos;
  return layout([{ key: "insert", model: buildMultiInsert(pp, products, corner) }]);
}

/**
 * Empaqueta las CAJAS individuales (footprint exterior = producto + clearance +
 * espesor por lado) y devuelve el producto sintético de la contenedora + posiciones.
 */
export function packBoxes(p: Params, products: ProductModel[]) {
  const m = p.clearance + p.thickness; // media pared de cada caja individual
  const sizes = products.map((pr) => ({ w: pr.x + 2 * m, h: pr.y + 2 * m }));
  const { pos, W, H } = pack(sizes, packGap(p));
  const z = products.reduce((m2, pr) => Math.max(m2, pr.z), 0);
  return { pos, W, H, z, sizes, product: rectProduct(W, H, z) };
}

/** Caja contenedora (Modo B): encierra todas las cajas individuales. */
export function assembleContainer(p: Params, products: ProductModel[]): makerjs.IModel {
  return assembleBox({ ...p, product: packBoxes(p, products).product });
}

/** Caja anidada dentro de otra: producto rectangular (huella exterior) + posición relativa. */
export interface NestedChild { product: ProductModel; relX: number; relY: number; }

/**
 * Una caja individual + su insert de suspensión. Si lleva cajas anidadas (`nested`),
 * el insert soporta el producto propio Y una abertura por cada caja chica (su huella),
 * en su posición relativa al centro de la caja grande.
 */
export function assembleBoxWithInsert(p: Params, product: ProductModel, nested: NestedChild[] = []): makerjs.IModel {
  const pp = { ...p, product };
  const pieces: Placed[] = boxPieces(pp).map((pc) => ({ key: pc.key, model: pc.model }));
  const insert = nested.length
    ? buildMultiInsert(
        pp,
        [product, ...nested.map((n) => n.product)],
        [
          { x: product.x / 2, y: product.y / 2 },
          ...nested.map((n) => ({ x: product.x / 2 + n.relX, y: product.y / 2 + n.relY })),
        ],
        { subtractNested: true }
      )
    : buildSuspensionInsert(pp);
  pieces.push({ key: "insert", model: insert });
  return layout(pieces);
}

/**
 * Caja EXTERNA (Modo B): su interior es el bounding de todo lo acomodado. El insert
 * lleva la ventana del producto grande (índice 0 de `insertProducts`) + una abertura
 * por cada caja chica (resto), en sus posiciones (corner-based dentro del bounding).
 */
export function assembleOuterBox(
  p: Params, outerProduct: ProductModel,
  insertProducts: { footprint: ProductModel["footprint"]; slices: ProductModel["slices"]; x: number; y: number }[],
  insertPositions: { x: number; y: number }[]
): makerjs.IModel {
  const pp = { ...p, product: outerProduct };
  const pieces: Placed[] = boxPieces(pp).map((pc) => ({ key: pc.key, model: pc.model }));
  pieces.push({ key: "insert", model: buildMultiInsert(pp, insertProducts, insertPositions, { subtractNested: true }) });
  return layout(pieces);
}

/** Todas las cajas individuales (Modo B) con su insert cada una, en fila. */
export function assembleAllBoxes(p: Params, products: ProductModel[]): makerjs.IModel {
  const pieces: Placed[] = [];
  products.forEach((pr, idx) => {
    const pp = { ...p, product: pr };
    boxPieces(pp).forEach((pc) => pieces.push({ key: `caja${idx}_${pc.key}`, model: pc.model }));
    pieces.push({ key: `caja${idx}_insert`, model: buildSuspensionInsert(pp) });
  });
  return layout(pieces);
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
