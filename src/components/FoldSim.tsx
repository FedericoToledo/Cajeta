// Simulador de plegado 3D. Dos reproductores independientes: CAJA e INSERT.
// Todo pliega DESDE PLANO: a t=0 el cartón está desplegado sobre el piso (igual
// que el dieline) y a t=1 queda armado. Se usa una jerarquía de paneles con
// bisagra (cada panel se pliega respecto de su padre), así las caras coinciden
// con el dieline y arrancan en el piso.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Orientation, ProductModel } from "../lib/product";
import { Params, BoxMode, innerDims } from "../lib/types";
import { offsetConvex, Pt } from "../lib/polygon";
import { DesignImage, Placement, PieceKey, FaceKey } from "../lib/design";

export interface FoldItem { id: string; buffer: ArrayBuffer; orientation?: Orientation; }

interface Props {
  params: Params;             // caja combinada (A) o contenedora (B): product = sintético
  mode: BoxMode;
  items: FoldItem[];
  products: ProductModel[];   // productos reales (para ventanas del insert y suspensión)
  positions: { x: number; y: number; z?: number }[]; // centros (plano) + z vertical, centrados en origen
  nestedVolumes?: { parent: number; w: number; h: number; z: number; relX: number; relY: number }[];
  outerIdx?: number; // índice del producto grande (caja externa) en Modo B
  placements?: Placement[];
  images?: DesignImage[];
}

/** Contexto de decoración para pintar imágenes sobre las caras de la caja. */
interface Decor {
  placements: Placement[];
  loaded: Record<string, HTMLImageElement>; // imageId -> <img> ya cargada
}
/** Panel decorable pendiente de textura (se resuelve tras armar la jerarquía). */
interface DecoItem { mesh: THREE.Mesh; piece: PieceKey; face: FaceKey; }
const CARTON_HEX = "#b0a08a";

const CARTON_COLOR = 0xb0a08a;
function mat(opacity = 0.8, color = CARTON_COLOR) {
  return new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity });
}
/** Matriz que replica EXACTAMENTE analyze (flip → eje vertical → giro) y lleva Z↑ a Y↑ del visor. */
function orientationMatrix(o: Orientation): THREE.Matrix4 {
  const flip = new THREE.Matrix4();
  if (o.flip) o.up === "x" ? flip.makeRotationY(Math.PI) : flip.makeRotationX(Math.PI);
  const orient = new THREE.Matrix4();
  if (o.up === "y") orient.makeRotationX(Math.PI / 2);
  else if (o.up === "x") orient.makeRotationY(-Math.PI / 2);
  const planar = new THREE.Matrix4().makeRotationZ((o.rotateDeg * Math.PI) / 180);
  const zy = new THREE.Matrix4().makeRotationX(-Math.PI / 2); // Z↑ (analyze) → Y↑ (visor)
  return zy.multiply(planar).multiply(orient).multiply(flip);
}
function orientGeometry(geo: THREE.BufferGeometry, o?: Orientation) {
  if (o) geo.applyMatrix4(orientationMatrix(o));
}

type FoldFn = (t: number) => void;

/** Panel plano que se extiende +Z desde su bisagra (eje X local en el origen). */
function panelMesh(width: number, depth: number, material: THREE.Material): THREE.Mesh {
  const g = new THREE.PlaneGeometry(width, depth);
  g.translate(0, depth / 2, 0); // borde de bisagra en el origen
  g.rotateX(Math.PI / 2); // +Y -> +Z: queda horizontal extendiéndose +Z
  return new THREE.Mesh(g, material);
}

/** Crea un nodo con bisagra: colocación fija (posición + yaw) + pliegue animado. */
function hinge(
  folds: FoldFn[], parent: THREE.Object3D,
  pos: [number, number, number], yaw: number, target: number
): THREE.Group {
  const placement = new THREE.Group();
  placement.position.set(pos[0], pos[1], pos[2]);
  placement.rotation.y = yaw;
  parent.add(placement);
  const fold = new THREE.Group();
  placement.add(fold);
  folds.push((t) => (fold.rotation.x = target * t));
  return fold;
}

interface Built { root: THREE.Group; setFold: FoldFn; }

/** Solapa de esquina en el borde vertical de una pared; pliega SIEMPRE hacia adentro.
 *  El interior de la caja está en +Y local de la pared, por eso dirSign = extendSign. */
function addCornerTab(
  folds: FoldFn[], wall: THREE.Group, edgeX: number, extendSign: number,
  cornerTab: number, H: number
) {
  const g = new THREE.Group();
  g.position.set(edgeX, 0, 0);
  wall.add(g);
  const geo = new THREE.PlaneGeometry(cornerTab, H);
  geo.translate((extendSign * cornerTab) / 2, H / 2, 0); // se extiende más allá del borde
  geo.rotateX(Math.PI / 2); // altura -> +Z, en el plano de la pared
  g.add(new THREE.Mesh(geo, mat(0.7)));
  folds.push((t) => (g.rotation.z = extendSign * (Math.PI / 2) * t)); // hacia adentro (+Y)
}

/** Fondo (plataforma) centrado en el origen, opcionalmente con VENTANA recortada. */
function floorMesh(L: number, W: number, window: Pt[] | null): THREE.Mesh {
  if (window && window.length >= 3) {
    const shape = new THREE.Shape();
    shape.moveTo(-L / 2, -W / 2); shape.lineTo(L / 2, -W / 2);
    shape.lineTo(L / 2, W / 2); shape.lineTo(-L / 2, W / 2); shape.closePath();
    const hole = new THREE.Path();
    window.forEach((p, i) => (i === 0 ? hole.moveTo(p[0], p[1]) : hole.lineTo(p[0], p[1])));
    hole.closePath();
    shape.holes.push(hole);
    const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
    return new THREE.Mesh(geo, mat(0.85));
  }
  const bg = new THREE.PlaneGeometry(L, W); bg.rotateX(-Math.PI / 2);
  return new THREE.Mesh(bg, mat(0.85));
}

/** Dibuja `img` sobre un canvas de la cara, con ajuste/giro/escala/desplazamiento. */
function drawFitted(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  cw: number, ch: number, pl: Placement, spanX: number, spanZ: number
) {
  ctx.save();
  const ox = (pl.offX / spanX) * cw;
  const oy = -(pl.offY / spanZ) * ch; // offY "arriba" -> menor v (canvas hacia arriba)
  ctx.translate(cw / 2 + ox, ch / 2 + oy);
  ctx.rotate((pl.rot * Math.PI) / 180);
  ctx.scale(pl.scale, pl.scale);
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const f = pl.fit === "cover" ? Math.max(cw / iw, ch / ih) : Math.min(cw / iw, ch / ih);
  ctx.drawImage(img, (-iw * f) / 2, (-ih * f) / 2, iw * f, ih * f);
  ctx.restore();
}

/**
 * Pinta una imagen sobre una cara (panel plano). Usa las coordenadas del MUNDO a
 * t=0 (cartón desplegado = dieline), de modo que la textura coincide con la cara
 * y su orientación por construcción, sin importar cómo se pliegue después.
 */
function applyFaceTexture(mesh: THREE.Mesh, img: HTMLImageElement, pl: Placement) {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const pts: THREE.Vector3[] = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    pts.push(v);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
  }
  const spanX = Math.max(1e-6, maxX - minX), spanZ = Math.max(1e-6, maxZ - minZ);
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pts[i].x - minX) / spanX, (pts[i].z - minZ) / spanZ);
  }
  uv.needsUpdate = true;

  const LONG = 512;
  const cw = spanX >= spanZ ? LONG : Math.max(16, Math.round((LONG * spanX) / spanZ));
  const ch = spanX >= spanZ ? Math.max(16, Math.round((LONG * spanZ) / spanX)) : LONG;
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = CARTON_HEX; ctx.fillRect(0, 0, cw, ch);
  drawFitted(ctx, img, cw, ch, pl, spanX, spanZ);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false; // UV v=0 -> fila 0 del canvas
  tex.needsUpdate = true;
  mesh.material = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide });
}

/** Agrega una bandeja (fondo/plataforma + 4 paredes + solapas de esquina + doble solapa). */
function addTray(
  root: THREE.Object3D, folds: FoldFn[],
  L: number, W: number, H: number,
  o: {
    topFlaps?: boolean; flapWalls?: "both" | "front"; thickness: number; cornerTab: number;
    platformWindow?: Pt[] | null; decorPiece?: PieceKey; decoList?: DecoItem[];
  }
) {
  const tag = (mesh: THREE.Mesh, face: FaceKey) => {
    if (o.decorPiece && o.decoList) o.decoList.push({ mesh, piece: o.decorPiece, face });
  };

  const floor = floorMesh(L, W, o.platformWindow ?? null);
  root.add(floor);
  tag(floor, "top"); // bandeja:top no tiene placement (se ignora); tapa:top sí.

  const up = -Math.PI / 2;
  const front = hinge(folds, root, [0, 0, W / 2], 0, up);
  const back = hinge(folds, root, [0, 0, -W / 2], Math.PI, up);
  const left = hinge(folds, root, [-L / 2, 0, 0], -Math.PI / 2, up);
  const right = hinge(folds, root, [L / 2, 0, 0], Math.PI / 2, up);
  const frontP = panelMesh(L, H, mat()); front.add(frontP); tag(frontP, "front");
  const backP = panelMesh(L, H, mat()); back.add(backP); tag(backP, "back");
  const leftP = panelMesh(W, H, mat()); left.add(leftP); tag(leftP, "left");
  const rightP = panelMesh(W, H, mat()); right.add(rightP); tag(rightP, "right");

  // Solapas de esquina en izquierda/derecha (ambos extremos), siempre hacia adentro.
  const ct = o.cornerTab;
  addCornerTab(folds, left, W / 2, +1, ct, H);
  addCornerTab(folds, left, -W / 2, -1, ct, H);
  addCornerTab(folds, right, W / 2, +1, ct, H);
  addCornerTab(folds, right, -W / 2, -1, ct, H);

  if (o.topFlaps) {
    const t = o.thickness;
    const depth = Math.max(10, H * 0.6);
    const addFlap = (wall: THREE.Group, len: number) => {
      const f1 = hinge(folds, wall, [0, 0, H], 0, -Math.PI / 2); // pliega hacia adentro
      f1.add(panelMesh(len, t, mat(0.6)));
      const f2 = hinge(folds, f1, [0, 0, t], 0, -Math.PI / 2); // doble pared
      f2.add(panelMesh(len, depth, mat(0.6)));
    };
    addFlap(front, L);
    if (o.flapWalls !== "front") addFlap(back, L);
  }
  return { front, back, left, right };
}

/** Malla del STL orientada y centrada, con material de producto. */
function productMesh(item: FoldItem, opacity = 1): THREE.Mesh {
  const geo = new STLLoader().parse(item.buffer);
  orientGeometry(geo, item.orientation);
  geo.center();
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.1, roughness: 0.6, transparent: opacity < 1, opacity })
  );
}

/**
 * CAJA combinada (Modo A) o CONTENEDORA (Modo B): reutiliza addTray/buildChest con
 * el producto sintético de `params`. En Modo A cuelga cada producto en su posición;
 * en Modo B dibuja cada caja individual como un volumen simple translúcido.
 */
function buildBox(
  params: Params, mode: BoxMode, items: FoldItem[], products: ProductModel[],
  positions: { x: number; y: number; z?: number }[], decor?: Decor
): Built {
  const root = new THREE.Group();
  const folds: FoldFn[] = [];
  const { L, W, H } = innerDims(params);
  const isChest = params.boxType === "chest";
  const decoList: DecoItem[] = [];

  const tray = addTray(root, folds, L, W, H, {
    topFlaps: params.topFlaps,
    flapWalls: isChest ? "front" : "both",
    thickness: params.thickness,
    cornerTab: params.cornerTab,
    decorPiece: "bandeja",
    decoList,
  });

  if (isChest) {
    const lip = Math.max(10, params.lidHeight * 0.6);
    const long = Math.max(L, W);
    const host = L >= W ? tray.back : tray.right; // cara más larga
    const depth = (L >= W ? W : L) + params.thickness;
    const lid = hinge(folds, host, [0, 0, H], 0, -Math.PI / 2); // pliega sobre el tope
    const lidPanel = panelMesh(long, depth, mat(0.55)); lid.add(lidPanel);
    decoList.push({ mesh: lidPanel, piece: "tapa", face: "top" }); // cubierta
    const lipFold = hinge(folds, lid, [0, 0, depth], 0, -Math.PI / 2);
    const lipPanel = panelMesh(long, lip, mat(0.55)); lipFold.add(lipPanel);
    decoList.push({ mesh: lipPanel, piece: "tapa", face: "front" }); // labio
  } else {
    // Tapa (vista explotada): DERECHA y separada ARRIBA de la bandeja, con su cara
    // superior mirando hacia arriba (así la decoración se ve al derecho, sin espejar).
    // Sus paredes se pliegan con el slider.
    const grow = 2 * (params.thickness + params.lidClearance);
    const lidParent = new THREE.Group();
    lidParent.position.set(0, H + 40, 0); // arriba de la bandeja, separada
    root.add(lidParent);
    addTray(lidParent, folds, L + grow, W + grow, params.lidHeight, {
      topFlaps: params.topFlaps, thickness: params.thickness, cornerTab: params.cornerTab,
      decorPiece: "tapa", decoList,
    });
  }

  if (mode === "individual-boxes") {
    // Cada caja individual como volumen simple translúcido, en su posición.
    const m = params.clearance + params.thickness;
    items.forEach((it, i) => {
      const pr = products[i]; const pos = positions[i] ?? { x: 0, y: 0 };
      if (!pr) return;
      const g = new THREE.BoxGeometry(pr.x + 2 * m, params.trayWallHeight, pr.y + 2 * m);
      const box = new THREE.Mesh(g, mat(0.28, 0x38bdf8));
      const yb = params.trayWallHeight / 2 + (pos.z ?? 0);
      box.position.set(pos.x, yb, pos.y);
      root.add(box);
      const pm = productMesh(it, 0.9); pm.position.set(pos.x, yb, pos.y); root.add(pm);
    });
  } else {
    // Modo A: cada producto suspendido en su posición dentro de la caja combinada.
    items.forEach((it, i) => {
      const pos = positions[i] ?? { x: 0, y: 0 };
      const pm = productMesh(it);
      pm.position.set(pos.x, Math.max((products[i]?.z ?? 0) / 2, H / 2) + (pos.z ?? 0), pos.y);
      root.add(pm);
    });
  }

  // Decoración: con la jerarquía armada y fold=0 (cartón desplegado), cada panel
  // está en su posición de dieline; pintamos la imagen de cada cara usando sus
  // coordenadas del mundo, garantizando coincidencia de cara y orientación.
  if (decor && decoList.length) {
    root.updateMatrixWorld(true);
    for (const d of decoList) {
      const pl = decor.placements.find((p) => p.faceId === `${d.piece}:${d.face}`);
      if (!pl) continue;
      const img = decor.loaded[pl.imageId];
      if (img) applyFaceTexture(d.mesh, img, pl);
    }
  }

  return { root, setFold: (t) => folds.forEach((f) => f(t)) };
}

/** Contorno de ventana de agarre para una sección de un producto (o rect. fallback). */
function winForSec(params: Params, pr: ProductModel, sec: Pt[] | undefined, inset: number): Pt[] {
  if (params.useContour && sec && sec.length >= 3) return offsetConvex(sec, inset);
  const wx = Math.max(3, pr.x - 2 * inset), wy = Math.max(3, pr.y - 2 * inset);
  return [[-wx / 2, -wy / 2], [wx / 2, -wy / 2], [wx / 2, wy / 2], [-wx / 2, wy / 2]];
}

/** Repisa (panel +Z desde su bisagra) con huecos ya calculados en coords de la repisa. */
function shelfPanelMulti(width: number, depth: number, holes: Pt[][]): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0); shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, depth); shape.lineTo(-width / 2, depth); shape.closePath();
  for (const poly of holes) {
    if (poly.length < 3) continue;
    if (poly.some(([x, y]) => Math.abs(x) > width / 2 || y < 0 || y > depth)) continue; // fuera de la repisa
    const hole = new THREE.Path();
    poly.forEach(([x, y], i) => (i === 0 ? hole.moveTo(x, y) : hole.lineTo(x, y)));
    hole.closePath();
    shape.holes.push(hole);
  }
  const geo = new THREE.ShapeGeometry(shape); geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(geo, mat(0.6, 0xf59e0b));
}

/**
 * INSERT (uno o varios productos): bandeja de altura completa (fondo abierto) + un
 * ACORDEÓN de repisas (cantidad = sliceCount) que cuelga del borde del fondo. En cada
 * repisa va UNA ventana por producto, con el contorno de su sección a esa altura y en
 * su posición del empaquetado, de modo que todos quedan suspendidos siguiendo su forma.
 */
function buildInsertMulti(
  params: Params, items: FoldItem[], products: ProductModel[], positions: { x: number; y: number; z?: number }[]
): Built {
  const root = new THREE.Group();
  const folds: FoldFn[] = [];
  const { L, W, H } = innerDims(params);
  const N = Math.max(1, Math.floor(params.sliceCount));
  const spacing = N > 1 ? Math.max(4, params.product.z / N) : 0;
  const depthY = W;
  const inset = params.gripMargin + params.kerf / 2;

  const fr = Math.min(20, L * 0.15, W * 0.15);
  const opening: Pt[] = [
    [-(L - 2 * fr) / 2, -(W - 2 * fr) / 2], [(L - 2 * fr) / 2, -(W - 2 * fr) / 2],
    [(L - 2 * fr) / 2, (W - 2 * fr) / 2], [-(L - 2 * fr) / 2, (W - 2 * fr) / 2],
  ];
  const tray = addTray(root, folds, L, W, H, {
    thickness: params.thickness, cornerTab: params.cornerTab, platformWindow: opening,
  });

  // Plegado en ACORDEÓN (zig-zag que DESCIENDE escalonado sobre la caja), no en rulo.
  // El signo de cada bisagra alterna para compensar la rotación acumulada; patrón
  // sgn(j) (j = índice de bisagra en la cadena) validado para que las repisas queden
  // horizontales, sobre la caja y a alturas descendentes: -, (-,-), (+,+), (-,-), …
  const sgn = (j: number) => (j === 0 ? -1 : Math.floor((j - 1) / 2) % 2 === 0 ? -1 : 1);
  let j = 0;
  let parent = tray.back;
  for (let k = 0; k < N; k++) {
    const shelfFold = hinge(folds, parent, [0, 0, k === 0 ? H : spacing], 0, sgn(j++) * (Math.PI / 2));
    // La repisa mapea coords (a,b) -> mundo (X=-a, Z = par? b-depth/2 : depth/2-b). Para que
    // cada ventana caiga EXACTO sobre su producto en (px,py) del mundo, invertimos según eso.
    const even = k % 2 === 0;
    const holes = products.map((pr, i) => {
      const pos = positions[i] ?? { x: 0, y: 0 };
      const sec = pr.slices[Math.min(pr.slices.length - 1, N - 1 - k)] ?? pr.footprint;
      const win = winForSec(params, pr, sec, inset); // contorno centrado (fx,fy)
      return win.map(([fx, fy]) =>
        [-pos.x - fx, (even ? pos.y - fy : -pos.y + fy) + depthY / 2] as Pt);
    });
    shelfFold.add(shelfPanelMulti(L, depthY, holes));
    if (k < N - 1 && spacing > 0) {
      const riser = hinge(folds, shelfFold, [0, 0, depthY], 0, sgn(j++) * (Math.PI / 2));
      riser.add(panelMesh(L, spacing, mat(0.6, 0xfbbf24)));
      parent = riser;
    }
  }

  // Productos suspendidos (colgados de las repisas) en su posición.
  items.forEach((it, i) => {
    const pos = positions[i] ?? { x: 0, y: 0 };
    const pr = products[i];
    const pm = productMesh(it, 0.8);
    pm.position.set(pos.x, H - (pr?.z ?? 0) / 2 + (pos.z ?? 0), pos.y);
    root.add(pm);
  });

  return { root, setFold: (t) => folds.forEach((f) => f(t)) };
}

/** Visor 3D genérico con slider/▶, que reconstruye cuando cambia `signature`. */
function FoldViewer({ title, build, signature }: { title: string; build: () => Built; signature: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const applyRef = useRef<FoldFn>(() => {});
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [fold, setFold] = useState(1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x201711);
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 100000);
    camera.position.set(190, 160, 230);
    cameraRef.current = camera;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(1, 1.5, 1); scene.add(dir);
    scene.add(new THREE.GridHelper(2000, 40, 0x4a3627, 0x2b2018));
    let raf = 0;
    const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();
    const onResize = () => {
      if (!mount.clientWidth) return;
      camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf); window.removeEventListener("resize", onResize);
      controls.dispose(); renderer.dispose(); mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (rootRef.current) scene.remove(rootRef.current);
    try {
      const built = build();
      rootRef.current = built.root;
      scene.add(built.root);
      applyRef.current = built.setFold;
      applyRef.current(fold);
      // Encuadre automático (zoom out) para que entre toda la pieza.
      const cam = cameraRef.current, ctr = controlsRef.current;
      if (cam && ctr) {
        built.root.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(built.root);
        if (!bb.isEmpty()) {
          const center = bb.getCenter(new THREE.Vector3());
          const size = bb.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const dist = (maxDim / (2 * Math.tan((cam.fov * Math.PI) / 360))) * 1.5;
          const d = new THREE.Vector3(0.9, 0.7, 1.2).normalize();
          cam.position.copy(center).addScaledVector(d, dist);
          cam.near = Math.max(0.5, dist / 200); cam.far = dist * 200; cam.updateProjectionMatrix();
          ctr.target.copy(center); ctr.update();
        }
      }
    } catch (e) {
      // Una geometría inválida no debe tumbar la app: log y escena vacía.
      console.error("Error al generar el plegado 3D:", e);
      rootRef.current = null;
      applyRef.current = () => {};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => { applyRef.current(fold); }, [fold]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0, dir = -1, v = fold;
    const step = () => {
      v += dir * 0.012;
      if (v <= 0) { v = 0; dir = 1; } else if (v >= 1) { v = 1; dir = -1; }
      setFold(v); raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  return (
    <div className="foldsim">
      <div className="foldtitle">{title}</div>
      <div ref={mountRef} className="viewer3d" />
      <div className="foldbar">
        <button onClick={() => setPlaying((p) => !p)} className="secondary">{playing ? "⏸" : "▶"}</button>
        <input type="range" min={0} max={1} step={0.01} value={fold}
          onChange={(e) => { setPlaying(false); setFold(parseFloat(e.target.value)); }} />
        <span>{Math.round(fold * 100)}%</span>
      </div>
    </div>
  );
}

export default function FoldSim({ params, mode, items, products, positions, nestedVolumes = [], outerIdx = 0, placements = [], images = [] }: Props) {
  // Precarga las imágenes subidas a <img> para poder usarlas como textura.
  const [loaded, setLoaded] = useState<Record<string, HTMLImageElement>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(
      images.map(
        (di) =>
          new Promise<[string, HTMLImageElement] | null>((res) => {
            const im = new Image();
            im.onload = () => res([di.id, im]);
            im.onerror = () => res(null);
            im.src = di.dataUrl;
          })
      )
    ).then((pairs) => {
      if (!alive) return;
      const m: Record<string, HTMLImageElement> = {};
      for (const p of pairs) if (p) m[p[0]] = p[1];
      setLoaded(m);
    });
    return () => { alive = false; };
  }, [images]);

  const decor: Decor = { placements, loaded };

  // El plegado se genera A PEDIDO (no en cada cambio de slider): así evitamos
  // reconstruir toda la escena/re-parsear STL en cada tick, que era pesado y
  // podía dejar geometrías a medio actualizar. El botón "Actualizar" lo regenera
  // con la disposición actual; también se regenera al terminar de cargar imágenes.
  const [nonce, setNonce] = useState(0);
  const loadedKey = Object.keys(loaded).sort().join(",");
  useEffect(() => { if (loadedKey) setNonce((n) => n + 1); }, [loadedKey]);
  // Regenera automáticamente ante cambios estructurales (no en cada tick de slider):
  // cantidad de repisas, modo, tipo de caja o cantidad de STL.
  const structSig = `${params.sliceCount}|${params.boxType}|${params.topFlaps}|${mode}|${items.length}`;
  useEffect(() => { setNonce((n) => n + 1); }, [structSig]);

  return (
    <div className="foldgrid">
      <div className="fold-actions">
        <button onClick={() => setNonce((n) => n + 1)}>🔄 Actualizar plegado</button>
        <span className="meta">Se genera con la disposición actual; actualizá tras acomodar los productos.</span>
      </div>
      {mode === "individual-boxes" ? (
        <>
          {/* Caja externa: el producto grande suspendido + las cajas chicas como volúmenes. */}
          <FoldViewer title="Caja externa (contiene todo)" signature={`outer|${nonce}`}
            build={() => {
              const built = buildBox(params, "single-insert", items[outerIdx] ? [items[outerIdx]] : [], products[outerIdx] ? [products[outerIdx]] : [], [positions[outerIdx] ?? { x: 0, y: 0, z: 0 }], decor);
              nestedVolumes.forEach((v) => {
                const g = new THREE.BoxGeometry(v.w, params.trayWallHeight, v.h);
                const box = new THREE.Mesh(g, mat(0.32, 0xd59248));
                box.position.set(v.relX, params.trayWallHeight / 2, v.relY);
                built.root.add(box);
              });
              return built;
            }} />
          {/* Cada caja chica: su propio armado. */}
          {items.map((it, i) => (i === outerIdx ? null : (
            <FoldViewer key={it.id} title={`Caja ${i + 1} — armado`} signature={`box${i}|${nonce}`}
              build={() => buildBox({ ...params, product: products[i] }, "single-insert", [it], [products[i]], [{ x: 0, y: 0, z: 0 }])} />
          )))}
        </>
      ) : (
        <>
          <FoldViewer title="Caja" signature={`box|${nonce}`}
            build={() => buildBox(params, mode, items, products, positions, decor)} />
          <FoldViewer title="Insert" signature={`ins|${nonce}`}
            build={() => buildInsertMulti(params, items, products, positions)} />
        </>
      )}
    </div>
  );
}
