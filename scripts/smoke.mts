// Smoke test end-to-end sin navegador: orientación, secciones, insert plegado y export.
import { analyze, Orientation } from "../src/lib/product.ts";
import { defaultParams } from "../src/lib/types.ts";
import { assembleSheet } from "../src/lib/assemble.ts";
import { buildSuspensionInsert } from "../src/lib/dielines.ts";
import { toDXF, toSVG } from "../src/lib/exporters.ts";
import { bestOrientation } from "../src/lib/optimize.ts";
import { convexHull, offsetConvex, area, Pt } from "../src/lib/polygon.ts";

let failures = 0;
const check = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✔" : "✖"} ${name} ${extra}`);
  if (!cond) failures++;
};

// --- Polígonos ---
const square: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
check("convexHull descarta punto interior", convexHull([...square, [5, 5]]).length === 4);
check("offset 1mm de 10x10 => área 64", Math.abs(area(offsetConvex(square, 1)) - 64) < 0.1);

// --- Malla de prueba: caja 80(x) × 50(y) × 30(z) (12 triángulos) ---
function boxVertices(sx: number, sy: number, sz: number): Float32Array {
  const v: number[] = [];
  const c = [
    [0, 0, 0], [sx, 0, 0], [sx, sy, 0], [0, sy, 0],
    [0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
  ];
  for (const f of faces) for (const idx of f) v.push(...c[idx]);
  return Float32Array.from(v);
}
const verts = boxVertices(80, 50, 30);

// Orientación por defecto: Z vertical => alto 30.
const pz = analyze(verts, { up: "z", rotateDeg: 0, flip: false }, 3);
check("up=z => size 80×50×30", pz.x === 80 && pz.y === 50 && pz.z === 30, `(${pz.x}×${pz.y}×${pz.z})`);
check("up=z => 3 secciones", pz.slices.length === 3);

// Reorientar: X vertical => alto pasa a 80.
const px: Orientation = { up: "x", rotateDeg: 0, flip: false };
const rx = analyze(verts, px, 4);
check("up=x => alto (z) = 80", Math.abs(rx.z - 80) < 1e-3, `(z=${rx.z})`);
check("up=x => 4 secciones", rx.slices.length === 4);

// Flip: invertir arriba/abajo no cambia el tamaño pero sí reordena las secciones.
const flipped = analyze(verts, { up: "z", rotateDeg: 0, flip: true }, 3);
check("flip mantiene tamaño 80×50×30", flipped.x === 80 && flipped.y === 50 && flipped.z === 30);

// --- Insert: plataforma + ventana + patas al piso ---
const params = defaultParams(pz, { up: "z", rotateDeg: 0, flip: false });
const insert = buildSuspensionInsert({ ...params, product: pz });
const im = (insert as any).models;
check("insert = bandeja + acordeón + 3 repisas",
  !!im.bandeja && !!im.acordeon && !!im.repisa0 && !!im.repisa1 && !!im.repisa2);
const insertDxf = toDXF(insert);
check("insert DXF con CORTE, PLIEGUE y PEGADO",
  insertDxf.includes("CORTE") && insertDxf.includes("PLIEGUE") && insertDxf.includes("PEGADO"));

// --- Orientación óptima: para 80×50×30, el eje más largo (X) debería quedar
//     horizontal; el óptimo minimiza área de lámina. Verificamos que devuelva algo. ---
const best = bestOrientation(verts, 3);
check("bestOrientation devuelve eje válido", ["x", "y", "z"].includes(best.orientation.up), `(up=${best.orientation.up}, área=${best.area.toFixed(0)})`);

// --- Kerf: ventana con kerf debe ser más chica que sin kerf ---
const noKerf = buildSuspensionInsert({ ...params, product: pz, useContour: false, kerf: 0 });
const withKerf = buildSuspensionInsert({ ...params, product: pz, useContour: false, kerf: 4 });
function winWidth(m: any): number {
  const v = m.models.repisa0; // ventana de la primera repisa; ancho en X de su bbox
  let minX = Infinity, maxX = -Infinity;
  for (const k in v.paths) {
    const p = v.paths[k];
    for (const pt of [p.origin, p.end]) {
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
    }
  }
  return maxX - minX;
}
check("kerf achica la ventana", winWidth(withKerf) < winWidth(noKerf), `(${winWidth(withKerf)} < ${winWidth(noKerf)})`);

// --- Puntos de pegado (capa PEGADO) ---
const dxfTray = toDXF(assembleSheet(params));
check("DXF bandeja+tapa con capa PEGADO", dxfTray.includes("PEGADO"));

// --- Solapas superiores: más pliegues cuando topFlaps=true ---
const creaseCount = (s: string) => (s.match(/PLIEGUE/g) || []).length;
const withFlaps = toDXF(assembleSheet({ ...params, topFlaps: true }));
const noFlaps = toDXF(assembleSheet({ ...params, topFlaps: false }));
check("topFlaps agrega pliegues", creaseCount(withFlaps) > creaseCount(noFlaps), `(${creaseCount(withFlaps)} > ${creaseCount(noFlaps)})`);

// --- Cofre: arma una pieza 'cofre' + insert (no 'tapa' separada) ---
const chest = assembleSheet({ ...params, boxType: "chest" });
const chestKeys = Object.keys((chest as any).models);
check("cofre => piezas cofre + insert", chestKeys.includes("cofre") && chestKeys.includes("insert") && !chestKeys.includes("tapa"), `(${chestKeys.join(",")})`);
const dxfChest = toDXF(chest);
check("cofre DXF con PEGADO (labio) y PLIEGUE (bisagra)", dxfChest.includes("PEGADO") && dxfChest.includes("PLIEGUE"));

// Cofre con W>L: se construye vía transpose (bisagra en la cara larga lateral).
const tall = { ...params, boxType: "chest" as const, product: { ...pz, x: pz.y, y: pz.x } };
const dxfTall = toDXF(assembleSheet(tall));
check("cofre W>L (transpuesto) genera DXF con PEGADO", dxfTall.includes("PEGADO") && dxfTall.length > 500);

// Redondeo: la bandeja debe tener arcos (4 puntas de solapa redondeadas).
import makerjs from "makerjs";
import { buildTray } from "../src/lib/dielines.ts";
let arcs = 0;
makerjs.model.walk(buildTray(params), {
  onPath: (w) => { if ((w.pathContext as any).type === "arc") arcs++; },
});
check("puntas de solapa redondeadas (arcos)", arcs === 4, `(arcos=${arcs})`);

// --- Export DXF/SVG ---
const dxf = dxfTray;
const svg = toSVG(assembleSheet(params));
check("DXF con capa CORTE", dxf.includes("CORTE"));
check("DXF con capa PLIEGUE", dxf.includes("PLIEGUE"));
check("SVG con color de corte", svg.includes("#e11d48"));
check("SVG con punto de pegado rojo", svg.includes("#ff0000"));
console.log(`DXF ${dxf.length} bytes · SVG ${svg.length} bytes`);

// --- Diseño / grabado láser: caras + imagen embebida ---
import { faceRects, designToSVG, defaultPlacement } from "../src/lib/design.ts";
import { assembleBox } from "../src/lib/assemble.ts";
const dFaces = faceRects(params);
check("diseño: 9 caras (tapa 5 + bandeja 4)", dFaces.length === 9, `(${dFaces.length})`);
check("diseño: incluye tapa:top, excluye bandeja:top",
  dFaces.some((f) => f.id === "tapa:top") && !dFaces.some((f) => f.id === "bandeja:top"));
const boxModel = assembleBox(params);
const be = makerjs.measure.modelExtents(boxModel)!;
check("diseño: todas las caras dentro del dieline",
  dFaces.every((f) => f.x >= be.low[0]-0.01 && f.x+f.w <= be.high[0]+0.01 && f.y >= be.low[1]-0.01 && f.y+f.h <= be.high[1]+0.01));
const dImg = { id: "i1", name: "logo.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAA==" };
const dSvg = designToSVG(params, [defaultPlacement("i1", "tapa:top")], { i1: dImg }, boxModel, {});
check("diseño: SVG embebe <image> debajo de las líneas",
  dSvg.includes("<image") && dSvg.includes("data:image/png;base64") && dSvg.indexOf("<image") < dSvg.indexOf("<path"));
check("diseño: sin placements no hay <image>", !designToSVG(params, [], {}, boxModel, {}).includes("<image"));

// --- Diseño en COFRE: caras dentro del dieline (L>=W y W>L) ---
function facesInsideChest(prm: typeof params, tag: string) {
  const m = assembleBox(prm);
  const ex = makerjs.measure.modelExtents(m)!;
  const fr = faceRects(prm);
  const ids = fr.map((f) => f.id).sort().join(",");
  check(`cofre ${tag}: 6 caras (4 base + cubierta + labio)`, fr.length === 6, `(${fr.length})`);
  check(`cofre ${tag}: incluye tapa:top y tapa:front`,
    ids.includes("tapa:top") && ids.includes("tapa:front"));
  check(`cofre ${tag}: todas las caras dentro del dieline`,
    fr.every((f) => f.x >= ex.low[0]-0.01 && f.x+f.w <= ex.high[0]+0.01 && f.y >= ex.low[1]-0.01 && f.y+f.h <= ex.high[1]+0.01));
}
facesInsideChest({ ...params, boxType: "chest" }, "L>=W");
// W>L: producto con x<y fuerza el caso transpuesto.
facesInsideChest({ ...params, boxType: "chest", product: { ...pz, x: pz.y, y: pz.x } }, "W>L");

// --- Múltiples STL: empaquetado + ensambles ---
import { pack } from "../src/lib/pack.ts";
import { rectProduct } from "../src/lib/product.ts";
import {
  packProducts, packBoxes, assembleMultiBox, assembleMultiInsert,
  assembleContainer, assembleAllBoxes, assembleBoxWithInsert,
} from "../src/lib/assemble.ts";

// pack: no solape y respeta gap.
const psz = [{ w: 40, h: 30 }, { w: 20, h: 60 }, { w: 50, h: 25 }, { w: 15, h: 15 }];
const pk = pack(psz, 5);
// Dos rectángulos no se solapan si están separados en X o en Y por >= (w1+w2)/2 + gap.
let packOk = true;
for (let i = 0; i < psz.length; i++) for (let j = i + 1; j < psz.length; j++) {
  const A = pk.pos[i], B = pk.pos[j];
  const sepX = Math.abs(A.x - B.x) >= (psz[i].w + psz[j].w) / 2 + 5 - 1e-6;
  const sepY = Math.abs(A.y - B.y) >= (psz[i].h + psz[j].h) / 2 + 5 - 1e-6;
  if (!(sepX || sepY)) packOk = false;
}
check("pack: no hay solapamiento (respeta gap)", packOk, `(W=${pk.W.toFixed(0)}×H=${pk.H.toFixed(0)})`);

// Tres productos distintos.
const prods = [
  pz,
  analyze(boxVertices(40, 60, 20), { up: "z", rotateDeg: 0, flip: false }, 3),
  rectProduct(30, 30, 15),
];
const mp = packProducts(params, prods);
check("packProducts: 3 posiciones + producto combinado", mp.pos.length === 3 && mp.product.x === mp.W);

// Caja combinada encierra el bounding del empaquetado (interior ≥ pack).
const mBox = assembleMultiBox(params, prods);
const mbe = makerjs.measure.modelExtents(mBox)!;
check("multiBox: la caja combinada encierra el empaquetado",
  (mbe.high[0] - mbe.low[0]) >= mp.W && (mbe.high[1] - mbe.low[1]) >= mp.H);

// Insert multi con repisas: sliceCount × productos ventanas + responde a "pisos".
const mIns = assembleMultiInsert(params, prods);
const insModels = (mIns as any).models.insert.models;
const nRep = Object.keys(insModels).filter((k) => k.startsWith("repisa")).length;
check("multiInsert: repisas × productos (sliceCount=3, 3 prod)", nRep === 9, `(${nRep})`);
const mInsMore = assembleMultiInsert({ ...params, sliceCount: 5 }, prods);
const nRep5 = Object.keys((mInsMore as any).models.insert.models).filter((k) => k.startsWith("repisa")).length;
check("multiInsert: aumentar pisos agrega repisas", nRep5 > nRep, `(${nRep5} > ${nRep})`);
check("multiInsert DXF con CORTE+PLIEGUE (acordeón)", toDXF(mIns).includes("CORTE") && toDXF(mIns).includes("PLIEGUE"));

// Cajas individuales + contenedora, cada caja con su insert.
const cont = assembleContainer(params, prods);
const allBoxes = assembleAllBoxes(params, prods);
const boxKeys = Object.keys((allBoxes as any).models);
check("individual: contenedora es una caja válida", toDXF(cont).includes("PLIEGUE"));
check("individual: 3 cajas con insert (bandeja+tapa+insert c/u)", boxKeys.length === 9, `(${boxKeys.length})`);
const bwi = assembleBoxWithInsert(params, prods[0]);
check("boxWithInsert: bandeja+tapa+insert", Object.keys((bwi as any).models).length === 3);
// Dielines no se superponen: piezas consecutivas separadas al menos GAP en X.
const bwiModels = (bwi as any).models;
const exts = Object.values(bwiModels).map((m: any) => makerjs.measure.modelExtents(m)).sort((a: any, b: any) => a.low[0] - b.low[0]);
let noOverlap = true;
for (let i = 1; i < exts.length; i++) if ((exts[i] as any).low[0] < (exts[i - 1] as any).high[0] - 1e-6) noOverlap = false;
check("layout: piezas no se superponen en X", noOverlap);
const pkb = packBoxes(params, prods);
check("packBoxes: contenedora ≥ que caja combinada (por paredes)", pkb.W >= mp.W && pkb.H >= mp.H);

console.log(failures === 0 ? "\nOK ✔" : `\nFALLARON ${failures} ✖`);
process.exit(failures === 0 ? 0 : 1);
