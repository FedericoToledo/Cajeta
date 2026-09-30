// Empaquetado por filas (shelf packing) para acomodar varios productos o cajas sin
// superponerse. Prueba varios anchos objetivo y elige el más compacto/cuadrado (el
// que minimiza el lado mayor del bounding), para no generar cajas largas y angostas.
// Devuelve el CENTRO de cada rectángulo (esquina del bounding en el origen) y el tamaño.
export interface PackItem { w: number; h: number; }
export interface PackResult {
  pos: { x: number; y: number }[]; // centro de cada item (mismo orden que la entrada)
  W: number;
  H: number;
}

/** Empaqueta en filas con un ancho objetivo dado (ordenando por alto desc). */
function packRows(sizes: PackItem[], gap: number, target: number): PackResult {
  const order = sizes.map((s, i) => ({ i, w: s.w, h: s.h })).sort((a, b) => b.h - a.h);
  const pos: { x: number; y: number }[] = new Array(sizes.length);
  let x = 0, y = 0, rowH = 0, maxX = 0;
  for (const it of order) {
    if (x > 0 && x + it.w > target + 1e-6) { x = 0; y += rowH + gap; rowH = 0; } // nueva fila
    pos[it.i] = { x: x + it.w / 2, y: y + it.h / 2 };
    x += it.w + gap;
    rowH = Math.max(rowH, it.h);
    maxX = Math.max(maxX, x - gap);
  }
  return { pos, W: maxX, H: y + rowH };
}

export function pack(sizes: PackItem[], gap: number): PackResult {
  const n = sizes.length;
  if (n === 0) return { pos: [], W: 0, H: 0 };
  if (n === 1) return { pos: [{ x: sizes[0].w / 2, y: sizes[0].h / 2 }], W: sizes[0].w, H: sizes[0].h };

  const maxW = Math.max(...sizes.map((s) => s.w));
  const sumW = sizes.reduce((a, s) => a + s.w + gap, 0);

  // Barremos anchos objetivo desde el producto más ancho hasta la fila completa y
  // elegimos el resultado más "cuadrado" (menor lado mayor), desempatando por área.
  let best: PackResult | null = null;
  let bestScore = Infinity;
  const steps = 48;
  for (let k = 0; k <= steps; k++) {
    const target = maxW + ((sumW - maxW) * k) / steps;
    const res = packRows(sizes, gap, target);
    const score = Math.max(res.W, res.H) + res.W * res.H * 1e-6; // compacidad, luego área
    if (score < bestScore) { bestScore = score; best = res; }
  }
  return best!;
}
