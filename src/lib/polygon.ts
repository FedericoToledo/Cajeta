// Utilidades de polígonos 2D: convex hull (Andrew monotone chain),
// offset hacia adentro/afuera para polígonos convexos, y helpers de bbox/centro.
export type Pt = [number, number];

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Convex hull en orden CCW. Devuelve [] si hay menos de 3 puntos únicos. */
export function convexHull(points: Pt[]): Pt[] {
  const pts = points
    .slice()
    .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (pts.length < 3) return [];

  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper); // CCW
  return hull.length >= 3 ? hull : [];
}

/** Intersección de dos rectas dadas por punto + dirección. null si son paralelas. */
function intersect(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / denom;
  return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}

/**
 * Offset de un polígono convexo (CCW) por distancia d.
 * d > 0 = hacia adentro (encoge), d < 0 = hacia afuera (agranda).
 * Devuelve el polígono original si el offset lo colapsa o falla.
 */
export function offsetConvex(poly: Pt[], d: number): Pt[] {
  const n = poly.length;
  if (n < 3 || d === 0) return poly;

  // Para cada arista i (poly[i] -> poly[i+1]) calculamos su recta desplazada.
  const lines: { p: Pt; dir: Pt }[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const dx = ex / len;
    const dy = ey / len;
    // En CCW el interior queda a la izquierda: normal interior = (-dy, dx).
    const nx = -dy;
    const ny = dx;
    lines.push({ p: [a[0] + nx * d, a[1] + ny * d], dir: [dx, dy] });
  }

  // Nuevo vértice i = intersección de la recta (i-1) con la recta (i).
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    const x = intersect(prev.p, prev.dir, cur.p, cur.dir);
    if (!x) return poly; // aristas paralelas: abortamos el offset
    out.push(x);
  }

  // Chequeo anti-colapso: el área debe seguir siendo positiva y razonable.
  if (Math.abs(area(out)) < 1) return poly;
  return out;
}

/** Área con signo (positiva si CCW). */
export function area(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Centro del bounding box del polígono. */
export function bboxCenter(poly: Pt[]): Pt {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** Traslada un polígono para que su centro de bbox quede en (cx, cy). */
export function centerAt(poly: Pt[], cx: number, cy: number): Pt[] {
  const [bx, by] = bboxCenter(poly);
  return poly.map(([x, y]) => [x - bx + cx, y - by + cy] as Pt);
}

/** Traslada un polígono por (dx, dy). */
export function translate(poly: Pt[], dx: number, dy: number): Pt[] {
  return poly.map(([x, y]) => [x + dx, y + dy] as Pt);
}
