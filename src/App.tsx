import { useMemo, useState } from "react";
import Viewer3D from "./components/Viewer3D";
import FoldSim from "./components/FoldSim";
import Controls from "./components/Controls";
import DesignView from "./components/DesignView";
import ErrorBoundary from "./components/ErrorBoundary";
import { DesignImage, Placement } from "./lib/design";
import { parseSTL, ParsedSTL } from "./lib/stl";
import { analyze, Orientation } from "./lib/product";
import { bestOrientation } from "./lib/optimize";
import { Params, BoxMode, defaultParams } from "./lib/types";
import {
  assembleBox, assembleInsert, assembleMultiBox, assembleMultiInsert,
  assembleContainer, assembleBoxWithInsert, packProducts, packBoxes,
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
        added.push({ id: `stl-${Math.random().toString(36).slice(2, 8)}`, name: file.name, buffer: buf, stl, orientation: defaultOrientation(), offset: { x: 0, y: 0, z: 0 } });
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

  // Producto sintético para caja/decoración (combinado en A, contenedora en B).
  const designParams = useMemo<Params | null>(() => {
    if (!boxParams || !products.length || !selItem) return null;
    const product = effMode === "individual-boxes"
      ? packBoxes(boxParams, products).product
      : single ? products[0] : packProducts(boxParams, products).product;
    return { ...boxParams, product, orientation: selItem.orientation };
  }, [boxParams, products, effMode, single, selItem]);

  // Entregables 2D (cada uno descargable por separado como DXF/PDF).
  interface Deliverable { id: string; title: string; model: makerjs.IModel; svg: string }
  const deliverables = useMemo<Deliverable[]>(() => {
    if (!boxParams || !products.length) return [];
    const make = (id: string, title: string, model: makerjs.IModel): Deliverable => ({
      id, title, model, svg: toSVG(model, { stroke: "1.2", responsive: true }),
    });
    try {
      if (effMode === "individual-boxes") {
        const out = [make("contenedora", "Contenedora", assembleContainer(boxParams, products))];
        products.forEach((pr, i) => {
          const name = items[i]?.name ? ` — ${items[i].name}` : "";
          out.push(make(`caja${i}`, `Caja ${i + 1}${name} (con insert)`, assembleBoxWithInsert(boxParams, pr)));
        });
        return out;
      }
      return [
        make("caja", single ? "Caja" : "Caja combinada",
          single ? assembleBox({ ...boxParams, product: products[0] }) : assembleMultiBox(boxParams, products)),
        make("insert", "Insert",
          single ? assembleInsert({ ...boxParams, product: products[0] }) : assembleMultiInsert(boxParams, products, posCenteredXY)),
      ];
    } catch (e) { setError((e as Error).message); return []; }
  }, [boxParams, products, effMode, single, posCenteredXY, items]);

  const openPrint = (html: string) => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => w.print(), 400);
  };
  const exportDXF = (model: makerjs.IModel | null, name: string) => {
    if (model) download(`cajeta_${name}.dxf`, toDXF(model), "application/dxf");
  };
  const exportPDF = (model: makerjs.IModel | null, title: string) => {
    if (model) openPrint(printableHTML(model, `Cajeta — ${title}`));
  };

  const hasItems = items.length > 0 && !!boxParams;

  return (
    <div className="app">
      <header>
        <h1>Cajeta</h1>
        <p>1 · Organizá los productos → 2 · Plegado y cortes (DXF/PDF) → 3 · Diseño para láser</p>
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
                      positions={positions}
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
