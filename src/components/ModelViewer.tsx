import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PlacedPart } from '../types/index.js';
import { renderIsometric } from '../lego/renderIsometric.js';

const PLATE_HEIGHT = 0.4;
const STUD_HEIGHT = 0.16;

export interface ModelRenderOptions {
  highlightIds?: string[];
  exploded?: boolean;
}

/** A future LDraw adapter can return the same Three.js scene graph contract. */
export interface ModelRenderingAdapter {
  readonly name: string;
  /** The viewer owns and disposes the returned graph's geometries and materials. */
  build(parts: readonly PlacedPart[], options?: ModelRenderOptions): THREE.Group;
}

export interface ModelViewerProps extends ModelRenderOptions {
  parts: PlacedPart[];
  showGrid?: boolean;
  className?: string;
  onReady?: () => void;
}

function slopeGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  // A solid wedge, with its low edge toward the front and a short vertical lip.
  const profile = new THREE.Shape();
  profile.moveTo(-depth / 2, -height / 2);
  profile.lineTo(depth / 2, -height / 2);
  profile.lineTo(depth / 2, height / 2);
  profile.lineTo(depth / 2 - Math.min(1, depth / 2), height / 2);
  profile.lineTo(-depth / 2, -height / 2 + Math.min(height * 0.25, 0.25));
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, {
    depth: width,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: 0.018,
    bevelThickness: 0.018,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

export const simplifiedLegoAdapter: ModelRenderingAdapter = {
  name: 'simplified-lego',
  build(parts, options = {}) {
    const group = new THREE.Group();
    const highlighted = new Set(options.highlightIds ?? []);
    const hasHighlights = highlighted.size > 0;
    const geometries = new Map<string, THREE.BufferGeometry>();
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    let studGeometry: THREE.CylinderGeometry | undefined;
    let studTopGeometry: THREE.CylinderGeometry | undefined;
    let outlineMaterial: THREE.LineBasicMaterial | undefined;

    for (const part of parts) {
      if (part.category === 'Unsupported') continue;
      const { x: rawWidth, y: rawDepth, z: plates } = part.dimensions;
      if (![rawWidth, rawDepth, plates, part.position.x, part.position.y, part.position.z].every(Number.isFinite)) continue;
      if (rawWidth <= 0 || rawDepth <= 0 || plates <= 0) continue;
      const width = rawWidth - 0.045;
      const depth = rawDepth - 0.045;
      const height = plates * PLATE_HEIGHT - 0.025;
      const active = highlighted.has(part.instanceId);
      const muted = hasHighlights && !active;
      const materialKey = `${part.color.hex}:${active}:${muted}`;
      let material = materials.get(materialKey);
      if (!material) {
        const color = new THREE.Color(part.color.hex);
        if (muted) color.lerp(new THREE.Color('#d4ded8'), 0.42);
        material = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.29,
          metalness: 0.01,
          emissive: active ? new THREE.Color('#3f735a') : new THREE.Color('#000000'),
          emissiveIntensity: active ? 0.1 : 0,
        });
        materials.set(materialKey, material);
      }

      const partGroup = new THREE.Group();
      partGroup.name = part.instanceId;
      partGroup.userData = { instanceId: part.instanceId, partId: part.partId };
      const quarterTurn = part.rotation === 90 || part.rotation === 270;
      const footprintX = quarterTurn ? rawDepth : rawWidth;
      const footprintY = quarterTurn ? rawWidth : rawDepth;
      const explodeOffset = options.exploded ? Math.max(0, part.buildStep - 1) * 0.7 * PLATE_HEIGHT : 0;
      partGroup.position.set(
        part.position.x + footprintX / 2,
        part.position.z * PLATE_HEIGHT + height / 2 + explodeOffset,
        part.position.y + footprintY / 2,
      );
      partGroup.rotation.y = -(part.rotation * Math.PI) / 180;

      const shapeKey = `${part.category}:${width}:${height}:${depth}`;
      let geometry = geometries.get(shapeKey);
      if (!geometry) {
        geometry = part.category === 'Slope'
          ? slopeGeometry(width, height, depth)
          : new RoundedBoxGeometry(width, height, depth, 2, 0.035);
        geometries.set(shapeKey, geometry);
      }
      const body = new THREE.Mesh(geometry, material);
      body.castShadow = true;
      body.receiveShadow = true;
      partGroup.add(body);

      if (active) {
        outlineMaterial ??= new THREE.LineBasicMaterial({
          color: '#42aa89', transparent: true, opacity: 0.88,
        });
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 32), outlineMaterial);
        edges.scale.setScalar(1.005);
        partGroup.add(edges);
      }

      if (part.category !== 'Tile') {
        studGeometry ??= new THREE.CylinderGeometry(0.298, 0.302, STUD_HEIGHT, 20);
        studTopGeometry ??= new THREE.CylinderGeometry(0.254, 0.254, 0.009, 20);
        for (let x = 0; x < rawWidth; x += 1) {
          for (let y = 0; y < rawDepth; y += 1) {
            // Slope studs are only placed on the high, flat rear row.
            if (part.category === 'Slope' && y !== rawDepth - 1) continue;
            const stud = new THREE.Mesh(studGeometry, material);
            stud.position.set(x - rawWidth / 2 + 0.5, height / 2 + STUD_HEIGHT / 2, y - rawDepth / 2 + 0.5);
            stud.castShadow = true;
            stud.receiveShadow = true;
            const cap = new THREE.Mesh(studTopGeometry, material);
            cap.position.set(stud.position.x, height / 2 + STUD_HEIGHT + 0.005, stud.position.z);
            cap.receiveShadow = true;
            partGroup.add(stud, cap);
          }
        }
      }
      group.add(partGroup);
    }
    return group;
  },
};

function disposeGraph(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => materials.add(material));
    else if (mesh.material) materials.add(mesh.material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

interface ViewerRuntime {
  replaceModel: (parts: PlacedPart[], options: ModelRenderOptions, showGrid: boolean) => void;
  resize: () => void;
  dispose: () => void;
}

function createRuntime(canvas: HTMLCanvasElement, host: HTMLDivElement, ready: () => void, fail: () => void): ViewerRuntime {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor('#e9eee5', 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  camera.position.set(20, 17, 24);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minZoom = 0.35;
  controls.maxZoom = 3.5;
  controls.minPolarAngle = Math.PI * 0.07;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.8;
  controls.listenToKeyEvents(canvas);
  scene.add(new THREE.HemisphereLight('#ffffff', '#849b7e', 2.5));
  const key = new THREE.DirectionalLight('#ffffff', 3.5);
  key.position.set(-10, 22, 16);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.normalBias = 0.04;
  key.shadow.bias = -0.0002;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 100;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#d5eaff', 1.1);
  fill.position.set(12, 8, -10);
  scene.add(fill);

  let model = new THREE.Group();
  let stage = new THREE.Group();
  let bounds = new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 5, 2));
  let frame = 0;
  let disposed = false;
  let notified = false;
  scene.add(model, stage);

  const render = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (disposed) return;
      try {
        renderer.render(scene, camera);
        if (!notified) { notified = true; ready(); }
      } catch { fail(); }
    });
  };
  controls.addEventListener('change', render);

  const fit = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const aspect = width / height;
    renderer.setSize(width, height, false);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const distance = Math.max(size.length() * 2.2, 15);
    const direction = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    controls.target.copy(center);
    camera.lookAt(center);
    camera.updateMatrixWorld();

    let projectedWidth = 0;
    let projectedHeight = 0;
    const cameraBounds = new THREE.Box3();
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          cameraBounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
        }
      }
    }
    projectedWidth = Math.max(cameraBounds.max.x - cameraBounds.min.x, 3.5);
    projectedHeight = Math.max(cameraBounds.max.y - cameraBounds.min.y, 3.5);
    const frustumHeight = Math.max(projectedHeight * 1.32, projectedWidth * 1.32 / aspect);
    camera.left = -frustumHeight * aspect / 2;
    camera.right = frustumHeight * aspect / 2;
    camera.top = frustumHeight / 2;
    camera.bottom = -frustumHeight / 2;
    camera.near = Math.max(0.1, distance - size.length() * 2);
    camera.far = distance + size.length() * 3 + 50;
    camera.updateProjectionMatrix();
    controls.update();
    render();
  };

  const replaceModel: ViewerRuntime['replaceModel'] = (parts, options, showGrid) => {
    scene.remove(model, stage);
    disposeGraph(model);
    disposeGraph(stage);
    model = simplifiedLegoAdapter.build(parts, options);
    bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 5, 2));
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -bounds.min.y + 0.025, -center.z);
    bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 5, 2));
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(Math.hypot(size.x, size.z) * 0.6 + 1.8, 4.8);
    stage = new THREE.Group();
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 80),
      new THREE.MeshStandardMaterial({ color: '#e2e9dc', roughness: 1, transparent: true, opacity: 0.66 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.055;
    ground.receiveShadow = true;
    stage.add(ground);
    if (showGrid) {
      const grid = new THREE.GridHelper(Math.ceil(radius * 2), Math.ceil(radius * 2), '#92aa92', '#b4c6ad');
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMaterials.forEach((material) => { material.transparent = true; material.opacity = 0.28; material.depthWrite = false; });
      grid.position.y = -0.035;
      stage.add(grid);
    }
    key.position.set(-radius, Math.max(size.y + 12, 20), radius * 1.3);
    key.target.position.set(0, size.y * 0.4, 0);
    const shadowExtent = Math.max(radius, size.y);
    key.shadow.camera.left = -shadowExtent;
    key.shadow.camera.right = shadowExtent;
    key.shadow.camera.top = shadowExtent;
    key.shadow.camera.bottom = -shadowExtent;
    key.shadow.camera.far = Math.max(100, size.y * 5);
    key.shadow.camera.updateProjectionMatrix();
    scene.add(model, stage);
    camera.zoom = 1;
    fit();
  };

  const contextLost = (event: Event) => { event.preventDefault(); fail(); };
  canvas.addEventListener('webglcontextlost', contextLost);
  return {
    replaceModel,
    resize: fit,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener('webglcontextlost', contextLost);
      controls.removeEventListener('change', render);
      controls.dispose();
      disposeGraph(model);
      disposeGraph(stage);
      key.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

function CanvasFallback({ parts, highlightIds, exploded, showGrid, onReady }: ModelViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const draw = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, host.clientWidth * ratio);
      canvas.height = Math.max(1, host.clientHeight * ratio);
      renderIsometric(canvas, parts, { highlightIds, exploded, showGrid });
      readyRef.current?.();
    };
    const observer = new ResizeObserver(draw);
    observer.observe(host);
    draw();
    return () => observer.disconnect();
  }, [parts, highlightIds, exploded, showGrid]);
  return <>
    <canvas ref={canvasRef} className="model-viewer-canvas" aria-label={`积木模型示意图，共 ${parts.length} 个零件`} style={{ display: 'block', width: '100%', height: '100%' }} />
    <span className="model-viewer-fallback" role="status" style={{ position: 'absolute', left: 16, bottom: 16, fontSize: 11, color: '#627567', background: '#ffffffcf', borderRadius: 8, padding: '6px 9px' }}>WebGL 不可用，已切换示意图</span>
  </>;
}

export function ModelViewer({ parts, highlightIds, showGrid = true, className = '', exploded = false, onReady }: ModelViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (fallback || !hostRef.current || !canvasRef.current) return;
    let runtime: ViewerRuntime;
    try {
      runtime = createRuntime(canvasRef.current, hostRef.current, () => readyRef.current?.(), () => setFallback(true));
      runtimeRef.current = runtime;
    } catch {
      setFallback(true);
      return;
    }
    const observer = new ResizeObserver(() => runtime.resize());
    observer.observe(hostRef.current);
    return () => {
      observer.disconnect();
      runtimeRef.current = null;
      runtime.dispose();
    };
  }, [fallback]);

  useEffect(() => {
    if (!fallback) {
      try { runtimeRef.current?.replaceModel(parts, { highlightIds, exploded }, showGrid); }
      catch { setFallback(true); }
    }
  }, [parts, highlightIds, showGrid, exploded, fallback]);

  return <div ref={hostRef} className={`model-viewer ${className}`.trim()} style={{ width: '100%', height: '100%', minHeight: 260, position: 'relative', overflow: 'hidden' }}>
    {fallback
      ? <CanvasFallback parts={parts} highlightIds={highlightIds} showGrid={showGrid} exploded={exploded} onReady={onReady} />
      : <canvas ref={canvasRef} className="model-viewer-canvas" tabIndex={0} aria-label={`交互式 3D 积木模型，共 ${parts.length} 个零件。拖动旋转，滚轮缩放，方向键平移。`} style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }} />}
  </div>;
}

export default ModelViewer;
