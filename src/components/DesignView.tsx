// Vista "Diseño": subir/arrastrar imágenes y colocarlas sobre las caras del
// dieline plano (tapa top + costados de tapa y bandeja). Manipulación directa
// con mouse o dedos: mover, redimensionar, rotar y pellizco de dos dedos.
// Exporta un SVG en mm con líneas de corte/pliegue + imágenes embebidas.
import { useEffect, useMemo, useRef, useState } from "react";
import { Params } from "../lib/types";
import { assembleBox } from "../lib/assemble";
import { toSVG, download } from "../lib/exporters";
import {
  DesignImage, Placement, FaceRect,
  faceRects, designToSVG, defaultPlacement, modelBounds, placementSVGBox,
} from "../lib/design";

interface Props {
  p: Params;
  images: DesignImage[];
  placements: Placement[];
  onImages: (imgs: DesignImage[]) => void;
  onPlacements: (pls: Placement[]) => void;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

type Vec = { x: number; y: number };
type Gesture = {
  id: string;
  mode: "move" | "scale" | "rotate" | "pinch";
  pointers: Map<number, Vec>; // posiciones actuales en coords SVG
  startPtr: Vec; // primer puntero al iniciar
  center: Vec; // centro de la colocación al iniciar (fijo salvo pinch)
  off: [number, number];
  scale: number;
  rot: number;
  startDist: number; // pinch
  startAngle: number; // pinch/rotate
  startCentroid: Vec; // pinch
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function DesignView({ p, images, placements, onImages, onPlacements }: Props) {
  const faces: FaceRect[] = useMemo(() => faceRects(p), [p]);
  const model = useMemo(() => assembleBox(p), [p]);
  const bounds = useMemo(() => modelBounds(model), [model]);
  const imgMap = useMemo(() => Object.fromEntries(images.map((i) => [i.id, i])), [images]);
  const bg = useMemo(() => toSVG(model, { stroke: "2.6", responsive: true }), [model]);

  const [selected, setSelected] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [unitPx, setUnitPx] = useState(4); // px por unidad SVG (mm), para handles

  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);

  // Mantiene la relación px/mm para dibujar handles de tamaño constante.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0 && bounds.w > 0) setUnitPx(w / bounds.w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [bounds.w]);

  const facesById = useMemo(() => new Map(faces.map((f) => [f.id, f])), [faces]);

  const addImages = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) return;
    const added: DesignImage[] = [];
    for (const file of arr) {
      const dataUrl = await readAsDataURL(file);
      added.push({ id: `img-${Math.random().toString(36).slice(2, 8)}`, name: file.name, dataUrl });
    }
    onImages([...images, ...added]);
    // Coloca cada imagen nueva en la primera cara libre y selecciona la última.
    const used = new Set(placements.map((pl) => pl.faceId));
    const newPls: Placement[] = [];
    for (const im of added) {
      const free = faces.find((f) => !used.has(f.id) && !newPls.some((n) => n.faceId === f.id));
      const face = free ?? faces[0];
      if (face) { const pl = defaultPlacement(im.id, face.id); newPls.push(pl); }
    }
    if (newPls.length) {
      onPlacements([...placements, ...newPls]);
      setSelected(newPls[newPls.length - 1].id);
    }
  };

  const removeImage = (id: string) => {
    onImages(images.filter((i) => i.id !== id));
    onPlacements(placements.filter((pl) => pl.imageId !== id));
  };

  const updatePlacement = (id: string, patch: Partial<Placement>) =>
    onPlacements(placements.map((pl) => (pl.id === id ? { ...pl, ...patch } : pl)));

  const removePlacement = (id: string) => {
    onPlacements(placements.filter((pl) => pl.id !== id));
    if (selected === id) setSelected(null);
  };

  const exportSVG = () => {
    const svg = designToSVG(p, placements, imgMap, model, { responsive: false });
    download("cajeta_diseno_laser.svg", svg, "image/svg+xml");
  };

  // --- Manipulación directa (pointer events, mouse + táctil) ---
  const toSvg = (e: React.PointerEvent): Vec => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM();
    const q = m ? pt.matrixTransform(m.inverse()) : pt;
    return { x: q.x, y: q.y };
  };

  const boxOf = (pl: Placement) => {
    const f = facesById.get(pl.faceId)!;
    return placementSVGBox(pl, f, bounds);
  };

  const beginGesture = (
    e: React.PointerEvent, pl: Placement, mode: Gesture["mode"]
  ) => {
    e.stopPropagation();
    setSelected(pl.id);
    const pos = toSvg(e);
    const box = boxOf(pl);
    const center = { x: box.cx, y: box.cy };
    if (!gesture.current || gesture.current.id !== pl.id) {
      gesture.current = {
        id: pl.id, mode, pointers: new Map(), startPtr: pos, center,
        off: [pl.offX, pl.offY], scale: pl.scale, rot: pl.rot,
        startDist: 0, startAngle: Math.atan2(pos.y - center.y, pos.x - center.x),
        startCentroid: pos,
      };
    }
    gesture.current.pointers.set(e.pointerId, pos);
    // Segundo dedo sobre la misma colocación => pellizco (escala + giro + mover).
    if (gesture.current.pointers.size === 2) {
      const [a, b] = [...gesture.current.pointers.values()];
      gesture.current.mode = "pinch";
      gesture.current.startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      gesture.current.startAngle = Math.atan2(b.y - a.y, b.x - a.x);
      gesture.current.startCentroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture.current.off = [pl.offX, pl.offY];
      gesture.current.scale = pl.scale;
      gesture.current.rot = pl.rot;
    }
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !g.pointers.has(e.pointerId)) return;
    const pos = toSvg(e);
    g.pointers.set(e.pointerId, pos);

    if (g.mode === "pinch" && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const cen = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      updatePlacement(g.id, {
        scale: clamp((g.scale * dist) / g.startDist, 0.1, 6),
        rot: g.rot + ((ang - g.startAngle) * 180) / Math.PI,
        offX: g.off[0] + (cen.x - g.startCentroid.x),
        offY: g.off[1] - (cen.y - g.startCentroid.y),
      });
      return;
    }
    if (g.mode === "move") {
      updatePlacement(g.id, {
        offX: g.off[0] + (pos.x - g.startPtr.x),
        offY: g.off[1] - (pos.y - g.startPtr.y),
      });
    } else if (g.mode === "scale") {
      const d0 = Math.hypot(g.startPtr.x - g.center.x, g.startPtr.y - g.center.y) || 1;
      const d1 = Math.hypot(pos.x - g.center.x, pos.y - g.center.y);
      updatePlacement(g.id, { scale: clamp((g.scale * d1) / d0, 0.1, 6) });
    } else if (g.mode === "rotate") {
      const ang = Math.atan2(pos.y - g.center.y, pos.x - g.center.x);
      updatePlacement(g.id, { rot: g.rot + ((ang - g.startAngle) * 180) / Math.PI });
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    g.pointers.delete(e.pointerId);
    svgRef.current?.releasePointerCapture?.(e.pointerId);
    if (g.pointers.size === 0) gesture.current = null;
    else if (g.mode === "pinch" && g.pointers.size === 1) {
      // Vuelve a modo mover con el dedo restante.
      const [only] = [...g.pointers.entries()];
      const pl = placements.find((x) => x.id === g.id);
      if (pl) {
        g.mode = "move"; g.startPtr = only[1];
        g.off = [pl.offX, pl.offY];
      }
    }
  };

  const HR = 8 / unitPx; // radio de handle en unidades SVG (≈8px)
  const SW = 1.5 / unitPx; // grosor de trazo de selección

  return (
    <div className="design">
      <div
        ref={wrapRef}
        className={`design-canvas${dragOver ? " over" : ""}`}
        style={{ aspectRatio: `${bounds.w} / ${Math.max(1, bounds.h)}` }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addImages(e.dataTransfer.files); }}
      >
        <div className="bg" dangerouslySetInnerHTML={{ __html: bg }} />
        <svg
          ref={svgRef}
          className="overlay"
          viewBox={`0 0 ${bounds.w} ${bounds.h}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={() => setSelected(null)}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        >
          {/* Nombres de cara en marca de agua (sólo guía; no se exporta). */}
          <g style={{ pointerEvents: "none" }}>
            {faces.map((f) => {
              const cx = f.x - bounds.low0 + f.w / 2;
              const cy = bounds.high1 - (f.y + f.h / 2);
              const fs = Math.max(4, Math.min(f.w, f.h) * 0.2);
              return (
                <text key={f.id} x={cx} y={cy} fontSize={fs} fill="#6b4a2b" opacity={0.28}
                  textAnchor="middle" dominantBaseline="middle" fontWeight={700}>
                  {f.label}
                </text>
              );
            })}
          </g>

          {placements.map((pl) => {
            const f = facesById.get(pl.faceId);
            const img = imgMap[pl.imageId];
            if (!f || !img) return null;
            const box = placementSVGBox(pl, f, bounds);
            const isSel = selected === pl.id;
            const par = pl.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
            // Recorte al box de la cara: la imagen no puede exceder los límites de su cara.
            const rx = f.x - bounds.low0, ry = bounds.high1 - (f.y + f.h);
            const cid = `clip-${pl.id}`;
            return (
              <g key={pl.id}>
                <clipPath id={cid}><rect x={rx} y={ry} width={f.w} height={f.h} /></clipPath>
                <g clipPath={`url(#${cid})`}>
                  <g transform={`translate(${box.cx} ${box.cy}) rotate(${pl.rot})`}>
                    <image
                      x={-box.w / 2} y={-box.h / 2} width={box.w} height={box.h}
                      preserveAspectRatio={par} href={img.dataUrl}
                      style={{ cursor: "move", touchAction: "none" }}
                      onPointerDown={(e) => beginGesture(e, pl, "move")}
                    />
                  </g>
                </g>
                {isSel && (
                  <g transform={`translate(${box.cx} ${box.cy}) rotate(${pl.rot})`}>
                    <rect
                      x={-box.w / 2} y={-box.h / 2} width={box.w} height={box.h} fill="none"
                      stroke="#d59248" strokeWidth={SW} strokeDasharray={`${4 * SW} ${3 * SW}`}
                    />
                    <line x1={0} y1={-box.h / 2} x2={0} y2={-box.h / 2 - HR * 3} stroke="#d59248" strokeWidth={SW} />
                    <circle cx={0} cy={-box.h / 2 - HR * 3} r={HR} fill="#d59248"
                      style={{ cursor: "grab" }} onPointerDown={(e) => beginGesture(e, pl, "rotate")} />
                    <circle cx={box.w / 2} cy={box.h / 2} r={HR} fill="#fff" stroke="#d59248" strokeWidth={SW}
                      style={{ cursor: "nwse-resize" }} onPointerDown={(e) => beginGesture(e, pl, "scale")} />
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {images.length === 0 && (
          <div className="drop-hint">
            <div className="drop-ico">🖼️</div>
            Arrastrá una imagen acá o usá el botón para subirla
          </div>
        )}
      </div>

      <div className="design-panel">
        <label className={`upload compact${dragOver ? " over" : ""}`}>
          <input type="file" accept="image/*" multiple
            onChange={(e) => e.target.files && addImages(e.target.files)} />
          <span>+ Subir imagen  ·  o arrastrala al lienzo</span>
        </label>

        {images.map((img) => {
          const pls = placements.filter((pl) => pl.imageId === img.id);
          return (
            <div key={img.id} className="img-row">
              <img src={img.dataUrl} alt={img.name} />
              <span className="img-name" title={img.name}>{img.name}</span>
              <select
                className="face-sel"
                value={pls[0]?.faceId ?? ""}
                onChange={(e) => {
                  const faceId = e.target.value;
                  if (pls[0]) { updatePlacement(pls[0].id, { faceId }); setSelected(pls[0].id); }
                  else { const pl = defaultPlacement(img.id, faceId); onPlacements([...placements, pl]); setSelected(pl.id); }
                }}
              >
                <option value="" disabled>Elegí cara…</option>
                {faces.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <button className="axis" onClick={() => removeImage(img.id)} title="Quitar">✕</button>
            </div>
          );
        })}

        {selected && (() => {
          const pl = placements.find((x) => x.id === selected);
          if (!pl) return null;
          return (
            <div className="place-row">
              <div className="place-head">
                <span className="img-name">{imgMap[pl.imageId]?.name} · {facesById.get(pl.faceId)?.label}</span>
                <button className="axis" onClick={() => removePlacement(pl.id)}>✕</button>
              </div>
              <div className="axes">
                <button className={pl.fit === "cover" ? "axis on" : "axis"} onClick={() => updatePlacement(pl.id, { fit: "cover" })}>Rellenar</button>
                <button className={pl.fit === "contain" ? "axis on" : "axis"} onClick={() => updatePlacement(pl.id, { fit: "contain" })}>Encajar</button>
                <button className="axis" onClick={() => updatePlacement(pl.id, { rot: pl.rot + 90 })}>⟳ 90°</button>
                <button className="axis" onClick={() => updatePlacement(pl.id, { scale: 1, offX: 0, offY: 0, rot: 0 })}>Reset</button>
              </div>
              <label className="field">
                <span>Tamaño: <b>{Math.round(pl.scale * 100)}%</b></span>
                <input type="range" min={0.1} max={6} step={0.05} value={pl.scale}
                  onChange={(e) => updatePlacement(pl.id, { scale: parseFloat(e.target.value) })} />
              </label>
              <label className="field">
                <span>Giro: <b>{Math.round(((pl.rot % 360) + 360) % 360)}°</b></span>
                <input type="range" min={0} max={360} step={1} value={((pl.rot % 360) + 360) % 360}
                  onChange={(e) => updatePlacement(pl.id, { rot: parseFloat(e.target.value) })} />
              </label>
              <div className="dims">
                <label className="field">
                  <span>Pos. X: <b>{Math.round(pl.offX)}</b></span>
                  <input type="range" min={-120} max={120} step={1} value={pl.offX}
                    onChange={(e) => updatePlacement(pl.id, { offX: parseFloat(e.target.value) })} />
                </label>
                <label className="field">
                  <span>Pos. Y: <b>{Math.round(pl.offY)}</b></span>
                  <input type="range" min={-120} max={120} step={1} value={pl.offY}
                    onChange={(e) => updatePlacement(pl.id, { offY: parseFloat(e.target.value) })} />
                </label>
              </div>
              <p className="meta">
                También podés arrastrar la imagen para moverla · esquina para escalar · manija de arriba para rotar · dos dedos para pellizcar.
              </p>
            </div>
          );
        })()}

        <button onClick={exportSVG} disabled={placements.length === 0} style={{ marginTop: 12 }}>
          ⬇ SVG para grabadora láser
        </button>
        <p className="meta">
          Rojo = corte, azul = pliegue, imágenes = grabado. Verificá el espejado en tu software láser si grabás del lado interior.
        </p>
      </div>
    </div>
  );
}
