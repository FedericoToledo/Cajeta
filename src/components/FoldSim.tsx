// Simulador de plegado 3D. Dos reproductores independientes: CAJA e INSERT.
// Todo pliega DESDE PLANO: a t=0 el cartón está desplegado sobre el piso (igual
// que el dieline) y a t=1 queda armado. Se usa una jerarquía de paneles con
// bisagra (cada panel se pliega respecto de su padre), así las caras coinciden
// con el dieline y arrancan en el piso.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Orientation } from "../lib/product";
import { Params, innerDims } from "../lib/types";
import { insertShelves } from "../lib/dielines";
import { offsetConvex, Pt } from "../lib/polygon";

interface Props {
  buffer: ArrayBuffer | null;
  orientation?: Orientation;
  params: Params;
}

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

/** Agrega una bandeja (fondo/plataforma + 4 paredes + solapas de esquina + doble solapa). */
function addTray(
  root: THREE.Object3D, folds: FoldFn[],
  L: number, W: number, H: number,
  o: { topFlaps?: boolean; flapWalls?: "both" | "front"; thickness: number; cornerTab: number; platformWindow?: Pt[] | null }
) {
  root.add(floorMesh(L, W, o.platformWindow ?? null));

  const up = -Math.PI / 2;
  const front = hinge(folds, root, [0, 0, W / 2], 0, up);
  const back = hinge(folds, root, [0, 0, -W / 2], Math.PI, up);
  const left = hinge(folds, root, [-L / 2, 0, 0], -Math.PI / 2, up);
  const right = hinge(folds, root, [L / 2, 0, 0], Math.PI / 2, up);
  front.add(panelMesh(L, H, mat()));
  back.add(panelMesh(L, H, mat()));
  left.add(panelMesh(W, H, mat()));
  right.add(panelMesh(W, H, mat()));

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

/** CAJA: bandeja + tapa (telescópica) o cofre (tapa con bisagra en la cara larga). */
function buildBox(params: Params, buffer: ArrayBuffer | null, orientation?: Orientation): Built {
  const root = new THREE.Group();
  const folds: FoldFn[] = [];
  const { L, W, H } = innerDims(params);
  const isChest = params.boxType === "chest";

  const tray = addTray(root, folds, L, W, H, {
    topFlaps: params.topFlaps,
    flapWalls: isChest ? "front" : "both",
    thickness: params.thickness,
    cornerTab: params.cornerTab,
  });

  if (isChest) {
    const lip = Math.max(10, params.lidHeight * 0.6);
    const long = Math.max(L, W);
    const host = L >= W ? tray.back : tray.right; // cara más larga
    const depth = (L >= W ? W : L) + params.thickness;
    const lid = hinge(folds, host, [0, 0, H], 0, -Math.PI / 2); // pliega sobre el tope
    lid.add(panelMesh(long, depth, mat(0.55)));
    const lipFold = hinge(folds, lid, [0, 0, depth], 0, -Math.PI / 2);
    lipFold.add(panelMesh(long, lip, mat(0.55)));
  } else {
    // Tapa (vista explotada): como un capuchón invertido, ARRIBA y SEPARADA de la
    // bandeja, para identificar cada parte. Sus paredes se pliegan con el slider.
    const grow = 2 * (params.thickness + params.lidClearance);
    const lidParent = new THREE.Group();
    lidParent.rotation.x = Math.PI; // invertida: paredes hacia abajo (capuchón)
    lidParent.position.set(0, H + 40 + params.lidHeight, 0); // arriba de la bandeja, separada
    root.add(lidParent);
    addTray(lidParent, folds, L + grow, W + grow, params.lidHeight, {
      topFlaps: params.topFlaps, thickness: params.thickness, cornerTab: params.cornerTab,
    });
  }

  // Producto suspendido en el centro.
  if (buffer) {
    const geo = new STLLoader().parse(buffer);
    orientGeometry(geo, orientation);
    geo.center();
    const p = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.1, roughness: 0.6 }));
    p.position.set(0, Math.max(params.product.z / 2, H / 2), 0);
    root.add(p);
  }

  return { root, setFold: (t) => folds.forEach((f) => f(t)) };
}

/**
 * INSERT: plataforma con ventana + 4 paredes que bajan al PISO (apoya en 4 caras).
 * Es una bandeja de altura completa (apoya en el piso) + un acordeón de repisas
 * (con ventana) que cuelga desde el borde superior de la pared del fondo.
 */
function winForSection(params: Params, contour: Pt[] | undefined, inset: number): Pt[] {
  if (params.useContour && contour && contour.length >= 3) return offsetConvex(contour, inset);
  const wx = Math.max(3, params.product.x - 2 * inset);
  const wy = Math.max(3, params.product.y - 2 * inset);
  return [[-wx / 2, -wy / 2], [wx / 2, -wy / 2], [wx / 2, wy / 2], [-wx / 2, wy / 2]];
}

/** Repisa (panel horizontal que extiende +Z desde su bisagra) con VENTANA recortada. */
function shelfPanel(width: number, depth: number, window: Pt[]): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0); shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, depth); shape.lineTo(-width / 2, depth); shape.closePath();
  if (window.length >= 3) {
    const hole = new THREE.Path();
    window.forEach((p, i) => (i === 0 ? hole.moveTo(p[0], p[1] + depth / 2) : hole.lineTo(p[0], p[1] + depth / 2)));
    hole.closePath();
    shape.holes.push(hole);
  }
  const geo = new THREE.ShapeGeometry(shape); geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(geo, mat(0.6, 0xf59e0b));
}

function buildInsert(params: Params, buffer: ArrayBuffer | null, orientation?: Orientation): Built {
  const root = new THREE.Group();
  const folds: FoldFn[] = [];
  const { L, W, H } = innerDims(params);
  const sh = insertShelves(params);
  const inset = params.gripMargin + params.kerf / 2;

  // Bandeja exterior de altura completa (apoya en el piso), con el fondo abierto
  // (marco) para NO tener piso completo: el producto queda suspendido.
  const fr = Math.min(20, L * 0.15, W * 0.15);
  const opening: Pt[] = [
    [-(L - 2 * fr) / 2, -(W - 2 * fr) / 2], [(L - 2 * fr) / 2, -(W - 2 * fr) / 2],
    [(L - 2 * fr) / 2, (W - 2 * fr) / 2], [-(L - 2 * fr) / 2, (W - 2 * fr) / 2],
  ];
  const tray = addTray(root, folds, L, W, H, {
    thickness: params.thickness, cornerTab: params.cornerTab, platformWindow: opening,
  });

  // Acordeón de repisas colgando desde el borde superior de la pared del fondo.
  // La ventana se refleja en X para coincidir con la orientación del producto.
  let parent = tray.back;
  for (let k = 0; k < sh.count; k++) {
    const shelfFold = hinge(folds, parent, [0, 0, k === 0 ? H : sh.spacing], 0, -Math.PI / 2);
    const win = winForSection(params, sh.slices[sh.count - 1 - k], inset).map((p) => [-p[0], p[1]] as Pt);
    shelfFold.add(shelfPanel(L, sh.depthY, win));
    if (k < sh.count - 1 && sh.spacing > 0) {
      const riser = hinge(folds, shelfFold, [0, 0, sh.depthY], 0, -Math.PI / 2);
      riser.add(panelMesh(L, sh.spacing, mat(0.6, 0xfbbf24)));
      parent = riser;
    }
  }

  // Producto suspendido (colgado de las repisas), centrado.
  if (buffer) {
    const geo = new STLLoader().parse(buffer);
    orientGeometry(geo, orientation);
    geo.center();
    const p = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x38bdf8, metalness: 0.1, roughness: 0.6, transparent: true, opacity: 0.8,
    }));
    p.position.set(0, H - params.product.z / 2, 0);
    root.add(p);
  }

  return { root, setFold: (t) => folds.forEach((f) => f(t)) };
}

/** Visor 3D genérico con slider/▶, que reconstruye cuando cambia `signature`. */
function FoldViewer({ title, build, signature }: { title: string; build: () => Built; signature: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const applyRef = useRef<FoldFn>(() => {});
  const [fold, setFold] = useState(1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 100000);
    camera.position.set(190, 160, 230);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(1, 1.5, 1); scene.add(dir);
    scene.add(new THREE.GridHelper(600, 30, 0x334155, 0x1e293b));
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
    const built = build();
    rootRef.current = built.root;
    scene.add(built.root);
    applyRef.current = built.setFold;
    applyRef.current(fold);
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

export default function FoldSim({ buffer, orientation, params }: Props) {
  // Firmas de reconstrucción: la caja y el insert dependen de subconjuntos.
  const boxSig = JSON.stringify([
    params.product.x, params.product.y, params.product.z, params.clearance,
    params.trayWallHeight, params.thickness, params.lidHeight, params.lidClearance,
    params.boxType, params.topFlaps, params.cornerTab, orientation?.up, orientation?.rotateDeg, orientation?.flip, !!buffer,
  ]);
  const insertSig = JSON.stringify([
    params.product.x, params.product.y, params.product.z, params.clearance,
    params.trayWallHeight, params.thickness, params.cornerTab, params.sliceCount,
    params.squeeze, params.useContour, params.gripMargin, params.kerf,
    orientation?.up, orientation?.rotateDeg, orientation?.flip, !!buffer,
  ]);

  return (
    <div className="foldgrid">
      <FoldViewer title="Caja" signature={boxSig} build={() => buildBox(params, buffer, orientation)} />
      <FoldViewer title="Insert" signature={insertSig} build={() => buildInsert(params, buffer, orientation)} />
    </div>
  );
}
