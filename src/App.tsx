import { useMemo, useState } from "react";
import Viewer3D from "./components/Viewer3D";
import FoldSim from "./components/FoldSim";
import Controls from "./components/Controls";
import { parseSTL, ParsedSTL } from "./lib/stl";
import { analyze, Orientation } from "./lib/product";
import { bestOrientation } from "./lib/optimize";
import { Params, defaultParams } from "./lib/types";
import { assembleBox, assembleInsert } from "./lib/assemble";
import { toDXF, toSVG, download, printableHTML } from "./lib/exporters";

export default function App() {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [stl, setStl] = useState<ParsedSTL | null>(null);
  const [params, setParams] = useState<Params | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"product" | "fold">("product");

  const onFile = async (file: File) => {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseSTL(buf);
      const orientation: Orientation = { up: "z", rotateDeg: 0, flip: false };
      const product = analyze(parsed.vertices, orientation, 3);
      setBuffer(buf);
      setStl(parsed);
      setParams(defaultParams(product, orientation));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Recalcula el producto (bbox + huella + secciones) sólo cuando cambia la
  // orientación o la cantidad de secciones.
  const product = useMemo(() => {
    if (!stl || !params) return null;
    return analyze(stl.vertices, params.orientation, params.sliceCount);
  }, [stl, params?.orientation.up, params?.orientation.rotateDeg, params?.sliceCount]);

  // Parámetros efectivos: los editables + el producto reanalizado.
  const eff = useMemo(
    () => (params && product ? { ...params, product } : null),
    [params, product]
  );

  // Previews separados (líneas gruesas + responsive, sólo visualización).
  const svgBox = useMemo(() => {
    if (!eff) return null;
    try { return toSVG(assembleBox(eff), { stroke: "1.2", responsive: true }); }
    catch (e) { setError((e as Error).message); return null; }
  }, [eff]);
  const svgInsert = useMemo(() => {
    if (!eff) return null;
    try { return toSVG(assembleInsert(eff), { stroke: "1.2", responsive: true }); }
    catch (e) { setError((e as Error).message); return null; }
  }, [eff]);

  const autoOrient = () => {
    if (!stl || !params) return;
    const { orientation } = bestOrientation(stl.vertices, params.sliceCount);
    setParams({ ...params, orientation: { ...orientation, flip: params.orientation.flip } });
  };

  const exportDXFBox = () => {
    if (eff) download("cajeta_caja.dxf", toDXF(assembleBox(eff)), "application/dxf");
  };
  const exportDXFInsert = () => {
    if (eff) download("cajeta_insert.dxf", toDXF(assembleInsert(eff)), "application/dxf");
  };

  // Abre una ventana A4 imprimible (guardar como PDF para pruebas en papel).
  const openPrint = (html: string) => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };
  const exportPDFBox = () => {
    if (eff) openPrint(printableHTML(assembleBox(eff), "Cajeta — Caja"));
  };
  const exportPDFInsert = () => {
    if (eff) openPrint(printableHTML(assembleInsert(eff), "Cajeta — Insert"));
  };

  return (
    <div className="app">
      <header>
        <h1>Cajeta</h1>
        <p>STL → caja de cartón + insert de suspensión → DXF separados (caja / insert) para router CNC</p>
      </header>

      <div className="layout">
        <aside className="panel">
          <label className="upload">
            <input
              type="file"
              accept=".stl"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            <span>Subir STL del producto</span>
          </label>

          {error && <p className="error">⚠ {error}</p>}

          {stl && eff && (
            <p className="meta">
              Triángulos: {stl.triangles.toLocaleString()} · Producto orientado{" "}
              {eff.product.x.toFixed(1)} × {eff.product.y.toFixed(1)} ×{" "}
              {eff.product.z.toFixed(1)} mm
            </p>
          )}

          {params && eff && (
            <Controls
              params={params}
              product={eff.product}
              onChange={setParams}
              onAutoOrient={autoOrient}
            />
          )}

          <div className="legend">
            <span className="cut">— Corte</span>
            <span className="crease">— Pliegue</span>
            <span className="glue">● Pegado/broche</span>
          </div>
        </aside>

        <main className="stage">
          <section className="stage-3d">
            <div className="tabs">
              <button
                className={view === "product" ? "tab on" : "tab"}
                onClick={() => setView("product")}
              >
                Producto 3D
              </button>
              <button
                className={view === "fold" ? "tab on" : "tab"}
                onClick={() => setView("fold")}
              >
                Plegado 3D
              </button>
            </div>
            {!buffer ? (
              <div className="empty">Subí un STL para empezar</div>
            ) : view === "product" ? (
              <Viewer3D buffer={buffer} orientation={params?.orientation} />
            ) : (
              eff && (
                <FoldSim buffer={buffer} orientation={params?.orientation} params={eff} />
              )
            )}
          </section>
          <section className="stage-2d">
            <div className="dieline-head">
              <h2>Dieline — Caja</h2>
              {eff && (
                <div className="dl-actions">
                  <button onClick={exportDXFBox}>⬇ DXF</button>
                  <button onClick={exportPDFBox} className="secondary">⬇ PDF A4</button>
                </div>
              )}
            </div>
            {svgBox ? (
              <div className="svg-wrap" dangerouslySetInnerHTML={{ __html: svgBox }} />
            ) : (
              <div className="empty">El dieline de la caja aparecerá acá</div>
            )}
            <div className="dieline-head">
              <h2>Dieline — Insert</h2>
              {eff && (
                <div className="dl-actions">
                  <button onClick={exportDXFInsert}>⬇ DXF</button>
                  <button onClick={exportPDFInsert} className="secondary">⬇ PDF A4</button>
                </div>
              )}
            </div>
            {svgInsert ? (
              <div className="svg-wrap" dangerouslySetInnerHTML={{ __html: svgInsert }} />
            ) : (
              <div className="empty">El dieline del insert aparecerá acá</div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
