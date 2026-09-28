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

console.log(failures === 0 ? "\nOK ✔" : `\nFALLARON ${failures} ✖`);
process.exit(failures === 0 ? 0 : 1);
