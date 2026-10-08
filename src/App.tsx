import { useEffect, useMemo, useRef, useState } from "react";
import Viewer3D from "./components/Viewer3D";
import FoldSim from "./components/FoldSim";
import Controls from "./components/Controls";
import DesignView from "./components/DesignView";
import ErrorBoundary from "./components/ErrorBoundary";
import { DesignImage, Placement } from "./lib/design";
import { parseSTL, ParsedSTL } from "./lib/stl";
import { analyze, rectProduct, Orientation } from "./lib/product";
import { bestOrientation } from "./lib/optimize";
import { Params, BoxMode, defaultParams } from "./lib/types";
import {
  assembleBox, assembleInsert, assembleMultiInsert,
  assembleBoxWithInsert, assembleOuterBox, packProducts, packBoxes,
} from "./lib/assemble";
import { toDXF, toSVG, download, printableHTML } from "./lib/exporters";
import makerjs from "makerjs";

interface Offset { x: number; y: number; z: number }
interface StlItem {
  id: string;
  name: string;
  buffer: ArrayBuffer;
  stl: ParsedSTL;
  orientation: Orientation;
  offset: Offset; // desplazamiento manual (mm) para aprovechar mejor la caja
  wantsInsert: boolean; // si lleva soporte/insert propio (solo aplica en "Cajas individuales")
}

const defaultOrientation = (): Orientation => ({ up: "z", rotateDeg: 0, flip: false });

export default function App() {
  const [items, setItems] = useState<StlItem[]>([]);
  const [boxParams, setBoxParams] = useState<Params | null>(null);
  const [mode, setMode] = useState<BoxMode>("single-insert");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"product" | "fold" | "design">("product");
  const [images, setImages] = useState<DesignImage[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);

  const onFiles = async (files: FileList) => {
    setError(null);
    const added: StlItem[] = [];
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith(".stl")) continue;
      try {
        const buf = await file.arrayBuffer();
        const stl = parseSTL(buf);
        added.push({ id: `stl-${Math.random().toString(36).slice(2, 8)}`, name: file.name, buffer: buf, stl, orientation: defaultOrientation(), offset: { x: 0, y: 0, z: 0 }, wantsInsert: true });
      } catch (e) { setError((e as Error).message); }
    }
    if (!added.length) return;
    if (!boxParams) {
      const p0 = analyze(added[0].stl.vertices, added[0].orientation, 3);
      setBoxParams(defaultParams(p0, added[0].orientation));
    }
    setItems((prev) => [...prev, ...added]);
    setSelectedId(added[added.length - 1].id);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const setItemOrientation = (id: string, o: Orientation) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, orientation: o } : it)));

  const setItemOffset = (id: string, off: Offset) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, offset: off } : it)));

  const setItemWantsInsert = (id: string, wantsInsert: boolean) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, wantsInsert } : it)));

  // Productos reanalizados (dependen de cada orientación + secciones globales).
  const sliceCount = boxParams?.sliceCount ?? 3;
  const products = useMemo(
    () => items.map((it) => analyze(it.stl.vertices, it.orientation, sliceCount)),
    [items, sliceCount]
  );

  const single = products.length === 1;
  const effMode: BoxMode = single ? "single-insert" : mode;
  const selIdx = items.findIndex((it) => it.id === selectedId);
  const selItem = selIdx >= 0 ? items[selIdx] : items[0];
  const selProduct = selIdx >= 0 ? products[selIdx] : products[0];

  // Altura del producto más alto: gobierna las medidas derivadas de la caja.
  const govZ = useMemo(() => products.reduce((m, p) => Math.max(m, p.z), 0), [products]);
  // Re-deriva alto de pared/tapa/solapa cuando cambia el producto (otro STL o
  // reorientación), para que la caja ABRACE el producto y no desperdicie espacio.
  // Respeta los valores que el usuario haya tocado a mano (si difieren del último auto).
  const autoDerived = useRef<{ wall: number; lid: number; tab: number } | null>(null);
  useEffect(() => {
    if (!boxParams || !govZ) return;
    const want = {
      wall: Math.round((govZ + boxParams.clearance) * 10) / 10,
      lid: Math.max(15, Math.round(govZ * 0.4)),
      tab: Math.min(25, Math.max(12, Math.round(govZ * 0.6))),
    };
    const a = autoDerived.current;
    setBoxParams((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (!a || prev.trayWallHeight === a.wall) next.trayWallHeight = want.wall;
      if (!a || prev.lidHeight === a.lid) next.lidHeight = want.lid;
      if (!a || prev.cornerTab === a.tab) next.cornerTab = want.tab;
      return next;
    });
    autoDerived.current = want;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [govZ, boxParams?.clearance]);

  const autoOrient = () => {
    if (!selItem || !boxParams) return;
    const { orientation } = bestOrientation(selItem.stl.vertices, boxParams.sliceCount);
    setItemOrientation(selItem.id, { ...orientation, flip: selItem.orientation.flip });
  };

  // Empaquetado activo (según modo) → posiciones centradas para el 3D.
  const packInfo = useMemo(() => {
    if (!boxParams || !products.length) return null;
    return effMode === "individual-boxes" ? packBoxes(boxParams, products) : packProducts(boxParams, products);
  }, [boxParams, products, effMode]);
  // Posiciones centradas = empaquetado automático + desplazamiento manual (x,y); z = alto.
  const positions = useMemo(
    () =>
      packInfo
        ? packInfo.pos.map((p, i) => {
            const off = items[i]?.offset ?? { x: 0, y: 0, z: 0 };
            return { x: p.x - packInfo.W / 2 + off.x, y: p.y - packInfo.H / 2 + off.y, z: off.z };
          })
        : [],
    [packInfo, items]
  );
  const posCenteredXY = useMemo(() => positions.map((p) => ({ x: p.x, y: p.y })), [positions]);

  // Caja EXTERNA (la que contiene todo): la de mayor huella.
  const outerIdx = useMemo(() => {
    if (!products.length) return 0;
    const sizes = packInfo && "sizes" in packInfo ? (packInfo as { sizes: { w: number; h: number }[] }).sizes : products.map((p) => ({ w: p.x, h: p.y }));
    let best = 0, bestA = -1;
    products.forEach((_, i) => { const a = sizes[i].w * sizes[i].h; if (a > bestA) { bestA = a; best = i; } });
    return best;
  }, [products, packInfo]);

  // Caja EXTERNA (Modo B): su interior = bounding de TODO lo acomodado (producto grande +
  // cajas chicas en su disposición). Las posiciones se recentran en esa caja; las chicas
  // van como cajas adentro (aberturas en el insert).
  const outerBoxB = useMemo(() => {
    if (effMode !== "individual-boxes" || !boxParams || !products.length || !packInfo || !("sizes" in packInfo)) return null;
    const sizes = (packInfo as { sizes: { w: number; h: number }[] }).sizes;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    products.forEach((pr, i) => {
      const hw = i === outerIdx ? pr.x / 2 : sizes[i].w / 2; // el grande por su huella; las chicas por su caja exterior
      const hh = i === outerIdx ? pr.y / 2 : sizes[i].h / 2;
      minX = Math.min(minX, positions[i].x - hw); maxX = Math.max(maxX, positions[i].x + hw);
      minY = Math.min(minY, positions[i].y - hh); maxY = Math.max(maxY, positions[i].y + hh);
    });
    if (!isFinite(minX)) return null;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, W = maxX - minX, H = maxY - minY;
    const zmax = products.reduce((m, pr) => Math.max(m, pr.z), 0);
    return {
      product: rectProduct(W, H, zmax), W, H, sizes,
      relPos: positions.map((p) => ({ x: p.x - cx, y: p.y - cy, z: p.z })),
    };
  }, [effMode, boxParams, products, packInfo, positions, outerIdx]);

  // Modo A (insert único) con varios productos: la caja se ajusta al bounding REAL de los
  // productos ya ubicados (incluye el desplazamiento manual), y recentra las posiciones en
  // él. Así no queda espacio muerto de un costado cuando se mueve un producto hacia adentro.
  const fitA = useMemo(() => {
    if (effMode === "individual-boxes" || single || !products.length || positions.length < products.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    products.forEach((pr, i) => {
      const hw = pr.x / 2, hh = pr.y / 2;
      minX = Math.min(minX, positions[i].x - hw); maxX = Math.max(maxX, positions[i].x + hw);
      minY = Math.min(minY, positions[i].y - hh); maxY = Math.max(maxY, positions[i].y + hh);
    });
    if (!isFinite(minX)) return null;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, W = maxX - minX, H = maxY - minY;
    const zmax = products.reduce((m, pr) => Math.max(m, pr.z), 0);
    return {
      product: rectProduct(W, H, zmax),
      relPos: positions.map((p) => ({ x: p.x - cx, y: p.y - cy, z: p.z })),
    };
  }, [effMode, single, products, positions]);

  // Volúmenes de las cajas chicas (dentro de la caja externa) para el 3D.
  const nestedVolumes = useMemo(() => {
    if (!outerBoxB) return [] as { parent: number; w: number; h: number; z: number; relX: number; relY: number }[];
    return products.map((_, k) => k).filter((k) => k !== outerIdx).map((k) => ({
      parent: outerIdx, w: outerBoxB.sizes[k].w, h: outerBoxB.sizes[k].h, z: products[k].z,
      relX: outerBoxB.relPos[k].x, relY: outerBoxB.relPos[k].y,
    }));
  }, [outerBoxB, products, outerIdx]);

  // Producto sintético para caja/decoración (combinado en A, contenedora en B).
  const designParams = useMemo<Params | null>(() => {
    if (!boxParams || !products.length || !selItem) return null;
    const product = effMode === "individual-boxes"
      ? (outerBoxB?.product ?? products[outerIdx]) // la caja externa contiene todo; se decora sobre ella
      : single ? products[0] : (fitA?.product ?? packProducts(boxParams, products).product);
    return { ...boxParams, product, orientation: selItem.orientation };
  }, [boxParams, products, effMode, single, selItem, outerIdx, outerBoxB, fitA]);

  // Entregables 2D (cada uno descargable por separado como DXF/PDF).
  interface Deliverable { id: string; title: string; model: makerjs.IModel; svg: string }
  const deliverables = useMemo<Deliverable[]>(() => {
    if (!boxParams || !products.length) return [];
    const make = (id: string, title: string, model: makerjs.IModel): Deliverable => ({
      id, title, model, svg: toSVG(model, { stroke: "1.2", responsive: true }),
    });
    try {
      if (effMode === "individual-boxes") {
        const out: Deliverable[] = [];
        const ob = outerBoxB;
        if (ob && products.length > 1) {
          // Caja externa (contiene todo): insert con el producto grande (contorno) +
          // una abertura por cada caja chica, en su posición dentro del bounding.
          const others = products.map((_, k) => k).filter((k) => k !== outerIdx);
          const insertProducts = [products[outerIdx], ...others.map((k) => rectProduct(ob.sizes[k].w, ob.sizes[k].h, products[k].z))];
          const cornerOf = (i: number) => ({ x: ob.relPos[i].x + ob.W / 2, y: ob.relPos[i].y + ob.H / 2 });
          const insertPositions = [cornerOf(outerIdx), ...others.map(cornerOf)];
          const bigName = items[outerIdx]?.name ? ` — ${items[outerIdx].name}` : "";
          out.push(make("externa", `Caja externa${bigName} (contiene todo)`, assembleOuterBox(boxParams, ob.product, insertProducts, insertPositions)));
          others.forEach((k) => {
            const nm = items[k]?.name ? ` — ${items[k].name}` : "";
            // Cajita sin soporte (ej. cables): caja plana, sin insert.
            const model = items[k]?.wantsInsert === false
              ? assembleBox({ ...boxParams, product: products[k] })
              : assembleBoxWithInsert(boxParams, products[k]);
            out.push(make(`caja${k}`, `Caja${nm}`, model));
          });
        } else {
          products.forEach((pr, i) => out.push(make(`caja${i}`, `Caja ${i + 1}`,
            items[i]?.wantsInsert === false ? assembleBox({ ...boxParams, product: pr }) : assembleBoxWithInsert(boxParams, pr))));
        }
        return out;
      }
      // La caja/insert combinados usan el bounding AJUSTADO a las posiciones reales (fitA),
      // para que la caja envuelva los productos sin espacio muerto al desplazarlos.
      const fitPos = fitA ? fitA.relPos.map((p) => ({ x: p.x, y: p.y })) : posCenteredXY;
      return [
        make("caja", single ? "Caja" : "Caja combinada",
          single ? assembleBox({ ...boxParams, product: products[0] })
                 : assembleBox({ ...boxParams, product: fitA?.product ?? packProducts(boxParams, products).product })),
        make("insert", "Insert",
          single ? assembleInsert({ ...boxParams, product: products[0] })
                 : assembleMultiInsert(boxParams, products, fitPos, fitA?.product)),
      ];
    } catch (e) { setError((e as Error).message); return []; }
  }, [boxParams, products, effMode, single, posCenteredXY, items, outerBoxB, outerIdx, fitA]);

  const openPrint = (html: string) => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => w.print(), 400);
  };
  const exportDXF = (model: makerjs.IModel | null, name: string) => {
    if (model) download(`vexionbox_${name}.dxf`, toDXF(model), "application/dxf");
  };
  const exportPDF = (model: makerjs.IModel | null, title: string) => {
    if (model) openPrint(printableHTML(model, `VexionBox — ${title}`));
  };

  const hasItems = items.length > 0 && !!boxParams;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <h1>VexionBox</h1>
          <p>1 · Organizá los productos → 2 · Plegado y cortes (DXF/PDF) → 3 · Diseño para láser</p>
        </div>
        <div className="legal">
          <em>
            Todos los derechos reservados por{" "}
            <a href="https://vexion.ar" target="_blank" rel="noopener noreferrer">Vexion.ar</a>.
            <br />Herramienta de uso gratuito.
          </em>
        </div>
      </header>

      <div className="layout">
        <aside className="panel">
          <label className="upload">
            <input
              type="file" accept=".stl" multiple
              onChange={(e) => e.target.files && e.target.files.length && onFiles(e.target.files)}
            />
            <span>{items.length ? "+ Agregar STL" : "Subir STL del producto"}</span>
          </label>

          {error && <p className="error">⚠ {error}</p>}

          {items.length > 0 && (
            <div className="item-list">
              {items.map((it, i) => (
                <div
                  key={it.id}
                  className={`item-row${it.id === selectedId ? " on" : ""}`}
                  onClick={() => setSelectedId(it.id)}
                >
                  <span className="item-name" title={it.name}>{it.name}</span>
                  <span className="item-dims">
                    {products[i] && `${products[i].x.toFixed(0)}×${products[i].y.toFixed(0)}×${products[i].z.toFixed(0)}`}
                  </span>
                  <button className="axis" onClick={(e) => { e.stopPropagation(); removeItem(it.id); }} title="Quitar">✕</button>
                </div>
              ))}
            </div>
          )}

          {hasItems && boxParams && selItem && selProduct && (
            <Controls
              params={boxParams}
              product={selProduct}
              onChange={setBoxParams}
              orientation={selItem.orientation}
              onOrientation={(o) => setItemOrientation(selItem.id, o)}
              onAutoOrient={autoOrient}
              offset={selItem.offset}
              onOffset={(o) => setItemOffset(selItem.id, o)}
              mode={mode}
              onMode={setMode}
              multiItem={items.length > 1}
              wantsInsert={selItem.wantsInsert}
              onWantsInsert={(v) => setItemWantsInsert(selItem.id, v)}
              showInsertToggle={items.length > 1 && mode === "individual-boxes" && (selIdx >= 0 ? selIdx : 0) !== outerIdx}
            />
          )}

          <div className="legend">
            <span className="cut">— Corte</span>
            <span className="crease">— Pliegue</span>
            <span className="glue">● Pegado/broche</span>
          </div>
        </aside>

        <main className="stage">
          <div className="tabs">
            <button className={view === "product" ? "tab on" : "tab"} onClick={() => setView("product")}>1 · Organizar productos 3D</button>
            <button className={view === "fold" ? "tab on" : "tab"} onClick={() => setView("fold")}>2 · Plegado y cortes 3D</button>
            <button className={view === "design" ? "tab on" : "tab"} onClick={() => setView("design")}>3 · Diseño</button>
          </div>

          <ErrorBoundary label="la vista">
            {!hasItems ? (
              <div className="empty">Subí uno o más STL para empezar</div>
            ) : view === "product" ? (
              <div className="pane-3d">
                <Viewer3D
                  items={items.map((it) => ({ id: it.id, buffer: it.buffer, orientation: it.orientation }))}
                  positions={positions}
                />
                <p className="stage-hint">Acomodá los productos (orientación y desplazamiento). Los cortes se generan en el paso 2.</p>
              </div>
            ) : view === "fold" ? (
              <div className="fold-and-cuts">
                <div className="pane-3d">
                  {designParams && (
                    <FoldSim
                      params={designParams}
                      mode={effMode}
                      items={items.map((it) => ({ id: it.id, buffer: it.buffer, orientation: it.orientation }))}
                      products={products}
                      positions={effMode === "individual-boxes" && outerBoxB ? outerBoxB.relPos : (fitA?.relPos ?? positions)}
                      nestedVolumes={nestedVolumes}
                      outerIdx={outerIdx}
                      placements={placements}
                      images={images}
                    />
                  )}
                </div>
                <section className="stage-2d">
                  {deliverables.length === 0 ? (
                    <div className="empty">Los cortes aparecerán acá</div>
                  ) : (
                    deliverables.map((d) => (
                      <div key={d.id} className="deliverable">
                        <div className="dieline-head">
                          <h2>{d.title}</h2>
                          <div className="dl-actions">
                            <button onClick={() => exportDXF(d.model, d.id)}>⬇ DXF</button>
                            <button onClick={() => exportPDF(d.model, d.title)} className="secondary">⬇ PDF A4</button>
                          </div>
                        </div>
                        <div className="svg-wrap" dangerouslySetInnerHTML={{ __html: d.svg }} />
                      </div>
                    ))
                  )}
                </section>
              </div>
            ) : (
              <div className="pane-design">
                {designParams && (
                  <DesignView
                    p={designParams}
                    images={images}
                    placements={placements}
                    onImages={setImages}
                    onPlacements={setPlacements}
                  />
                )}
              </div>
            )}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
