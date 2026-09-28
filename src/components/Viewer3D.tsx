// Visor 3D del STL con three.js: centra el modelo, muestra el bounding box
// y permite orbitar. Recibe el ArrayBuffer del STL.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Orientation } from "../lib/product";

interface Props {
  buffer: ArrayBuffer | null;
  orientation?: Orientation;
}

/** Rotación del mesh que replica EXACTAMENTE analyze (flip → eje vertical → giro) y lleva Z↑ a Y↑. */
function applyOrientation(mesh: THREE.Mesh, o?: Orientation) {
  mesh.rotation.set(0, 0, 0);
  if (!o) return;
  const flip = new THREE.Matrix4();
  if (o.flip) o.up === "x" ? flip.makeRotationY(Math.PI) : flip.makeRotationX(Math.PI);
  const orient = new THREE.Matrix4();
  if (o.up === "y") orient.makeRotationX(Math.PI / 2);
  else if (o.up === "x") orient.makeRotationY(-Math.PI / 2);
  const planar = new THREE.Matrix4().makeRotationZ((o.rotateDeg * Math.PI) / 180);
  const zy = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  mesh.quaternion.setFromRotationMatrix(zy.multiply(planar).multiply(orient).multiply(flip));
}

export default function Viewer3D({ buffer, orientation }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const boxRef = useRef<THREE.Box3Helper | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  // Inicializa la escena una sola vez.
  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.1,
      10000
    );
    camera.position.set(120, 120, 120);

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
    const grid = new THREE.GridHelper(400, 40, 0x334155, 0x1e293b);
    scene.add(grid);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
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

  // Carga el STL cuando cambia el buffer.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !buffer) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
    }
    if (boxRef.current) scene.remove(boxRef.current);

    const loader = new STLLoader();
    // STLLoader.parse acepta ArrayBuffer o string.
    const geometry = loader.parse(buffer);
    geometry.computeBoundingBox();
    geometry.center(); // centra en el origen para orbitar cómodo

    const material = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.1,
      roughness: 0.6,
    });
    const mesh = new THREE.Mesh(geometry, material);
    // Bounding box como hijo del mesh (rota junto con él).
    const helper = new THREE.Box3Helper(
      geometry.boundingBox!.clone(),
      new THREE.Color(0xf59e0b)
    );
    mesh.add(helper);
    applyOrientation(mesh, orientation);
    scene.add(mesh);
    meshRef.current = mesh;
    boxRef.current = helper;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer]);

  // Reaplica la orientación cuando cambia (sin recargar la geometría).
  useEffect(() => {
    if (meshRef.current) applyOrientation(meshRef.current, orientation);
  }, [orientation?.up, orientation?.rotateDeg, orientation?.flip]);

  return <div ref={mountRef} className="viewer3d" />;
}
