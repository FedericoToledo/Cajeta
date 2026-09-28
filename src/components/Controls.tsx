// Panel de parámetros editables.
import { Params, BoxType } from "../lib/types";
import { ProductModel, UpAxis } from "../lib/product";

interface Props {
  params: Params;
  product: ProductModel; // producto ya reanalizado (para mostrar dims/secciones)
  onChange: (p: Params) => void;
  onAutoOrient: () => void; // calcula la orientación óptima
}

interface FieldDef {
  key: keyof Omit<Params, "product" | "orientation" | "useContour">;
  label: string;
  min: number;
  max: number;
  step: number;
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
  { key: "x", label: "X" },
  { key: "y", label: "Y" },
  { key: "z", label: "Z" },
];

export default function Controls({ params, product, onChange, onAutoOrient }: Props) {
  const set = (key: FieldDef["key"], value: number) =>
    onChange({ ...params, [key]: value });

  const setUp = (up: UpAxis) =>
    onChange({ ...params, orientation: { ...params.orientation, up } });

  const setRotate = (rotateDeg: number) =>
    onChange({ ...params, orientation: { ...params.orientation, rotateDeg } });

  const setType = (boxType: BoxType) => onChange({ ...params, boxType });

  return (
    <div className="controls">
      <h3>Tipo de caja</h3>
      <div className="axes">
        <button
          className={params.boxType === "tray-lid" ? "axis on" : "axis"}
          onClick={() => setType("tray-lid")}
        >
          Bandeja + tapa
        </button>
        <button
          className={params.boxType === "chest" ? "axis on" : "axis"}
          onClick={() => setType("chest")}
        >
          Cofre
        </button>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={params.topFlaps}
          onChange={(e) => onChange({ ...params, topFlaps: e.target.checked })}
        />
        <span>Solapas superiores hacia adentro (encastre + rigidez)</span>
      </label>

      <h3>Orientación del producto</h3>
      <div className="axes">
        <span>Eje vertical:</span>
        {UP_AXES.map((a) => (
          <button
            key={a.key}
            className={params.orientation.up === a.key ? "axis on" : "axis"}
            onClick={() => setUp(a.key)}
          >
            {a.label}
          </button>
        ))}
        <button className="axis" onClick={onAutoOrient} title="Minimiza material">
          ⚙ Óptima
        </button>
      </div>
      <label className="field">
        <span>
          Giro en el plano: <b>{params.orientation.rotateDeg}°</b>
        </span>
        <input
          type="range"
          min={0}
          max={180}
          step={5}
          value={params.orientation.rotateDeg}
          onChange={(e) => setRotate(parseInt(e.target.value, 10))}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={params.orientation.flip}
          onChange={(e) =>
            onChange({ ...params, orientation: { ...params.orientation, flip: e.target.checked } })
          }
        />
        <span>Invertir arriba/abajo (flip)</span>
      </label>
      <p className="meta">
        Orientado: {product.x.toFixed(1)} × {product.y.toFixed(1)} ×{" "}
        {product.z.toFixed(1)} mm · {product.slices.length} secciones
      </p>

      <h3>Insert de suspensión</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={params.useContour}
          onChange={(e) => onChange({ ...params, useContour: e.target.checked })}
        />
        <span>Ventanas según contorno real (por sección)</span>
      </label>
      <label className="field">
        <span>
          Apriete contra la tapa (mm): <b>{params.squeeze.toFixed(1)}</b>
        </span>
        <input
          type="range"
          min={0}
          max={8}
          step={0.5}
          value={params.squeeze}
          onChange={(e) => onChange({ ...params, squeeze: parseFloat(e.target.value) })}
        />
      </label>

      <h3>Parámetros de caja</h3>
      {FIELDS.map((f) => (
        <label key={f.key} className="field">
          <span>
            {f.label}: <b>{Number(params[f.key]).toFixed(f.step < 1 ? 1 : 0)}</b>
          </span>
          <input
            type="range"
            min={f.min}
            max={f.max}
            step={f.step}
            value={params[f.key] as number}
            onChange={(e) => set(f.key, parseFloat(e.target.value))}
          />
        </label>
      ))}
    </div>
  );
}
