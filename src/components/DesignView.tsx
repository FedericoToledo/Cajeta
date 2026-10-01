// Vista "Diseño": subir/arrastrar imágenes y colocarlas sobre las caras del
// dieline plano. Manipulación directa (mouse/dedos). La imagen se muestra como
// quedaría GRABADA A LÁSER: quema oscura sobre cartón marrón (o revela el fondo
// si el cartón tiene capa oscura), no la foto real. Exporta SVG para la grabadora.
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

function hexToRgb(hex: string) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 20, g: 15, b: 7 };
}

/** Materiales: color base del cartón + color del grabado (marca del láser). */
const MATERIALS = [
  { key: "marron", label: "Cartón marrón (graba negro)", card: "#7a4a25", burn: "#140d06" },
  { key: "negro", label: "Capa negra (revela marrón)", card: "#1b1711", burn: "#a06c3a" },
];

type Vec = { x: number; y: number };
type Gesture = {
  id: string;
  mode: "move" | "scale" | "rotate" | "pinch";
  pointers: Map<number, Vec>;
  startPtr: Vec;
  center: Vec;
  off: [number, number];
  scale: number;
  rot: number;
  startDist: number;
  startAngle: number;
  startCentroid: Vec;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function DesignView({ p, images, placements, onImages, onPlacements }: Props) {
  const faces: FaceRect[] = useMemo(() => faceRects(p), [p]);
  const model = useMemo(() => assembleBox(p), [p]);
  const bounds = useMemo(() => modelBounds(model), [model]);
  const imgMap = useMemo(() => Object.fromEntries(images.map((i) => [i.id, i])), [images]);
  const bg = useMemo(() => toSVG(model, { stroke: "2.2", responsive: true }), [model]);

  const [selected, setSelected] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [unitPx, setUnitPx] = useState(4);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  // Material / color del cartón.
  const [cardColor, setCardColor] = useState(MATERIALS[0].card);
  const [burnColor, setBurnColor] = useState(MATERIALS[0].burn);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);

  // El molde entra COMPLETO (contain) en el área disponible — sin scroll.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const aw = el.clientWidth, ah = el.clientHeight;
      if (aw > 0 && ah > 0 && bounds.w > 0 && bounds.h > 0) {
        const scale = Math.min(aw / bounds.w, ah / bounds.h);
        setCanvasSize({ w: bounds.w * scale, h: bounds.h * scale });
        setUnitPx(scale);
      }
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [bounds.w, bounds.h]);

  // Convierte cada imagen a GRABADO: color de quemado con alpha = oscuridad del píxel.
  const [engraveMap, setEngraveMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const rgb = hexToRgb(burnColor);
    Promise.all(images.map((di) => new Promise<[string, string] | null>((res) => {
      const im = new Image();
      im.onload = () => {
        try {
          const max = 500;
          const s = Math.min(1, max / Math.max(im.naturalWidth || 1, im.naturalHeight || 1));
          const w = Math.max(1, Math.round((im.naturalWidth || 1) * s));
          const h = Math.max(1, Math.round((im.naturalHeight || 1) * s));
          const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          const ctx = cv.getContext("2d")!;
          ctx.drawImage(im, 0, 0, w, h);
          const d = ctx.getImageData(0, 0, w, h); const px = d.data;
          for (let i = 0; i < px.length; i += 4) {
            const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
            const a0 = px[i + 3] / 255;
            px[i] = rgb.r; px[i + 1] = rgb.g; px[i + 2] = rgb.b;
            px[i + 3] = Math.round((255 - lum) * a0); // oscuro -> marca; claro -> cartón
          }
          ctx.putImageData(d, 0, 0);
          res([di.id, cv.toDataURL("image/png")]);
        } catch { res(null); }
      };
      im.onerror = () => res(null);
      im.src = di.dataUrl;
    }))).then((pairs) => {
      if (!alive) return;
      const m: Record<string, string> = {};
      for (const pr of pairs) if (pr) m[pr[0]] = pr[1];
      setEngraveMap(m);
    });
    return () => { alive = false; };
  }, [images, burnColor]);

  const engraveImages = useMemo(
    () => Object.fromEntries(images.map((i) => [i.id, { ...i, dataUrl: engraveMap[i.id] ?? i.dataUrl }])) as Record<string, DesignImage>,
    [images, engraveMap]
  );

  const facesById = useMemo(() => new Map(faces.map((f) => [f.id, f])), [faces]);

  const addImages = async (files: FileList | File[]) => {
    // Sólo imágenes raster (no SVG) por seguridad y porque el grabado es raster.
    const arr = Array.from(files).filter((f) => /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(f.type));
    if (!arr.length) return;
    const added: DesignImage[] = [];
    for (const file of arr) {
      const dataUrl = await readAsDataURL(file);
      added.push({ id: `img-${Math.random().toString(36).slice(2, 8)}`, name: file.name, dataUrl });
    }
    onImages([...images, ...added]);
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
    const svg = designToSVG(p, placements, engraveImages, model, { responsive: false });
    download("vexionbox_diseno_laser.svg", svg, "image/svg+xml");
  };

  // --- Manipulación directa (pointer events) ---
  const toSvg = (e: React.PointerEvent): Vec => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM();
    const q = m ? pt.matrixTransform(m.inverse()) : pt;
    return { x: q.x, y: q.y };
  };
  const boxOf = (pl: Placement) => placementSVGBox(pl, facesById.get(pl.faceId)!, bounds);

  const beginGesture = (e: React.PointerEvent, pl: Placement, mode: Gesture["mode"]) => {
    e.stopPropagation();
    setSelected(pl.id);
    const pos = toSvg(e);
    const box = boxOf(pl);
    const center = { x: box.cx, y: box.cy };
    if (!gesture.current || gesture.current.id !== pl.id) {
      gesture.current = {
        id: pl.id, mode, pointers: new Map(), startPtr: pos, center,
        off: [pl.offX, pl.offY], scale: pl.scale, rot: pl.rot,
        startDist: 0, startAngle: Math.atan2(pos.y - center.y, pos.x - center.x), startCentroid: pos,
      };
    }
    gesture.current.pointers.set(e.pointerId, pos);
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
      updatePlacement(g.id, { offX: g.off[0] + (pos.x - g.startPtr.x), offY: g.off[1] - (pos.y - g.startPtr.y) });
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
      const [only] = [...g.pointers.entries()];
      const pl = placements.find((x) => x.id === g.id);
      if (pl) { g.mode = "move"; g.startPtr = only[1]; g.off = [pl.offX, pl.offY]; }
    }
  };

  const HR = 9 / unitPx;
  const SW = 1.6 / unitPx;

  return (
    <div className="design">
      <div className="design-stage" ref={stageRef}>
        <div
          className={`design-canvas${dragOver ? " over" : ""}`}
          style={{ width: canvasSize.w || undefined, height: canvasSize.h || undefined, background: cardColor }}
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
            {/* Nombre de cada cara (guía; no se exporta). Fuente acotada para que no tape. */}
            <g style={{ pointerEvents: "none" }}>
              {faces.map((f) => {
                const cx = f.x - bounds.low0 + f.w / 2;
                const cy = bounds.high1 - (f.y + f.h / 2);
                const fs = Math.min(f.h * 0.28, (f.w * 1.6) / Math.max(6, f.label.length), bounds.w * 0.035);
                return (
                  <text key={f.id} x={cx} y={cy} fontSize={fs} fill="#ffffff" opacity={0.18}
                    textAnchor="middle" dominantBaseline="middle" fontWeight={700}>
                    {f.label}
                  </text>
                );
              })}
            </g>

            {placements.map((pl) => {
              const f = facesById.get(pl.faceId);
              if (!f) return null;
              const href = engraveMap[pl.imageId] ?? imgMap[pl.imageId]?.dataUrl;
              if (!href) return null;
              const box = placementSVGBox(pl, f, bounds);
              const isSel = selected === pl.id;
              const par = pl.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
              const rx = f.x - bounds.low0, ry = bounds.high1 - (f.y + f.h);
              const cid = `clip-${pl.id}`;
              return (
                <g key={pl.id}>
                  <clipPath id={cid}><rect x={rx} y={ry} width={f.w} height={f.h} /></clipPath>
                  <g clipPath={`url(#${cid})`}>
                    <g transform={`translate(${box.cx} ${box.cy}) rotate(${pl.rot})`}>
                      <image
                        x={-box.w / 2} y={-box.h / 2} width={box.w} height={box.h}
                        preserveAspectRatio={par} href={href}
                        style={{ cursor: "move", touchAction: "none" }}
                        onPointerDown={(e) => beginGesture(e, pl, "move")}
                      />
                    </g>
                  </g>
                  {isSel && (
                    <g transform={`translate(${box.cx} ${box.cy}) rotate(${pl.rot})`}>
                      <rect x={-box.w / 2} y={-box.h / 2} width={box.w} height={box.h} fill="none"
                        stroke="#d59248" strokeWidth={SW} strokeDasharray={`${4 * SW} ${3 * SW}`} />
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
      </div>

      <div className="design-panel">
        <label className={`upload compact${dragOver ? " over" : ""}`}>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" multiple
            onChange={(e) => e.target.files && addImages(e.target.files)} />
          <span>+ Subir imagen · o arrastrala al lienzo</span>
        </label>

        <h3>Material del cartón</h3>
        <div className="axes">
          {MATERIALS.map((mtl) => (
            <button key={mtl.key}
              className={cardColor === mtl.card ? "axis on" : "axis"}
              onClick={() => { setCardColor(mtl.card); setBurnColor(mtl.burn); }}>
              {mtl.key === "marron" ? "Marrón" : "Capa negra"}
            </button>
          ))}
        </div>
        <div className="color-row">
          <label><span>Cartón</span><input type="color" value={cardColor} onChange={(e) => setCardColor(e.target.value)} /></label>
          <label><span>Grabado</span><input type="color" value={burnColor} onChange={(e) => setBurnColor(e.target.value)} /></label>
        </div>

        <h3>Vista del grabado</h3>
        {images.length === 0 ? (
          <p className="meta">Subí una imagen para ver cómo queda grabada.</p>
        ) : (
          <div className="engrave-previews">
            {images.map((img) => (
              <img key={img.id} className="engrave-img" style={{ background: cardColor }}
                src={engraveMap[img.id] ?? img.dataUrl} alt={img.name} />
            ))}
          </div>
        )}
        <p className="meta">La imagen ya grabada (sin el molde): oscuro = marca, claro = cartón.</p>

        {images.length > 0 && <h3>Imágenes</h3>}
        {images.map((img) => {
          const pls = placements.filter((pl) => pl.imageId === img.id);
          return (
            <div key={img.id} className="img-row">
              <img src={engraveMap[img.id] ?? img.dataUrl} alt={img.name} style={{ background: cardColor }} />
              <span className="img-name" title={img.name}>{img.name}</span>
              <select className="face-sel" value={pls[0]?.faceId ?? ""}
                onChange={(e) => {
                  const faceId = e.target.value;
                  if (pls[0]) { updatePlacement(pls[0].id, { faceId }); setSelected(pls[0].id); }
                  else { const pl = defaultPlacement(img.id, faceId); onPlacements([...placements, pl]); setSelected(pl.id); }
                }}>
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
              <p className="meta">Arrastrá para mover · esquina para escalar · manija de arriba para rotar · dos dedos para pellizcar.</p>
            </div>
          );
        })()}

        <button onClick={exportSVG} disabled={placements.length === 0} style={{ marginTop: 12 }}>
          ⬇ SVG para grabadora láser
        </button>
        <p className="meta">Rojo = corte, azul = pliegue, grabado = imágenes. Verificá el espejado en tu software láser si grabás del lado interior.</p>
      </div>
    </div>
  );
}
