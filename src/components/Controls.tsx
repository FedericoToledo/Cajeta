// Panel de parámetros editables. La orientación/desplazamiento operan sobre el STL
// seleccionado; el resto (material/caja/insert) es global. Con varios STL aparece el
// selector de modo. Cada control tiene slider + input numérico para ajuste fino.
import { Params, BoxType, BoxMode } from "../lib/types";
import { ProductModel, UpAxis, Orientation } from "../lib/product";

interface Props {
  params: Params;
  product: ProductModel;
  onChange: (p: Params) => void;
  orientation: Orientation;
  onOrientation: (o: Orientation) => void;
  onAutoOrient: () => void;
  offset: { x: number; y: number; z: number };
  onOffset: (o: { x: number; y: number; z: number }) => void;
  mode: BoxMode;
  onMode: (m: BoxMode) => void;
  multiItem: boolean;
}

/** Slider + input numérico. */
function NumField({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="row">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))} />
        <input type="number" min={min} max={max} step={step} value={value}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(v); }} />
      </div>
    </label>
  );
}

interface FieldDef {
  key: keyof Omit<Params, "product" | "orientation" | "useContour">;
  label: string; min: number; max: number; step: number;
}
const FIELDS: FieldDef[] = [
  { key: "clearance", label: "Holgura producto (mm)", min: 0, max: 20, step: 0.5 },
  { key: "thickness", label: "Espesor cartón (mm)", min: 0.5, max: 8, step: 0.5 },
  { key: "trayWallHeight", label: "Alto pared bandeja (mm)", min: 5, max: 400, step: 1 },
  { key: "lidHeight", label: "Alto tapa (mm)", min: 5, max: 400, step: 1 },
  { key: "lidClearance", label: "Holgura tapa (mm)", min: 0, max: 5, step: 0.1 },
  { key: "cornerTab", label: "Solapa de esquina (mm)", min: 5, max: 60, step: 1 },
  { key: "gripMargin", label: "Agarre insert (mm)", min: -5, max: 15, step: 0.5 },
  { key: "sliceCount", label: "Repisas del insert (por altura)", min: 1, max: 6, step: 1 },
  { key: "kerf", label: "Kerf / fresa (mm)", min: 0, max: 6, step: 0.5 },
];

const UP_AXES: { key: UpAxis; label: string }[] = [
  { key: "x", label: "X" }, { key: "y", label: "Y" }, { key: "z", label: "Z" },
];
const OFF_AXES: ("x" | "y" | "z")[] = ["x", "y", "z"];

export default function Controls({
  params, product, onChange, orientation, onOrientation, onAutoOrient, offset, onOffset, mode, onMode, multiItem,
}: Props) {
  const setUp = (up: UpAxis) => onOrientation({ ...orientation, up });
  const setType = (boxType: BoxType) => onChange({ ...params, boxType });

  return (
    <div className="controls">
      {multiItem && (
        <>
          <h3>Modo (varios STL)</h3>
          <div className="axes">
            <button className={mode === "single-insert" ? "axis on" : "axis"} onClick={() => onMode("single-insert")}>Insert único</button>
            <button className={mode === "individual-boxes" ? "axis on" : "axis"} onClick={() => onMode("individual-boxes")}>Cajas individuales</button>
          </div>
        </>
      )}

      <h3>Tipo de caja</h3>
      <div className="axes">
        <button className={params.boxType === "tray-lid" ? "axis on" : "axis"} onClick={() => setType("tray-lid")}>Bandeja + tapa</button>
        <button className={params.boxType === "chest" ? "axis on" : "axis"} onClick={() => setType("chest")}>Cofre</button>
      </div>
      <label className="check">
        <input type="checkbox" checked={params.topFlaps} onChange={(e) => onChange({ ...params, topFlaps: e.target.checked })} />
        <span>Solapas superiores hacia adentro (encastre + rigidez)</span>
      </label>

      <h3>Orientación del STL{multiItem ? " seleccionado" : ""}</h3>
      <div className="axes">
        <span>Eje vertical:</span>
        {UP_AXES.map((a) => (
          <button key={a.key} className={orientation.up === a.key ? "axis on" : "axis"} onClick={() => setUp(a.key)}>{a.label}</button>
        ))}
        <button className="axis" onClick={onAutoOrient} title="Minimiza material">⚙ Óptima</button>
      </div>
      <NumField label="Giro en el plano (°)" value={orientation.rotateDeg} min={0} max={180} step={5}
        onChange={(v) => onOrientation({ ...orientation, rotateDeg: v })} />
      <label className="check">
        <input type="checkbox" checked={orientation.flip} onChange={(e) => onOrientation({ ...orientation, flip: e.target.checked })} />
        <span>Invertir arriba/abajo (flip)</span>
      </label>
      <p className="meta">
        Orientado: {product.x.toFixed(1)} × {product.y.toFixed(1)} × {product.z.toFixed(1)} mm · {product.slices.length} secciones
      </p>

      <h3>Desplazar STL{multiItem ? " seleccionado" : ""} (mm)</h3>
      {OFF_AXES.map((ax) => (
        <NumField key={ax} label={ax.toUpperCase()} value={offset[ax]} min={-400} max={400} step={1}
          onChange={(v) => onOffset({ ...offset, [ax]: v })} />
      ))}
      <button className="axis" onClick={() => onOffset({ x: 0, y: 0, z: 0 })}>Centrar</button>

      <h3>Insert de suspensión</h3>
      <label className="check">
        <input type="checkbox" checked={params.useContour} onChange={(e) => onChange({ ...params, useContour: e.target.checked })} />
        <span>Ventanas según contorno real (por sección)</span>
      </label>
      <NumField label="Apriete contra la tapa (mm)" value={params.squeeze} min={0} max={8} step={0.5}
        onChange={(v) => onChange({ ...params, squeeze: v })} />

      <h3>Parámetros de caja</h3>
      {FIELDS.map((f) => (
        <NumField key={f.key} label={f.label} value={params[f.key] as number} min={f.min} max={f.max} step={f.step}
          onChange={(v) => onChange({ ...params, [f.key]: v })} />
      ))}
    </div>
  );
}
