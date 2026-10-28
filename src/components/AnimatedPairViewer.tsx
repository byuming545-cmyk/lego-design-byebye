import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { NativeConnectionPoint, NativeMesh, NativeVector } from './NativePartViewer.js';

export type PairTool = 'move' | 'rotate';
export type PairView = 'free' | 'front' | 'side' | 'top';
export interface PairTransform { rotation: [number, number, number, number, number, number, number, number, number]; translation: NativeVector }
export interface PairViewerHandle {
  capture(): string | null;
  capturePixels(width: number, height: number): { pixels: Uint8ClampedArray; width: number; height: number } | null;
  setView(view: PairView): void;
  resetView(): void;
}

function matrixFor(transform: PairTransform) {
  const r = transform.rotation, t = transform.translation;
  return new THREE.Matrix4().set(r[0], r[1], r[2], t[0], r[3], r[4], r[5], t[1], r[6], r[7], r[8], t[2], 0, 0, 0, 1);
}
function transformFrom(object: THREE.Object3D): PairTransform {
  const q = object.quaternion;
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
  return {
    rotation: [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]],
    translation: [object.position.x, object.position.y, object.position.z],
  };
}
function applyTransform(object: THREE.Object3D, transform: PairTransform) {
  const m = matrixFor(transform);
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  m.decompose(position, quaternion, scale);
  object.position.copy(position); object.quaternion.copy(quaternion); object.scale.set(1, 1, 1);
}
function meshFor(mesh: NativeMesh, color: number, opacity = 0.94) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions.flat(), 3));
  geometry.setIndex(mesh.indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, metalness: 0.04, roughness: 0.7, side: THREE.DoubleSide, transparent: opacity < 1, opacity }));
}
function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    const item = object as THREE.Mesh;
    if (item.geometry) geometries.add(item.geometry);
    if (Array.isArray(item.material)) item.material.forEach(material => materials.add(material));
    else if (item.material) materials.add(item.material);
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
}
function pointColor(point: NativeConnectionPoint) { return point.gender === 'M' ? 0x1f6f8b : point.gender === 'F' ? 0xc0712f : 0x8c77aa; }

/** Two real source meshes in one workbench. The moving transform is always a rigid source-space transform. */
const AnimatedPairViewer = forwardRef<PairViewerHandle, {
  fixedMesh: NativeMesh;
  movingMesh: NativeMesh;
  fixedPoints: NativeConnectionPoint[];
  movingPoints: NativeConnectionPoint[];
  fixedTransform: PairTransform;
  movingTransform: PairTransform;
  fixedConnectionId?: string | null;
  movingConnectionId?: string | null;
  interactive: boolean;
  tool: PairTool;
  showConnections: boolean;
  snapTransform?: PairTransform | null;
  onTransformChange?: (transform: PairTransform) => void;
  onTransformCommit?: (transform: PairTransform) => void;
  onReady?: () => void;
}>(function AnimatedPairViewer({
  fixedMesh, movingMesh, fixedPoints, movingPoints, fixedTransform, movingTransform,
  fixedConnectionId = null, movingConnectionId = null, interactive, tool, showConnections,
  snapTransform = null, onTransformChange, onTransformCommit, onReady,
}, ref) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const sceneRef = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; root: THREE.Group; fixed: THREE.Group; moving: THREE.Group; ghost: THREE.Group | null; gizmo: TransformControls | null } | null>(null);
  const callbackRef = useRef({ onTransformChange, onTransformCommit });
  callbackRef.current = { onTransformChange, onTransformCommit };

  const fit = (view: PairView = 'free') => {
    const state = sceneRef.current; if (!state) return;
    const box = new THREE.Box3().setFromObject(state.fixed).union(new THREE.Box3().setFromObject(state.moving));
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center, radius = Math.max(20, sphere.radius);
    const directions: Record<PairView, THREE.Vector3> = {
      free: new THREE.Vector3(1, 0.8, 1).normalize(),
      front: new THREE.Vector3(0, 0, 1),
      side: new THREE.Vector3(1, 0, 0),
      top: new THREE.Vector3(0, 1, 0.001).normalize(),
    };
    state.camera.up.set(0, 1, 0); if (view === 'top') state.camera.up.set(0, 0, -1);
    state.camera.position.copy(center).add(directions[view].multiplyScalar(radius * 2.8));
    state.camera.near = Math.max(0.5, radius / 100); state.camera.far = radius * 40; state.camera.updateProjectionMatrix();
    state.controls.target.copy(center); state.controls.update();
  };

  useImperativeHandle(ref, () => ({
    capture() {
      const state = sceneRef.current; if (!state) return null;
      state.renderer.render(state.scene, state.camera);
      return state.renderer.domElement.toDataURL('image/png');
    },
    capturePixels(width, height) {
      const state = sceneRef.current; if (!state) return null;
      state.renderer.render(state.scene, state.camera);
      const target = document.createElement('canvas'); target.width = width; target.height = height;
      const context = target.getContext('2d'); if (!context) return null;
      const source = state.renderer.domElement;
      const scale = Math.min(width / source.width, height / source.height);
      const w = source.width * scale, h = source.height * scale;
      context.fillStyle = '#f4f0e6'; context.fillRect(0, 0, width, height);
      context.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
      return { pixels: context.getImageData(0, 0, width, height).data, width, height };
    },
    setView(view) { fit(view); },
    resetView() { fit('free'); },
  }), []);

  useEffect(() => {
    const container = host.current; if (!container) return;
    let observer: ResizeObserver | undefined; let frame = 0; let stopped = false;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf4f0e6);
    let renderer: THREE.WebGLRenderer | undefined;
    try {
      if (!fixedMesh.positions.length || !movingMesh.positions.length) throw new Error('缺少可显示的真实零件网格。');
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-label', '两件真实零件的三维拼搭工作台，可旋转视角并拖动移动零件');
      renderer.domElement.setAttribute('role', 'img');
      container.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(38, 1, 1, 5000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 12; controls.maxDistance = 900;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x6f756e, 2.1));
      const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(90, 140, 120); scene.add(key);
      const fill = new THREE.DirectionalLight(0xfff0cf, 0.9); fill.position.set(-100, -30, -80); scene.add(fill);
      const root = new THREE.Group(); root.rotation.x = Math.PI; scene.add(root);
      const fixed = new THREE.Group(); applyTransform(fixed, fixedTransform); root.add(fixed); fixed.add(meshFor(fixedMesh, 0x6f9892));
      const moving = new THREE.Group(); applyTransform(moving, movingTransform); root.add(moving); moving.add(meshFor(movingMesh, 0xd39a57));
      const ghost = new THREE.Group(); ghost.visible = false; root.add(ghost);
      const ghostMesh = new THREE.Mesh(meshFor(movingMesh, 0xf2b134, 0.22).geometry, new THREE.MeshBasicMaterial({ color: 0xf2b134, wireframe: true, transparent: true, opacity: 0.38 })); ghost.add(ghostMesh);
      const addMarkers = (group: THREE.Group, points: NativeConnectionPoint[], selected: string | null) => {
        for (const point of points) {
          const focus = point.id === selected;
          const sphere = new THREE.Mesh(new THREE.SphereGeometry(focus ? 2.8 : 1.5, 16, 12), new THREE.MeshBasicMaterial({ color: focus ? 0xf2a900 : pointColor(point), depthTest: false }));
          sphere.position.set(...point.position); sphere.renderOrder = 3; sphere.userData.marker = true; group.add(sphere);
          if (focus && point.direction) {
            const direction = new THREE.Vector3(...point.direction).normalize();
            const arrow = new THREE.ArrowHelper(direction, new THREE.Vector3(...point.position), 14, 0xf2a900, 4.5, 2.2);
            arrow.userData.marker = true; group.add(arrow);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.55, 8, 30), new THREE.MeshBasicMaterial({ color: 0xf2a900, depthTest: false }));
            ring.position.set(...point.position); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction); ring.renderOrder = 4; ring.userData.marker = true; group.add(ring);
          }
        }
      };
      addMarkers(fixed, fixedPoints, fixedConnectionId); addMarkers(moving, movingPoints, movingConnectionId);
      scene.add(new THREE.GridHelper(160, 16, 0xbec7bf, 0xd8dfd7).translateY(-60));
      const gizmo = new TransformControls(camera, renderer.domElement); gizmo.setMode(tool === 'move' ? 'translate' : 'rotate'); gizmo.setSpace('local'); gizmo.setSize(0.85); gizmo.setTranslationSnap(1); gizmo.setRotationSnap(THREE.MathUtils.degToRad(5));
      if (interactive) gizmo.attach(moving);
      scene.add(gizmo.getHelper());
      gizmo.addEventListener('dragging-changed', (event) => { controls.enabled = !(event as unknown as { value: boolean }).value; });
      gizmo.addEventListener('objectChange', () => { callbackRef.current.onTransformChange?.(transformFrom(moving)); });
      gizmo.addEventListener('mouseUp', () => { callbackRef.current.onTransformCommit?.(transformFrom(moving)); });
      sceneRef.current = { renderer, scene, camera, controls, root, fixed, moving, ghost, gizmo };
      root.traverse((object) => { if (object.userData.marker === true) object.visible = showConnections; });
      const resize = () => { const width = container.clientWidth || 640, height = container.clientHeight || 420; renderer!.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
      observer = new ResizeObserver(resize); observer.observe(container); resize(); fit('free');
      const loop = () => { if (stopped) return; controls.update(); renderer!.render(scene, camera); frame = requestAnimationFrame(loop); };
      loop(); onReady?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '三维工作台无法初始化。'); }
    return () => { stopped = true; cancelAnimationFrame(frame); observer?.disconnect(); const state = sceneRef.current; state?.gizmo?.dispose(); state?.controls.dispose(); disposeScene(scene); renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove(); sceneRef.current = null; };
  }, [fixedMesh, movingMesh]);

  useEffect(() => { const state = sceneRef.current; if (!state) return; applyTransform(state.fixed, fixedTransform); }, [fixedTransform]);
  useEffect(() => { const state = sceneRef.current; if (!state) return; applyTransform(state.moving, movingTransform); }, [movingTransform]);
  useEffect(() => { const state = sceneRef.current; if (!state) return; if (state.ghost && snapTransform) { applyTransform(state.ghost, snapTransform); state.ghost.visible = true; } else if (state.ghost) state.ghost.visible = false; }, [snapTransform]);
  useEffect(() => { const state = sceneRef.current; if (!state?.gizmo) return; state.gizmo.setMode(tool === 'move' ? 'translate' : 'rotate'); }, [tool]);
  useEffect(() => { const state = sceneRef.current; if (!state?.gizmo) return; if (interactive) { state.gizmo.attach(state.moving); } else { state.gizmo.detach(); } }, [interactive]);
  useEffect(() => { const state = sceneRef.current; if (!state) return; state.root.traverse((object) => { if (object.userData.marker === true) object.visible = showConnections; }); }, [showConnections]);

  return <div className="pair-viewer" ref={host}>{error ? <p className="pair-viewer-error">{error}</p> : null}</div>;
});

export default AnimatedPairViewer;
