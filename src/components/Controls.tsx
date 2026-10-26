// Panel de parámetros editables. La orientación/desplazamiento operan sobre el STL
// seleccionado; el resto (material/caja/insert) es global. Con varios STL aparece el
// selector de modo. Cada control tiene slider + input numérico para ajuste fino.
import { ReactNode, useLayoutEffect, useRef } from "react";
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
  wantsInsert: boolean;
  onWantsInsert: (v: boolean) => void;
  showInsertToggle: boolean; // el flag por producto solo aplica en "Cajas individuales" (no la caja externa)
  compact: boolean; // en el teléfono el insert arranca cerrado
  section: "product" | "box" | "insert" | "both";
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
const BOX_FIELDS: FieldDef[] = [
  { key: "clearance", label: "Holgura producto (mm)", min: 0, max: 20, step: 0.5 },
  { key: "thickness", label: "Espesor cartón (mm)", min: 0.5, max: 8, step: 0.5 },
  { key: "trayWallHeight", label: "Alto pared (mm)", min: 5, max: 400, step: 1 },
  { key: "lidHeight", label: "Alto tapa (mm)", min: 5, max: 400, step: 1 },
  { key: "lidClearance", label: "Holgura tapa (mm)", min: 0, max: 5, step: 0.1 },
  { key: "cornerTab", label: "Solapa de esquina (mm)", min: 5, max: 60, step: 1 },
  { key: "kerf", label: "Kerf / fresa (mm)", min: 0, max: 6, step: 0.5 },
];
const INSERT_FIELDS: FieldDef[] = [
  { key: "gripMargin", label: "Agarre (mm)", min: -5, max: 15, step: 0.5 },
  { key: "sliceCount", label: "Repisas (por altura)", min: 1, max: 6, step: 1 },
  { key: "squeeze", label: "Apriete contra la tapa (mm)", min: 0, max: 8, step: 0.5 },
];

function Group({ title, hint, startOpen, children }: {
  title: string; hint: string; startOpen: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => { if (ref.current) ref.current.open = startOpen; }, [startOpen]);
  return (
    <details className="group" ref={ref}>
      <summary>
        <span>{title}</span>
        <span className="hint">{hint}</span>
        <i className="chev" />
      </summary>
      <div className="group-body">{children}</div>
    </details>
  );
}

const UP_AXES: { key: UpAxis; label: string }[] = [
  { key: "x", label: "X" }, { key: "y", label: "Y" }, { key: "z", label: "Z" },
];
const OFF_AXES: ("x" | "y" | "z")[] = ["x", "y", "z"];

export default function Controls({
  params, product, onChange, orientation, onOrientation, onAutoOrient, offset, onOffset, mode, onMode, multiItem,
  wantsInsert, onWantsInsert, showInsertToggle, compact, section,
}: Props) {
  const setUp = (up: UpAxis) => onOrientation({ ...orientation, up });
  const setType = (boxType: BoxType) => onChange({ ...params, boxType });
  const boxHint = params.boxType === "chest" ? "Cofre" : "Bandeja + tapa";
  const insertHint = params.useContour ? `${params.sliceCount} repisas · contorno` : `${params.sliceCount} repisas`;
  const showBox = section === "box" || section === "both";
  const showInsert = section === "insert" || section === "both";

  return (
    <div className="controls" key={compact ? "compact" : "wide"}>
      {section === "product" && multiItem && (
        <>
          <h3>Modo</h3>
          <div className="axes">
            <button className={mode === "single-insert" ? "axis on" : "axis"} onClick={() => onMode("single-insert")}>Insert único</button>
            <button className={mode === "individual-boxes" ? "axis on" : "axis"} onClick={() => onMode("individual-boxes")}>Cajas individuales</button>
          </div>
        </>
      )}

      {section === "product" && (
      <Group title="Producto" hint={`${product.x.toFixed(0)}×${product.y.toFixed(0)}×${product.z.toFixed(0)} mm`} startOpen>
        <div className="axes">
          <span>Eje vertical</span>
          {UP_AXES.map((a) => (
            <button key={a.key} className={orientation.up === a.key ? "axis on" : "axis"} onClick={() => setUp(a.key)}>{a.label}</button>
          ))}
          <button className="axis" onClick={onAutoOrient} title="Minimiza material">Óptima</button>
        </div>
        <NumField label="Giro en el plano (°)" value={orientation.rotateDeg} min={0} max={180} step={5}
          onChange={(v) => onOrientation({ ...orientation, rotateDeg: v })} />
        <label className="check">
          <input type="checkbox" checked={orientation.flip} onChange={(e) => onOrientation({ ...orientation, flip: e.target.checked })} />
          <span>Invertir arriba/abajo</span>
        </label>
        <p className="meta">Desplazar{multiItem ? " el STL seleccionado" : ""} (mm)</p>
        {OFF_AXES.map((ax) => (
          <NumField key={ax} label={ax.toUpperCase()} value={offset[ax]} min={-800} max={800} step={1}
            onChange={(v) => onOffset({ ...offset, [ax]: v })} />
        ))}
        <button className="axis" onClick={() => onOffset({ x: 0, y: 0, z: 0 })}>Centrar</button>
      </Group>
      )}

      {showBox && (
      <Group title="Caja" hint={boxHint} startOpen>
        <div className="axes">
          <button className={params.boxType === "tray-lid" ? "axis on" : "axis"} onClick={() => setType("tray-lid")}>Bandeja + tapa</button>
          <button className={params.boxType === "chest" ? "axis on" : "axis"} onClick={() => setType("chest")}>Cofre</button>
        </div>
        <label className="check">
          <input type="checkbox" checked={params.topFlaps} onChange={(e) => onChange({ ...params, topFlaps: e.target.checked })} />
          <span>Solapas superiores hacia adentro</span>
        </label>
        {BOX_FIELDS.map((f) => (
          <NumField key={f.key} label={f.label} value={params[f.key] as number} min={f.min} max={f.max} step={f.step}
            onChange={(v) => onChange({ ...params, [f.key]: v })} />
        ))}
      </Group>
      )}

      {showInsert && (
      <Group title="Insert" hint={insertHint} startOpen={section === "insert" || !compact}>
        {showInsertToggle && (
          <label className="check">
            <input type="checkbox" checked={wantsInsert} onChange={(e) => onWantsInsert(e.target.checked)} />
            <span>Esta pieza lleva insert</span>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={params.useContour} onChange={(e) => onChange({ ...params, useContour: e.target.checked })} />
          <span>Ventana según el contorno real</span>
        </label>
        {INSERT_FIELDS.map((f) => (
          <NumField key={f.key} label={f.label} value={params[f.key] as number} min={f.min} max={f.max} step={f.step}
            onChange={(v) => onChange({ ...params, [f.key]: v })} />
        ))}
      </Group>
      )}
    </div>
  );
}
