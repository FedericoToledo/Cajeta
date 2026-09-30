// Modelo de dominio para la generación de dielines.
import { ProductModel, Orientation } from "./product";

/** Capas de salida — se mapean a layers del DXF para el router CNC. */
export const LAYER = {
  CUT: "CORTE", // líneas de corte pasante
  CREASE: "PLIEGUE", // hendido / línea de plegado
  MARK: "MARCA", // referencias, no se cortan
  GLUE: "PEGADO", // puntos rojos: dónde va broche o pegado
} as const;

/** Tipo de caja. */
export type BoxType = "tray-lid" | "chest";

/** Modo con múltiples STL: todo en una caja con un insert, o una caja por STL dentro de una contenedora. */
export type BoxMode = "single-insert" | "individual-boxes";

export type LayerName = (typeof LAYER)[keyof typeof LAYER];

/** Parámetros globales de material y ajustes. */
export interface Params {
  // Producto analizado en la orientación elegida (bbox + huella + secciones).
  product: ProductModel;

  // Orientación del producto (qué eje es vertical + giro en el plano).
  orientation: Orientation;

  // Holgura entre producto y paredes interiores (mm, por lado).
  clearance: number;

  // Espesor del cartón (mm). Afecta compensaciones de encastre.
  thickness: number;

  // Altura de las paredes de la bandeja (mm). Por defecto = z producto + holgura.
  trayWallHeight: number;

  // Altura de la tapa telescópica (mm). Cuánto baja la tapa sobre la bandeja.
  lidHeight: number;

  // Holgura de la tapa sobre la bandeja (mm, por lado) para que calce.
  lidClearance: number;

  // Ancho de las solapas de esquina que unen las paredes (mm).
  cornerTab: number;

  // --- Insert de suspensión (un solo cartón plegado en acordeón) ---
  // Margen de agarre: cuánto aprieta cada ventana respecto al contorno (mm).
  gripMargin: number;

  // Cantidad de secciones/estantes (capas del acordeón). Más = sigue mejor la forma.
  sliceCount: number;

  // Usar el contorno real por sección; si es false, ventana rectangular del bbox.
  useContour: boolean;

  // Interferencia de apriete (mm): cuánto más alto queda el tope del insert
  // respecto al hueco, para que la tapa presione el producto.
  squeeze: number;

  // Kerf / diámetro de fresa (mm). Compensa el ancho de corte de la herramienta:
  // los huecos (ventanas) se achican kerf/2 por lado para que queden a medida.
  // El kerf del contorno exterior se setea como compensación de herramienta en el CAM.
  kerf: number;

  // Tipo de caja: bandeja + tapa separada, o cofre (tapa con bisagra atrás).
  boxType: BoxType;

  // Solapas superiores de frente/fondo que se pliegan HACIA ADENTRO y se
  // superponen en el medio (encastre + rigidez).
  topFlaps: boolean;
}

/** Valores por defecto derivados del producto analizado. */
export function defaultParams(product: ProductModel, orientation: Orientation): Params {
  const thickness = 2;
  const clearance = 2;
  return {
    product,
    orientation,
    clearance,
    thickness,
    trayWallHeight: Math.round((product.z + clearance) * 10) / 10,
    lidHeight: Math.max(15, Math.round(product.z * 0.4)),
    lidClearance: 0.5,
    cornerTab: Math.min(25, Math.max(12, Math.round(product.z * 0.6))),
    gripMargin: 1.5,
    sliceCount: 3,
    useContour: true,
    squeeze: 1,
    kerf: 0,
    boxType: "tray-lid",
    topFlaps: true,
  };
}

/** Dimensiones interiores útiles de la bandeja (producto + holgura). */
export function innerDims(p: Params) {
  return {
    L: p.product.x + 2 * p.clearance, // largo interior (eje X)
    W: p.product.y + 2 * p.clearance, // ancho interior (eje Y)
    H: p.trayWallHeight, // alto de pared
  };
}
