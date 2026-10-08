// Generadores paramétricos de dielines.
// Convención de ejes: la caja es tipo BANDEJA (tray) + TAPA (lid) telescópica.
// Todas las medidas en mm. CUT = corte pasante, CREASE = línea de plegado.
import makerjs from "makerjs";
import { LAYER, Params, innerDims } from "./types";
import { line, rectLines, dots } from "./maker";
import { offsetConvex, translate, Pt } from "./polygon";

const GLUE_R = 2.2; // radio de los puntos de pegado (mm)

interface TrayOpts {
  cornerTab: number;
  thickness: number; // espesor del cartón (mm) — necesario para que los pliegues encastren
  topFlaps?: boolean; // doble solapa superior hacia adentro (rigidez)
  flapWalls?: "both" | "front"; // en qué paredes va la doble solapa (default both)
  flapDepth?: number; // altura de la doble pared interior (mm)
  backCrease?: boolean; // borde superior del fondo como PLIEGUE (para enganchar el acordeón del insert)
}

/**
 * Doble solapa hacia adentro en el borde superior de una pared, para rigidez.
 * Se pliega dos veces: primero un tramo horizontal de ancho = ESPESOR (para que
 * la 2ª cara apoye a ras del interior de la pared), y luego baja `flapDepth`
 * formando una DOBLE PARED. Depende del espesor para que los pliegues encastren.
 *
 *  yRim: y del borde superior de la pared.  s: +1 hacia +y, -1 hacia -y.
 *  Devuelve las paths y agrega un punto de pegado en el centro de la doble pared.
 */
function doubleFlap(
  x0: number,
  x1: number,
  yRim: number,
  s: number,
  t: number,
  flapDepth: number,
  gluePts: [number, number][]
): makerjs.IPath[] {
  const paths: makerjs.IPath[] = [];
  const xa = x0 + t, xb = x1 - t; // la solapa se angosta el espesor por lado (encastre)
  const yTop = yRim + s * t; // fin del tramo horizontal (= espesor)
  const yEnd = yRim + s * (t + flapDepth); // fin de la doble pared

  // Rim: relieve en los extremos (CUT) + pliegue central pared->solapa (CREASE).
  paths.push(line([x0, yRim], [xa, yRim], LAYER.CUT));
  paths.push(line([xa, yRim], [xb, yRim], LAYER.CREASE));
  paths.push(line([xb, yRim], [x1, yRim], LAYER.CUT));
  // Tramo horizontal (ancho = espesor) — sus lados son CUT.
  paths.push(line([xa, yRim], [xa, yTop], LAYER.CUT));
  paths.push(line([xb, yRim], [xb, yTop], LAYER.CUT));
  // Pliegue horizontal->doble pared (CREASE).
  paths.push(line([xa, yTop], [xb, yTop], LAYER.CREASE));
  // Doble pared interior.
  paths.push(line([xa, yTop], [xa, yEnd], LAYER.CUT));
  paths.push(line([xb, yTop], [xb, yEnd], LAYER.CUT));
  paths.push(line([xa, yEnd], [xb, yEnd], LAYER.CUT));

  gluePts.push([(x0 + x1) / 2, yRim + s * (t + flapDepth * 0.5)]);
  return paths;
}

/**
 * Bandeja/tapa genérica de una pieza con paredes que se pliegan hacia arriba,
 * solapas de esquina (con puntas REDONDEADAS) y, opcional, DOBLE solapa superior
 * hacia adentro en frente/fondo (rigidez, depende del espesor).
 *
 * Bordes fondo<->pared y pared<->solapa son PLIEGUES (CREASE); el resto CUT.
 * Incluye submodelo `glue` con puntos rojos donde va broche/pegado.
 */
export function trayDieline(L: number, W: number, H: number, opts: TrayOpts): makerjs.IModel {
  const cornerTab = opts.cornerTab;
  const t = opts.thickness;
  const flapDepth = opts.flapDepth ?? Math.max(10, H * 0.6);
  const paths: Record<string, makerjs.IPath> = {};
  let i = 0;
  const add = (p: makerjs.IPath) => (paths[`p${i++}`] = p);
  const gluePts: [number, number][] = [];

  // --- PLIEGUES (fondo <-> paredes) ---
  add(line([0, 0], [L, 0], LAYER.CREASE));
  add(line([0, W], [L, W], LAYER.CREASE));
  add(line([0, 0], [0, W], LAYER.CREASE));
  add(line([L, 0], [L, W], LAYER.CREASE));

  // --- PLIEGUES (pared lateral <-> solapa de esquina) ---
  add(line([-H, 0], [0, 0], LAYER.CREASE));
  add(line([-H, W], [0, W], LAYER.CREASE));
  add(line([L, 0], [L + H, 0], LAYER.CREASE));
  add(line([L, W], [L + H, W], LAYER.CREASE));

  // --- Pared frente (y de -H a 0) ---
  if (opts.topFlaps) {
    doubleFlap(0, L, -H, -1, t, flapDepth, gluePts).forEach(add);
  } else {
    add(line([0, -H], [L, -H], LAYER.CUT));
  }
  add(line([0, -H], [0, 0], LAYER.CUT));
  add(line([L, -H], [L, 0], LAYER.CUT));

  // --- Pared fondo (y de W a W+H) --- (se omite el flap si flapWalls="front", ej. cofre)
  if (opts.topFlaps && opts.flapWalls !== "front") {
    doubleFlap(0, L, W + H, +1, t, flapDepth, gluePts).forEach(add);
  } else {
    add(line([0, W + H], [L, W + H], opts.backCrease ? LAYER.CREASE : LAYER.CUT));
  }
  add(line([0, W], [0, W + H], LAYER.CUT));
  add(line([L, W], [L, W + H], LAYER.CUT));

  // --- Pared izquierda + solapas de esquina (x de -H a 0), puntas redondeadas ---
  const r = Math.max(2, Math.min(cornerTab, H) * 0.4);
  const leftEdge = line([-H, -cornerTab], [-H, W + cornerTab], LAYER.CUT);
  const swBottom = line([-H, -cornerTab], [0, -cornerTab], LAYER.CUT);
  const nwTop = line([-H, W + cornerTab], [0, W + cornerTab], LAYER.CUT);
  roundCorner(leftEdge, swBottom, r, add);
  roundCorner(leftEdge, nwTop, r, add);
  add(leftEdge); add(swBottom); add(nwTop);
  add(line([0, -cornerTab], [0, 0], LAYER.CUT));
  add(line([0, W], [0, W + cornerTab], LAYER.CUT));

  // --- Pared derecha + solapas de esquina (x de L a L+H), puntas redondeadas ---
  const rightEdge = line([L + H, -cornerTab], [L + H, W + cornerTab], LAYER.CUT);
  const seBottom = line([L, -cornerTab], [L + H, -cornerTab], LAYER.CUT);
  const neTop = line([L, W + cornerTab], [L + H, W + cornerTab], LAYER.CUT);
  roundCorner(rightEdge, seBottom, r, add);
  roundCorner(rightEdge, neTop, r, add);
  add(rightEdge); add(seBottom); add(neTop);
  add(line([L, -cornerTab], [L, 0], LAYER.CUT));
  add(line([L, W], [L, W + cornerTab], LAYER.CUT));

  // Puntos de pegado en las 4 solapas de esquina.
  gluePts.push([-H / 2, -cornerTab / 2]);
  gluePts.push([-H / 2, W + cornerTab / 2]);
  gluePts.push([L + H / 2, -cornerTab / 2]);
  gluePts.push([L + H / 2, W + cornerTab / 2]);

  return { paths, models: { glue: dots(gluePts, GLUE_R, LAYER.GLUE) } };
}

/** Redondea la esquina donde se encuentran dos paths (los recorta y agrega el arco). */
function roundCorner(a: makerjs.IPath, b: makerjs.IPath, radius: number, add: (p: makerjs.IPath) => void) {
  const arc = makerjs.path.fillet(a, b, radius);
  if (arc) {
    arc.layer = LAYER.CUT;
    add(arc);
  }
}

/** Bandeja base a partir de los parámetros. */
export function buildTray(p: Params): makerjs.IModel {
  const { L, W, H } = innerDims(p);
  return trayDieline(L, W, H, { cornerTab: p.cornerTab, thickness: p.thickness, topFlaps: p.topFlaps });
}

/** Tapa telescópica: misma geometría, footprint agrandado para calzar sobre la bandeja. */
export function buildLid(p: Params): makerjs.IModel {
  const { L, W } = innerDims(p);
  const grow = 2 * (p.thickness + p.lidClearance);
  return trayDieline(L + grow, W + grow, p.lidHeight, {
    cornerTab: p.cornerTab,
    thickness: p.thickness,
    topFlaps: p.topFlaps, // la tapa también lleva doble solapa
  });
}

/**
 * Cofre canónico: bandeja con tapa unida por BISAGRA en la pared del fondo
 * (la del lado `longLen`), con labio frontal. Tabs en las paredes cortas.
 * Interior longLen (x) × shortLen (y).
 */
function chestCanonical(longLen: number, shortLen: number, H: number, p: Params): makerjs.IModel {
  // topFlaps sólo en el frente (el fondo lleva la bisagra de la tapa).
  const base = trayDieline(longLen, shortLen, H, {
    cornerTab: p.cornerTab,
    thickness: p.thickness,
    topFlaps: p.topFlaps,
    flapWalls: "front",
  });
  const lidDepth = shortLen + p.thickness;
  const lip = Math.max(10, p.lidHeight * 0.6);
  const y0 = shortLen + H; // bisagra en el rim del fondo (cara larga)
  const paths: Record<string, makerjs.IPath> = {};
  let i = 0;
  const add = (pt: makerjs.IPath) => (paths[`c${i++}`] = pt);

  add(line([0, y0], [longLen, y0], LAYER.CREASE)); // bisagra (cara más larga)
  add(line([0, y0], [0, y0 + lidDepth], LAYER.CUT));
  add(line([longLen, y0], [longLen, y0 + lidDepth], LAYER.CUT));
  add(line([0, y0 + lidDepth], [longLen, y0 + lidDepth], LAYER.CREASE)); // tapa<->labio
  add(line([0, y0 + lidDepth], [0, y0 + lidDepth + lip], LAYER.CUT));
  add(line([longLen, y0 + lidDepth], [longLen, y0 + lidDepth + lip], LAYER.CUT));
  add(line([0, y0 + lidDepth + lip], [longLen, y0 + lidDepth + lip], LAYER.CUT));

  const glue = dots([[longLen / 2, y0 + lidDepth + lip * 0.5]], GLUE_R, LAYER.GLUE);
  return { models: { base, lid: { paths }, lidGlue: glue } };
}

/** Transpone un modelo (x <-> y): rotar 90° y espejar en X. */
function transpose(m: makerjs.IModel): makerjs.IModel {
  const c = makerjs.cloneObject(m);
  makerjs.model.rotate(c, 90, [0, 0]);
  makerjs.model.mirror(c, true, false);
  return c;
}

/**
 * Cofre: la tapa (una sola pieza) va SIEMPRE agarrada a la cara más larga.
 *  - Si L ≥ W: la cara larga es el frente/fondo → bisagra ahí (orientación directa).
 *  - Si W > L: la cara larga es un lateral → se construye canónico y se transpone,
 *    de modo que la bisagra quede en el lateral (cara más larga) e interior L×W.
 */
export function buildChest(p: Params): makerjs.IModel {
  const { L, W, H } = innerDims(p);
  if (L >= W) return chestCanonical(L, W, H, p);
  return transpose(chestCanonical(W, L, H, p)); // interior W×L transpuesto -> L×W
}

/**
 * Lados de una repisa del acordeón. En la ÚLTIMA repisa, cada lado lleva una PATA
 * que baja al piso (bisagra en el borde, se pliega 90° hacia abajo) para que la
 * repisa inferior no quede en voladizo. `legLen` = alto de esa repisa sobre el piso.
 */
function addShelfSides(
  add: (p: makerjs.IPath) => void,
  L: number, y0: number, y1: number, isLast: boolean, legLen: number, legW: number
) {
  if (!isLast || legLen <= 0) {
    add(line([0, y0], [0, y1], LAYER.CUT));
    add(line([L, y0], [L, y1], LAYER.CUT));
    return;
  }
  const yMid = (y0 + y1) / 2, yA = yMid - legW / 2, yB = yMid + legW / 2;
  ([[0, -1], [L, 1]] as [number, number][]).forEach(([xEdge, dir]) => {
    add(line([xEdge, y0], [xEdge, yA], LAYER.CUT));
    add(line([xEdge, yA], [xEdge, yB], LAYER.CREASE)); // bisagra de la pata
    add(line([xEdge, yB], [xEdge, y1], LAYER.CUT));
    const xFar = xEdge + dir * legLen;
    add(line([xEdge, yA], [xFar, yA], LAYER.CUT));
    add(line([xFar, yA], [xFar, yB], LAYER.CUT));
    add(line([xFar, yB], [xEdge, yB], LAYER.CUT));
  });
}

/** Geometría del insert compartida por dieline y simulador. */
export interface InsertShelf {
  depthY: number; // profundidad de la repisa en la tira plana (= W interior)
  spacing: number; // separación vertical entre repisas
  count: number; // cantidad de repisas
  slices: Pt[][]; // contorno por sección (0 = inferior)
}
export function insertShelves(p: Params): InsertShelf {
  const { W } = innerDims(p);
  const slices =
    p.useContour && p.product.slices.length ? p.product.slices : [p.product.footprint];
  const N = slices.length;
  // Espaciado = alto del producto / N: así las repisas quedan a la altura de cada
  // sección y el producto queda SUSPENDIDO (no apoya en el piso).
  const spacing = N > 1 ? Math.max(4, p.product.z / N) : 0;
  return { depthY: W, spacing, count: N, slices };
}

/**
 * Insert de retención de UNA pieza: una BANDEJA de altura completa (fondo + 4
 * paredes que apoyan en el piso) + un ACORDEÓN de REPISAS que cuelga desde el
 * borde superior de la pared del fondo hacia adentro. Cada repisa lleva la
 * ventana de su sección, de modo que el producto se apoya a distintas alturas
 * (sigue la forma). Referencia: templatemaker tray-insert.
 */
export function buildSuspensionInsert(p: Params): makerjs.IModel {
  const { L, W, H } = innerDims(p);
  const sh = insertShelves(p);
  const N = sh.count;

  // Bandeja exterior (apoya en el piso); su borde de fondo es pliegue para el acordeón.
  const tray = trayDieline(L, W, H, { cornerTab: p.cornerTab, thickness: p.thickness, backCrease: true });
  // Abertura del fondo: NO es un piso completo (es un marco). El producto queda
  // suspendido por las repisas, no apoya en este fondo.
  const fr = Math.min(20, L * 0.15, W * 0.15);
  const floorOpening = rectLines(fr, fr, L - 2 * fr, W - 2 * fr, LAYER.CUT);

  // Acordeón de repisas desplegado más allá del borde del fondo (y = W + H).
  const paths: Record<string, makerjs.IPath> = {};
  const models: Record<string, makerjs.IModel> = { bandeja: tray };
  let ai = 0;
  const add = (pt: makerjs.IPath) => (paths[`a${ai++}`] = pt);

  const legLen = Math.max(0, H - (N - 1) * sh.spacing); // alto de la última repisa sobre el piso
  const legW = Math.min(sh.depthY * 0.6, 40);
  let y = W + H; // borde del fondo (bisagra a la primera repisa)
  for (let k = 0; k < N; k++) {
    const y0 = y, y1 = y + sh.depthY; // repisa de profundidad W
    addShelfSides(add, L, y0, y1, k === N - 1, legLen, legW); // lados (+ patas en la última)
    // Ventana de la sección: repisa k (0 = la más cercana al fondo = tope al plegar).
    // En repisas impares (invertidas al plegar) reflejamos el contorno en y para que el
    // perfil coincida con la pieza (sin efecto en secciones simétricas).
    // La silueta real de la pieza está en (px, -py) (la malla mapea analyze-Y -> mundo -Z):
    // reflejamos en y en repisas PARES; las impares (invertidas por el acordeón) van tal cual.
    const sec0 = sh.slices[N - 1 - k];
    const sec = k % 2 === 0 ? sec0.map(([fx, fy]) => [fx, -fy] as Pt).reverse() : sec0;
    models[`repisa${k}`] = buildWindow(p, sec, L / 2, (y0 + y1) / 2);
    y = y1;
    if (k < N - 1 && sh.spacing > 0) {
      add(line([0, y], [L, y], LAYER.CREASE)); // repisa -> montante
      add(line([0, y], [0, y + sh.spacing], LAYER.CUT));
      add(line([L, y], [L, y + sh.spacing], LAYER.CUT));
      y += sh.spacing;
      add(line([0, y], [L, y], LAYER.CREASE)); // montante -> repisa
    }
  }
  add(line([0, y], [L, y], LAYER.CUT)); // borde libre de la última repisa
  models.acordeon = { paths };
  models.aberturaFondo = floorOpening;

  return { models };
}

/**
 * Insert de suspensión MULTI-PRODUCTO (Modo A): una bandeja de altura completa + un
 * ACORDEÓN de repisas (cantidad = sliceCount) que cuelga del borde del fondo. En CADA
 * repisa va UNA ventana por producto, con el contorno de su sección a esa altura, en
 * su posición del empaquetado. Así cada producto queda suspendido y sigue su forma, y
 * aumentar "pisos/repisas" agrega capas. `positions` son centros relativos al bounding
 * del empaquetado (esquina en 0,0); se desplazan `clearance` para centrarlos.
 */
export function buildMultiInsert(
  p: Params, products: { footprint: Pt[]; slices: Pt[][]; x: number; y: number }[],
  positions: { x: number; y: number }[],
  opts?: { subtractNested?: boolean }
): makerjs.IModel {
  const { L, W, H } = innerDims(p);
  const N = Math.max(1, Math.floor(p.sliceCount));
  const spacing = N > 1 ? Math.max(4, p.product.z / N) : 0;
  const depthY = W;

  const tray = trayDieline(L, W, H, { cornerTab: p.cornerTab, thickness: p.thickness, backCrease: true });
  const fr = Math.min(20, L * 0.15, W * 0.15);
  const floorOpening = rectLines(fr, fr, L - 2 * fr, W - 2 * fr, LAYER.CUT);

  const paths: Record<string, makerjs.IPath> = {};
  const models: Record<string, makerjs.IModel> = { bandeja: tray };
  let ai = 0;
  const add = (pt: makerjs.IPath) => (paths[`a${ai++}`] = pt);

  const legLen = Math.max(0, H - (N - 1) * spacing); // alto de la última repisa sobre el piso
  const legW = Math.min(depthY * 0.6, 40);
  let y = W + H; // borde del fondo (bisagra a la primera repisa)
  for (let k = 0; k < N; k++) {
    const y0 = y, y1 = y + depthY;
    const even = k % 2 === 0; // al plegar el acordeón, las repisas IMPARES quedan invertidas en profundidad
    addShelfSides(add, L, y0, y1, k === N - 1, legLen, legW); // lados (+ patas en la última)
    // Una ventana por producto en esta repisa (sección k de cada producto).
    const wcx: number[] = [], wcy: number[] = [];
    products.forEach((pr, i) => {
      const pos = positions[i] ?? { x: 0, y: 0 };
      const cx = pos.x + p.clearance;
      // La profundidad se mide desde el borde de bisagra (y0) en repisas pares y desde el
      // opuesto (y1) en impares, porque el acordeón las invierte al plegar; así el producto
      // baja RECTO por todas las ventanas (si no, en impares caían espejadas = zig-zag).
      const bLocal = pos.y + p.clearance;
      const cy = even ? y0 + bLocal : y1 - bLocal;
      wcx[i] = cx; wcy[i] = cy;
      const sec0 = pr.slices[Math.min(pr.slices.length - 1, N - 1 - k)] ?? pr.footprint;
      // La silueta REAL del producto (su malla 3D) está en (px, -py), porque la malla mapea
      // analyze-Y -> mundo -Z. Para que la ventana coincida con la pieza al plegar: en repisas
      // PARES reflejamos el contorno en y (.reverse() mantiene el winding CCW de offsetConvex);
      // las IMPARES, ya invertidas por el acordeón, lo usan tal cual.
      const sec = even ? sec0.map(([fx, fy]) => [fx, -fy] as Pt).reverse() : sec0;
      models[`repisa${k}_${i}`] = buildWindow({ ...p, product: { ...p.product, x: pr.x, y: pr.y } }, sec, cx, cy);
    });
    // Caja anidada: la ventana del producto (0) deja un ANILLO DE SOPORTE alrededor
    // de cada caja chica (restamos su huella + anillo), para que la caja chica apoye.
    if (opts?.subtractNested && products.length > 1) {
      let prod0 = models[`repisa${k}_0`];
      for (let i = 1; i < products.length; i++) {
        const ring = Math.max(4, p.gripMargin) + 5;
        const rect = rectLines(wcx[i] - (products[i].x / 2 + ring), wcy[i] - (products[i].y / 2 + ring),
          products[i].x + 2 * ring, products[i].y + 2 * ring, LAYER.CUT);
        try { prod0 = makerjs.model.combineSubtraction(makerjs.cloneObject(prod0), rect); } catch { /* deja la ventana original */ }
      }
      models[`repisa${k}_0`] = prod0;
    }
    y = y1;
    if (k < N - 1 && spacing > 0) {
      add(line([0, y], [L, y], LAYER.CREASE)); // repisa -> montante
      add(line([0, y], [0, y + spacing], LAYER.CUT));
      add(line([L, y], [L, y + spacing], LAYER.CUT));
      y += spacing;
      add(line([0, y], [L, y], LAYER.CREASE)); // montante -> repisa
    }
  }
  add(line([0, y], [L, y], LAYER.CUT)); // borde libre de la última repisa
  models.acordeon = { paths };
  models.aberturaFondo = floorOpening;
  return { models };
}

/**
 * Ventana de agarre para una sección `contour` (centrada en 0,0), ubicada
 * con su centro en (cx, cy):
 *  - useContour: polígono del contorno con offset de agarre.
 *  - si no: rectángulo del bounding box del producto menos el margen.
 */
function buildWindow(p: Params, contour: Pt[], cx: number, cy: number): makerjs.IModel {
  // Kerf: el hueco es material removido; para que quede a medida tras el corte,
  // achicamos el trazo kerf/2 por lado (además del agarre).
  const inset = p.gripMargin + p.kerf / 2;
  if (p.useContour && contour.length >= 3) {
    const shrunk = offsetConvex(contour, inset); // d>0 aprieta
    return polygonCut(translate(shrunk, cx, cy));
  }
  const winX = Math.max(3, p.product.x - 2 * inset);
  const winY = Math.max(3, p.product.y - 2 * inset);
  return rectLines(cx - winX / 2, cy - winY / 2, winX, winY, LAYER.CUT);
}

/** Polígono cerrado como líneas de CORTE. */
function polygonCut(poly: Pt[]): makerjs.IModel {
  const paths: Record<string, makerjs.IPath> = {};
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    paths[`e${i}`] = line(a, b, LAYER.CUT);
  }
  return { paths };
}
