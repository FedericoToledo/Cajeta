// Helpers sobre Maker.js para construir dielines con capas CUT / CREASE / MARK.
import makerjs from "makerjs";
import { LayerName } from "./types";

export type Point = [number, number];

/** Crea una línea con capa asignada. */
export function line(a: Point, b: Point, layer: LayerName): makerjs.IPathLine {
  const l: makerjs.IPathLine = new makerjs.paths.Line(a, b);
  l.layer = layer;
  return l;
}

/** Círculo (usado para puntos de pegado/broche). */
export function circle(center: Point, radius: number, layer: LayerName): makerjs.IPathCircle {
  const c: makerjs.IPathCircle = new makerjs.paths.Circle(center, radius);
  c.layer = layer;
  return c;
}

/** Modelo con puntos (dots) en una capa, a partir de una lista de centros. */
export function dots(points: Point[], radius: number, layer: LayerName): makerjs.IModel {
  const paths: Record<string, makerjs.IPath> = {};
  points.forEach((p, i) => (paths[`d${i}`] = circle(p, radius, layer)));
  return { paths };
}

/** Rectángulo como 4 líneas independientes en la capa indicada.
 *  (x, y) es la esquina inferior izquierda. */
export function rectLines(
  x: number,
  y: number,
  w: number,
  h: number,
  layer: LayerName
): makerjs.IModel {
  const paths: Record<string, makerjs.IPath> = {
    bottom: line([x, y], [x + w, y], layer),
    right: line([x + w, y], [x + w, y + h], layer),
    top: line([x + w, y + h], [x, y + h], layer),
    left: line([x, y + h], [x, y], layer),
  };
  return { paths };
}

/** Combina varios modelos en uno solo, con claves únicas. */
export function group(models: Record<string, makerjs.IModel>): makerjs.IModel {
  return { models };
}

/** Une modelos en una lista, autogenerando claves. */
export function combine(...parts: makerjs.IModel[]): makerjs.IModel {
  const models: Record<string, makerjs.IModel> = {};
  parts.forEach((p, i) => (models[`m${i}`] = p));
  return { models };
}

/** Desplaza un modelo. */
export function at(model: makerjs.IModel, dx: number, dy: number): makerjs.IModel {
  return makerjs.model.move(makerjs.cloneObject(model), [dx, dy]);
}

/** Bounding box (extents) de un modelo. */
export function extents(model: makerjs.IModel) {
  return makerjs.measure.modelExtents(model);
}
