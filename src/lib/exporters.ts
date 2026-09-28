// Exportadores: DXF (por capas) para el router CNC y SVG para previsualización.
import makerjs from "makerjs";
import { LAYER } from "./types";

// Colores por capa. aci = AutoCAD Color Index (DXF); svg = color de trazo.
// 1=rojo, 3=verde, 5=azul en ACI.
const LAYER_COLOR: Record<string, { aci: number; svg: string; fill?: string }> = {
  [LAYER.CUT]: { aci: 1, svg: "#e11d48" }, // corte  -> rojo
  [LAYER.CREASE]: { aci: 5, svg: "#2563eb" }, // pliegue -> azul
  [LAYER.MARK]: { aci: 3, svg: "#16a34a" }, // marca  -> verde
  [LAYER.GLUE]: { aci: 1, svg: "#ff0000", fill: "#ff0000" }, // pegado/broche -> punto rojo
};

/** Exporta a DXF con una capa (layer) por tipo de línea y color ACI. */
export function toDXF(model: makerjs.IModel): string {
  const layerOptions: { [layer: string]: { color: number } } = {};
  for (const [name, c] of Object.entries(LAYER_COLOR)) {
    layerOptions[name] = { color: c.aci };
  }
  return makerjs.exporter.toDXF(model, {
    units: makerjs.unitType.Millimeter,
    usePOLYLINE: true,
    layerOptions: layerOptions as unknown as makerjs.exporter.IDXFRenderOptions["layerOptions"],
  });
}

/**
 * Exporta a SVG coloreando por capa.
 *  - stroke: grosor de trazo (mm). Sólo afecta la visualización, no el DXF.
 *  - responsive: quita width/height fijos (mm) para que escale al contenedor (zoom out).
 */
export function toSVG(
  model: makerjs.IModel,
  opts: { stroke?: string; responsive?: boolean } = {}
): string {
  const stroke = opts.stroke ?? "0.3";
  const layerOptions: {
    [layer: string]: { stroke: string; strokeWidth: string; fill?: string };
  } = {};
  for (const [name, c] of Object.entries(LAYER_COLOR)) {
    layerOptions[name] = { stroke: c.svg, strokeWidth: stroke, fill: c.fill };
  }
  let svg = makerjs.exporter.toSVG(model, {
    units: makerjs.unitType.Millimeter,
    strokeWidth: stroke,
    layerOptions: layerOptions as unknown as makerjs.exporter.ISVGRenderOptions["layerOptions"],
  });
  if (opts.responsive) {
    // Mantiene el viewBox pero deja que escale al ancho del contenedor.
    svg = svg.replace(
      /<svg width="[^"]*" height="[^"]*"/,
      '<svg style="width:100%;height:auto;display:block" preserveAspectRatio="xMidYMid meet"'
    );
  }
  return svg;
}

/** Página HTML A4 imprimible (para "guardar como PDF") con el dieline a escala. */
export function printableHTML(model: makerjs.IModel, title: string): string {
  const e = makerjs.measure.modelExtents(model);
  const w = e ? e.high[0] - e.low[0] : 100;
  const h = e ? e.high[1] - e.low[1] : 100;
  const margin = 10; // mm
  const availW = 210 - 2 * margin;
  const availH = 297 - 2 * margin;
  const scale = Math.min(availW / w, availH / h, 1); // no agrandar
  const svg = toSVG(model, { stroke: "0.3" }).replace(
    /<svg width="[^"]*" height="[^"]*"/,
    `<svg width="${(w * scale).toFixed(1)}mm" height="${(h * scale).toFixed(1)}mm"`
  );
  const label = scale < 1 ? `Escala 1:${(1 / scale).toFixed(2)}` : "Escala 1:1";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>@page{size:A4;margin:${margin}mm} body{margin:0;font-family:system-ui,sans-serif}
.lbl{font-size:11px;margin:0 0 6px} @media print{.hint{display:none}}</style></head>
<body><div class="lbl"><b>${title}</b> — ${label} (real ${w.toFixed(0)}×${h.toFixed(0)} mm)</div>
<div class="hint" style="font-size:11px;color:#666;margin-bottom:8px">Imprimí como PDF en A4 al 100% (sin "ajustar a página").</div>
${svg}</body></html>`;
}

/** Dispara la descarga de un archivo de texto en el navegador. */
export function download(filename: string, content: string, mime = "application/dxf") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
