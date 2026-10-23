import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Box, RotateCcw } from 'lucide-react';

export type NativeVector = [number, number, number];
export interface NativeMesh {
  positions: NativeVector[];
  indices: number[];
  triangleColors?: number[];
  units?: string;
}
export interface NativeConnectionPoint {
  id?: string;
  position: NativeVector;
  direction?: NativeVector;
  gender?: string | null;
  family?: string;
  type?: string;
  source?: { path?: string; line?: number; raw?: string };
}

/** Displays source triangles directly. It never creates replacement part shapes. */
export default function NativePartViewer({
  mesh,
  points,
  showBounds,
  showConnections,
}: {
  mesh: NativeMesh;
  points: NativeConnectionPoint[];
  showBounds: boolean;
  showConnections: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    let stopped = false;
    const scene = new THREE.Scene();
    const release = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      controls?.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        const child = object as THREE.Mesh;
        if (child.geometry) geometries.add(child.geometry);
        if (Array.isArray(child.material)) child.material.forEach((material) => materials.add(material));
        else if (child.material) materials.add(child.material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer?.dispose();
      renderer?.domElement.remove();
    };
    setError('');
    try {
      if (!mesh.positions.length || !mesh.indices.length) throw new Error('该零件尚无可显示的源网格。');
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-label', 'LDraw 原生零件三维视图，可拖动旋转、滚轮缩放');
      renderer.domElement.setAttribute('role', 'img');
      container.appendChild(renderer.domElement);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions.flat(), 3));
      geometry.setIndex(mesh.indices);
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ color: '#9ab49c', roughness: 0.5, metalness: 0.02, side: THREE.DoubleSide });
      const native = new THREE.Group();
      native.add(new THREE.Mesh(geometry, material));
      // LDraw uses Y down. Apply this display-only rotation to geometry and source connectors together.
      native.rotation.x = Math.PI;
      if (showConnections && points.length) {
        const scale = Math.max(new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute).getSize(new THREE.Vector3()).length() / 70, 0.5);
        const markerGeometry = new THREE.SphereGeometry(scale, 10, 7);
        const markerMaterials = {
          male: new THREE.MeshBasicMaterial({ color: '#2281a6', depthTest: false }),
          female: new THREE.MeshBasicMaterial({ color: '#d18032', depthTest: false }),
          other: new THREE.MeshBasicMaterial({ color: '#9b66b2', depthTest: false }),
        };
        for (const point of points) {
          if (!point.position.every(Number.isFinite)) continue;
          const gender = point.gender === 'male' || point.gender === 'M' ? 'male' : point.gender === 'female' || point.gender === 'F' ? 'female' : 'other';
          const marker = new THREE.Mesh(markerGeometry, markerMaterials[gender]);
          marker.position.fromArray(point.position);
          marker.renderOrder = 10;
          native.add(marker);
          if (point.direction?.every(Number.isFinite)) {
            const direction = new THREE.Vector3().fromArray(point.direction);
            if (direction.lengthSq() > 0) native.add(new THREE.ArrowHelper(direction.normalize(), marker.position, scale * 5, markerMaterials[gender].color, scale * 1.5, scale));
          }
        }
      }
      scene.add(native);
      native.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(native);
      if (showBounds) {
        const body = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute);
        const helper = new THREE.Box3Helper(body, new THREE.Color('#bc883e'));
        native.add(helper);
      }
      const center = bounds.getCenter(new THREE.Vector3());
      const extent = Math.max(bounds.getSize(new THREE.Vector3()).length(), 8);
      const camera = new THREE.PerspectiveCamera(38, 1, Math.max(extent / 1000, 0.01), extent * 100);
      camera.position.copy(center).add(new THREE.Vector3(extent * 1.2, extent * 0.85, extent * 1.2));
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(center);
      controls.enableDamping = true;
      controls.minDistance = extent * 0.15;
      controls.maxDistance = extent * 8;
      controls.update();
      scene.add(new THREE.HemisphereLight('#ffffff', '#7e847d', 2.6));
      const light = new THREE.DirectionalLight('#fff8ed', 3.2);
      light.position.set(extent, extent * 2, extent);
      scene.add(light);
      observer = new ResizeObserver(() => {
        if (!renderer || stopped) return;
        const width = Math.max(container.clientWidth, 1);
        const height = Math.max(container.clientHeight, 1);
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
      observer.observe(container);
      const animate = () => {
        if (stopped || !renderer) return;
        controls?.update();
        renderer.render(scene, camera);
        frame = requestAnimationFrame(animate);
      };
      animate();
    } catch (reason) {
      release();
      setError(reason instanceof Error ? reason.message : '浏览器无法启动三维显示。');
    }
    return release;
  }, [mesh, points, showBounds, showConnections, revision]);

  return <div className="part-native-stage">
    <div className="part-native-canvas" ref={host} />
    {error ? <div className="part-native-error" role="status"><Box size={28} /><strong>三维视图暂不可用</strong><p>{error}</p><p>下方仍可查看来源、尺寸和验证状态。</p></div> : <span className="part-stage-hint">拖动旋转 · 滚轮缩放 · 可查看底部</span>}
    <button type="button" className="part-reset-view" onClick={() => setRevision((value) => value + 1)} aria-label="重置三维视角"><RotateCcw size={14} />重置视角</button>
  </div>;
}
