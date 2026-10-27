import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RotateCcw } from 'lucide-react';
import type { NativeConnectionPoint, NativeMesh, NativeVector } from './NativePartViewer.js';

export interface AssemblyTransform {
  /** Row-major 3 × 3 source rotation matrix. */
  rotation: [number, number, number, number, number, number, number, number, number];
  translation: NativeVector;
}
export interface AssemblyPlacement {
  instanceId: string;
  partId: string;
  transform: AssemblyTransform;
}
export interface AssemblyCollisionProxy {
  status: 'ready' | 'blocked';
  reason: string;
  reasonCode: string;
  mesh?: NativeMesh;
  bounds?: { min: NativeVector; max: NativeVector };
  topology?: unknown;
  evidence?: unknown;
}
export interface AssemblyAsset { mesh: NativeMesh; connections?: NativeConnectionPoint[]; collisionProxy?: AssemblyCollisionProxy }
export interface AssemblyDebugView {
  /** All debug primitives are in the same world-space, native LDraw LDU frame. */
  insertionAxis?: { origin: NativeVector; direction: NativeVector; length?: number };
  insertionPath?: NativeVector[];
  proxies?: { mesh: NativeMesh; transform: AssemblyTransform }[];
  penetrationZones?: { origin: NativeVector; axis: NativeVector; radius: number; length: number }[];
}

function matrixFor(transform: AssemblyTransform) {
  const r = transform.rotation, t = transform.translation;
  return new THREE.Matrix4().set(r[0], r[1], r[2], t[0], r[3], r[4], r[5], t[1], r[6], r[7], r[8], t[2], 0, 0, 0, 1);
}
function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    const item = object as THREE.Mesh;
    if (item.geometry) geometries.add(item.geometry);
    if (Array.isArray(item.material)) item.material.forEach((material) => materials.add(material));
    else if (item.material) materials.add(item.material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

/** Meshes and solved transforms are supplied by the assembly API, with no shape fallback. */
export default function NativeAssemblyViewer({ placements, assets, debug, showConnections, showProxies, showPath, showZones }: {
  placements: AssemblyPlacement[];
  assets: Record<string, AssemblyAsset>;
  debug?: AssemblyDebugView;
  showConnections: boolean;
  showProxies: boolean;
  showPath: boolean;
  showZones: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const scene = new THREE.Scene();
    let renderer: THREE.WebGLRenderer | undefined, controls: OrbitControls | undefined, observer: ResizeObserver | undefined;
    let frame = 0, stopped = false;
    const release = () => { stopped = true; cancelAnimationFrame(frame); observer?.disconnect(); controls?.dispose(); disposeScene(scene); renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove(); };
    setError('');
    try {
      if (!placements.length) throw new Error('尚无可显示的装配放置结果。');
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-label', '原生网格与装配求解结果三维视图');
      renderer.domElement.setAttribute('role', 'img');
      container.appendChild(renderer.domElement);
      const native = new THREE.Group();
      native.rotation.x = Math.PI;
      scene.add(native);
      const geometryCache = new Map<string, THREE.BufferGeometry>();
      const colors = ['#a5ba83', '#84b8b5', '#d6b480', '#ada5cb', '#d2927f'];
      const partMaterials = new Map<number, THREE.MeshStandardMaterial>();
      placements.forEach((placement, index) => {
        const asset = assets[placement.partId];
        if (!asset?.mesh.positions.length || !asset.mesh.indices.length) throw new Error(`零件 ${placement.partId} 缺少可显示的真实网格。`);
        const values = [...placement.transform.rotation, ...placement.transform.translation];
        if (placement.transform.rotation.length !== 9 || placement.transform.translation.length !== 3 || !values.every(Number.isFinite)) throw new Error('装配结果包含无效变换。');
        let geometry = geometryCache.get(placement.partId);
        if (!geometry) {
          geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(asset.mesh.positions.flat(), 3));
          geometry.setIndex(asset.mesh.indices);
          geometry.computeVertexNormals();
          geometryCache.set(placement.partId, geometry);
        }
        const instance = new THREE.Group();
        instance.name = placement.instanceId;
        instance.matrix.copy(matrixFor(placement.transform));
        instance.matrixAutoUpdate = false;
        const colorIndex = index % colors.length;
        let material = partMaterials.get(colorIndex);
        if (!material) {
          material = new THREE.MeshStandardMaterial({ color: colors[colorIndex], roughness: 0.48, metalness: 0.02, side: THREE.DoubleSide });
          partMaterials.set(colorIndex, material);
        }
        instance.add(new THREE.Mesh(geometry, material));
        if (showConnections && asset.connections?.length) {
          const extent = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute).getSize(new THREE.Vector3()).length();
          const size = Math.max(0.55, extent / 90);
          const markerGeometry = new THREE.SphereGeometry(size, 8, 6);
          const markerMaterial = new THREE.MeshBasicMaterial({ color: '#bf5a99', depthTest: false });
          (asset.connections ?? []).forEach((point) => {
            const marker = new THREE.Mesh(markerGeometry, markerMaterial);
            marker.position.fromArray(point.position);
            marker.renderOrder = 8;
            instance.add(marker);
            const direction = point.direction && new THREE.Vector3().fromArray(point.direction);
            if (direction?.lengthSq()) instance.add(new THREE.ArrowHelper(direction.normalize(), marker.position, size * 4, '#bf5a99', size, size * 0.6));
          });
        }
        native.add(instance);
      });
      native.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(native);
      const extent = Math.max(bounds.getSize(new THREE.Vector3()).length(), 15);
      if (showProxies) (debug?.proxies ?? []).forEach((proxy) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(proxy.mesh.positions.flat(), 3));
        geometry.setIndex(proxy.mesh.indices);
        const helper = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#d3933b', wireframe: true, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
        const group = new THREE.Group();
        group.matrix.copy(matrixFor(proxy.transform)); group.matrixAutoUpdate = false;
        group.add(helper); native.add(group);
      });
      if (showPath) {
        const axis = debug?.insertionAxis;
        if (axis) {
          const direction = new THREE.Vector3().fromArray(axis.direction);
          if (direction.lengthSq()) native.add(new THREE.ArrowHelper(direction.normalize(), new THREE.Vector3().fromArray(axis.origin), axis.length ?? extent * 0.3, '#cc7654', extent * 0.04, extent * 0.025));
        }
        if (debug?.insertionPath?.length) {
          const pathGeometry = new THREE.BufferGeometry().setFromPoints(debug.insertionPath.map((point) => new THREE.Vector3().fromArray(point)));
          native.add(new THREE.Line(pathGeometry, new THREE.LineDashedMaterial({ color: '#9b6bb1', dashSize: 3, gapSize: 2 })));
          (native.children[native.children.length - 1] as THREE.Line).computeLineDistances();
        }
      }
      if (showZones) (debug?.penetrationZones ?? []).forEach((zone) => {
        if (zone.radius <= 0 || zone.length <= 0) return;
        const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(zone.radius, zone.radius, zone.length, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#cba152', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
        const direction = new THREE.Vector3().fromArray(zone.axis).normalize();
        cylinder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        cylinder.position.fromArray(zone.origin).addScaledVector(direction, zone.length / 2);
        native.add(cylinder);
      });
      const center = bounds.getCenter(new THREE.Vector3());
      const camera = new THREE.PerspectiveCamera(38, 1, Math.max(extent / 1000, 0.01), extent * 100);
      camera.position.copy(center).add(new THREE.Vector3(extent, extent * 0.8, extent * 1.2));
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(center);
      controls.enableDamping = true;
      controls.minDistance = extent * 0.12;
      controls.maxDistance = extent * 10;
      controls.update();
      scene.add(new THREE.HemisphereLight('#ffffff', '#737f6c', 2.6));
      const light = new THREE.DirectionalLight('#fff9ee', 3.1);
      light.position.set(extent, extent * 2, extent);
      scene.add(light);
      observer = new ResizeObserver(() => {
        if (!renderer || stopped) return;
        const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
        renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
      });
      observer.observe(container);
      const animate = () => { if (!renderer || stopped) return; controls?.update(); renderer.render(scene, camera); frame = requestAnimationFrame(animate); };
      animate();
    } catch (reason) { release(); setError(reason instanceof Error ? reason.message : '无法显示三维装配结果。'); }
    return release;
  }, [placements, assets, debug, showConnections, showProxies, showPath, showZones, revision]);

  return <div className="assembly-native-stage"><div ref={host} className="assembly-native-canvas" />{error && <div className="assembly-viewer-error" role="status"><strong>装配三维视图暂不可用</strong><p>{error}</p><p>变换、检查结果和失败原因仍可在下方查看。</p></div>}<span className="assembly-stage-hint">真实源网格 · LDraw LDU 坐标 · 拖动旋转</span><button className="part-reset-view" onClick={() => setRevision((value) => value + 1)}><RotateCcw size={13} />重置视角</button></div>;
}
