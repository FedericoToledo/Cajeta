// Visor 3D de uno o varios STL con three.js: centra cada modelo, muestra su
// bounding box y los acomoda en sus posiciones de empaquetado (sin superponerse).
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Orientation } from "../lib/product";

export interface ViewItem {
  id: string;
  buffer: ArrayBuffer;
  orientation?: Orientation;
}

interface Props {
  items: ViewItem[];
  positions?: { x: number; y: number; z?: number }[]; // centro (plano XY) + z vertical, centrado en origen
}

/** Rotación del mesh que replica EXACTAMENTE analyze (flip → eje vertical → giro) y lleva Z↑ a Y↑. */
function orientationQuat(o?: Orientation): THREE.Quaternion {
  const q = new THREE.Quaternion();
  if (!o) return q;
  const flip = new THREE.Matrix4();
  if (o.flip) o.up === "x" ? flip.makeRotationY(Math.PI) : flip.makeRotationX(Math.PI);
  const orient = new THREE.Matrix4();
  if (o.up === "y") orient.makeRotationX(Math.PI / 2);
  else if (o.up === "x") orient.makeRotationY(-Math.PI / 2);
  const planar = new THREE.Matrix4().makeRotationZ((o.rotateDeg * Math.PI) / 180);
  const zy = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  return q.setFromRotationMatrix(zy.multiply(planar).multiply(orient).multiply(flip));
}

export default function Viewer3D({ items, positions }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  // Inicializa la escena una sola vez.
  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 10000);
    camera.position.set(160, 160, 160);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(1, 1, 1);
    scene.add(dir);
    scene.add(new THREE.GridHelper(400, 40, 0x334155, 0x1e293b));

    let raf = 0;
    const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // (Re)construye los meshes cuando cambian los items, orientaciones o posiciones.
  const sig = JSON.stringify(
    items.map((it, i) => [it.id, it.orientation?.up, it.orientation?.rotateDeg, it.orientation?.flip, positions?.[i]?.x, positions?.[i]?.y, positions?.[i]?.z])
  );
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (groupRef.current) {
      scene.remove(groupRef.current);
      groupRef.current.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
    }
    const group = new THREE.Group();
    items.forEach((it, i) => {
      const geometry = new STLLoader().parse(it.buffer);
      geometry.computeBoundingBox();
      geometry.center();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.1, roughness: 0.6 })
      );
      mesh.add(new THREE.Box3Helper(geometry.boundingBox!.clone(), new THREE.Color(0xf59e0b)));
      mesh.quaternion.copy(orientationQuat(it.orientation));
      const p = positions?.[i];
      if (p) mesh.position.set(p.x, p.z ?? 0, p.y);
      group.add(mesh);
    });
    scene.add(group);
    groupRef.current = group;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return <div ref={mountRef} className="viewer3d" />;
}
