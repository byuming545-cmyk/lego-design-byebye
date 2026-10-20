import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ModelRenderingAdapter, ModelRenderOptions } from '../components/ModelViewer.js';
import type { PartCategory, PlacedPart } from '../types/index.js';
import { getSpeedPartDefinition } from './catalog.js';
import { rotatePhysical, transformPointLdu } from './geometry.js';
import type { SpeedBox, SpeedBuildStep, SpeedPartDefinition, SpeedPlacedPart, SpeedVector } from './types.js';

const PLATE_HEIGHT = 0.4;
const UP = new THREE.Vector3(0, 1, 0);
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, 1), z: UP };

export interface SpeedViewerPart extends PlacedPart { speedPart: SpeedPlacedPart }
export interface SpeedIsometricOptions extends ModelRenderOptions {
  showGrid?: boolean;
  background?: string;
  cameraHint?: SpeedBuildStep['cameraHint'];
}

/** Keep V0.1's public viewer data compatible; the adapter reads the original payload. */
export function toSpeedViewerParts(parts: readonly SpeedPlacedPart[]): SpeedViewerPart[] {
  return parts.map(part => ({
    instanceId: part.instanceId,
    partId: part.partId,
    name: part.name,
    category: (['Brick', 'Plate', 'Tile', 'Slope'].includes(part.category) ? part.category : 'Unsupported') as PartCategory,
    color: part.color,
    dimensions: part.dimensions,
    position: part.position,
    rotation: part.orientation.z,
    connections: part.activeConnections,
    buildStep: part.buildStep,
    speedPart: part,
  }));
}

function unwrap(parts: readonly PlacedPart[]): SpeedPlacedPart[] {
  return parts.flatMap(part => {
    const speedPart = (part as Partial<SpeedViewerPart>).speedPart;
    return speedPart ? [speedPart] : [];
  });
}

const threePoint = (point: SpeedVector) => new THREE.Vector3(point.x, point.z * PLATE_HEIGHT, point.y);
const threeLdu = (point: SpeedVector) => new THREE.Vector3(point.x / 20, point.z / 20, point.y / 20);

/** Exactly the same metric-aware X → Y → Z transform as the connection graph. */
export function speedPartMatrix(part: SpeedPlacedPart, exploded = false): THREE.Matrix4 {
  const x = threeLdu(rotatePhysical({ x: 20, y: 0, z: 0 }, part.orientation));
  const y = threeLdu(rotatePhysical({ x: 0, y: 0, z: 20 }, part.orientation));
  const z = threeLdu(rotatePhysical({ x: 0, y: 20, z: 0 }, part.orientation));
  const origin = threeLdu(transformPointLdu(part, { x: 0, y: 0, z: 0 }));
  if (exploded) origin.y += Math.max(0, part.buildStep - 1) * 0.7 * PLATE_HEIGHT;
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
}

function annularGeometry(inner: number, outer: number, width: number, rounded = false): THREE.LatheGeometry {
  const rim = rounded ? Math.min(0.07, (outer - inner) * 0.22, width * 0.15) : 0;
  const half = width / 2;
  const points = [
    new THREE.Vector2(inner, -half),
    new THREE.Vector2(outer - rim, -half),
    new THREE.Vector2(outer, -half + rim),
    new THREE.Vector2(outer, half - rim),
    new THREE.Vector2(outer - rim, half),
    new THREE.Vector2(inner, half),
    new THREE.Vector2(inner, -half),
  ];
  return new THREE.LatheGeometry(points, 48);
}

function slopeGeometry(definition: SpeedPartDefinition): THREE.ExtrudeGeometry {
  const { x: width, y: depth, z: plates } = definition.dimensions!;
  const height = plates * PLATE_HEIGHT - 0.018;
  const profile = new THREE.Shape();
  profile.moveTo(0.015, 0);
  if (definition.shape!.kind === 'curved') {
    // The rear underside is raised one plate on these verified curved slopes.
    profile.lineTo(depth - 1, 0);
    profile.lineTo(depth - 1, PLATE_HEIGHT);
    profile.lineTo(depth - 0.015, PLATE_HEIGHT);
    profile.lineTo(depth - 0.015, height);
    profile.quadraticCurveTo(depth * 0.36, height, 0.015, Math.min(0.18, height * 0.25));
  } else {
    profile.lineTo(depth - 0.015, 0);
    profile.lineTo(depth - 0.015, height);
    const hasRearStuds = definition.connectionPoints.some(point => point.type === 'stud');
    if (hasRearStuds) profile.lineTo(Math.max(0.015, depth - 1), height);
    profile.lineTo(0.015, Math.min(PLATE_HEIGHT - 0.02, height * 0.5));
  }
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, { depth: width - 0.035, bevelEnabled: false, curveSegments: 12 });
  // Shape x is the longitudinal coordinate; extrusion is lateral x.
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(width - 0.0175, 0, 0);
  return geometry;
}

function holderSideGeometry(holeRadius: number, width: number, offset: number): THREE.ExtrudeGeometry {
  const profile = new THREE.Shape();
  profile.moveTo(-1.985, 0);
  profile.lineTo(-0.015, 0);
  profile.lineTo(-0.015, 1.585);
  profile.lineTo(-1.985, 1.585);
  profile.closePath();
  const hole = new THREE.Path();
  hole.absarc(-1, 1.1, holeRadius, 0, Math.PI * 2, false);
  profile.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(profile, { depth: width, bevelEnabled: false, curveSegments: 24 });
  geometry.rotateY(Math.PI / 2);
  geometry.translate(offset, 0, 0);
  return geometry;
}

interface BuildContext {
  geometry: (key: string, make: () => THREE.BufferGeometry) => THREE.BufferGeometry;
  material: (color: string, kind: string, active: boolean, muted: boolean, transparent?: boolean) => THREE.MeshStandardMaterial;
  add: (group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, position?: THREE.Vector3, outline?: boolean) => THREE.Mesh;
}

function addBox(group: THREE.Group, box: SpeedBox, material: THREE.Material, context: BuildContext, outline = false) {
  const width = box.max.x - box.min.x;
  const depth = box.max.y - box.min.y;
  const height = (box.max.z - box.min.z) * PLATE_HEIGHT;
  if (Math.min(width, depth, height) <= 0) return;
  const geometry = context.geometry(`box:${width}:${height}:${depth}`, () => new RoundedBoxGeometry(
    Math.max(0.01, width - 0.035), Math.max(0.01, height - 0.018), Math.max(0.01, depth - 0.035), 2, Math.min(0.025, height / 5),
  ));
  context.add(group, geometry, material, new THREE.Vector3(box.min.x + width / 2, box.min.z * PLATE_HEIGHT + (height - 0.018) / 2, box.min.y + depth / 2), outline);
}

function addRoundPart(group: THREE.Group, definition: SpeedPartDefinition, material: THREE.Material, context: BuildContext, active: boolean) {
  const shape = definition.shape!;
  if (!shape.axis || !shape.radius || !shape.width) return;
  const radius = shape.radius;
  const width = shape.width;
  const round = new THREE.Group();
  round.position.copy(threePoint(shape.center ?? { x: 0, y: 0, z: 0 }));
  round.quaternion.setFromUnitVectors(UP, AXES[shape.axis]);
  if (shape.kind === 'tyre') {
    const inner = shape.innerRadius ?? radius * 0.66;
    const geometry = context.geometry(`tyre:${radius}:${inner}:${width}`, () => {
      // A stepped bore keeps the real 18977 centre narrower than its outer bands.
      const shoulder = Math.min(radius * 0.075, 0.08);
      const half = width / 2;
      return new THREE.LatheGeometry([
        new THREE.Vector2(inner + 0.1, -half),
        new THREE.Vector2(radius - shoulder, -half),
        new THREE.Vector2(radius, -half + shoulder),
        new THREE.Vector2(radius, half - shoulder),
        new THREE.Vector2(radius - shoulder, half),
        new THREE.Vector2(inner + 0.1, half),
        new THREE.Vector2(inner + 0.1, width * 0.15),
        new THREE.Vector2(inner, width * 0.095),
        new THREE.Vector2(inner, -width * 0.095),
        new THREE.Vector2(inner + 0.1, -width * 0.15),
        new THREE.Vector2(inner + 0.1, -half),
      ], 48);
    });
    context.add(round, geometry, material, undefined, active);
    const grooveMaterial = context.material('#121714', 'rubber-groove', false, false);
    const groove = context.geometry(`groove:${radius}`, () => {
      const geometry = new THREE.TorusGeometry(radius - 0.014, 0.009, 5, 64);
      geometry.rotateX(Math.PI / 2);
      return geometry;
    });
    for (const offset of [-0.22, 0, 0.22]) context.add(round, groove, grooveMaterial, new THREE.Vector3(0, offset * width, 0));
  } else if (definition.partId === '3673') {
    context.add(round, context.geometry(`pin:${radius}:${width}`, () => annularGeometry(0.2, radius, width)), material, undefined, active);
    const inverseAxis = round.quaternion.clone().invert();
    for (const profile of shape.cylinders ?? []) {
      const geometry = context.geometry(`pin-profile:${profile.radius}:${profile.width}`, () => annularGeometry(0.2, profile.radius, profile.width));
      const position = threePoint(profile.center).sub(round.position).applyQuaternion(inverseAxis);
      context.add(round, geometry, material, position);
    }
  } else {
    const verifiedHoles = shape.holes?.filter(hole => hole.axis === shape.axis) ?? [];
    const bore = [...verifiedHoles].sort((a, b) => b.width - a.width)[0];
    const hole = bore?.radius ?? (shape.innerRadius || (definition.partId === '4624' ? 0.2 : 0.3));
    const barrel = context.geometry(`wheel-barrel:${radius}:${width}`, () => annularGeometry(Math.max(hole, radius - 0.08), radius, width, true));
    context.add(round, barrel, material, undefined, active);
    const face = context.geometry(`wheel-face:${radius}:${hole}`, () => annularGeometry(hole, radius * 0.87, 0.075, true));
    context.add(round, face, material, new THREE.Vector3(0, Math.min(width * 0.25, width / 2 - 0.08), 0), active);
    if (bore) {
      const boreAxisCenter = bore.center[shape.axis];
      const shapeAxisCenter = (shape.center ?? { x: 0, y: 0, z: 0 })[shape.axis];
      const half = bore.width / 2;
      const counterbore = verifiedHoles.find(candidate => candidate !== bore && candidate.center[shape.axis!] < boreAxisCenter);
      const endRadius = counterbore?.radius ?? hole;
      const endDepth = counterbore?.width ?? 0;
      const hub = context.geometry(`wheel-hub:${definition.partId}:${hole}:${endRadius}:${endDepth}`, () => new THREE.LatheGeometry([
        new THREE.Vector2(endRadius, -half),
        new THREE.Vector2(Math.max(endRadius + 0.06, hole + 0.1), -half),
        new THREE.Vector2(Math.max(endRadius + 0.06, hole + 0.1), half),
        new THREE.Vector2(hole, half),
        new THREE.Vector2(hole, -half + endDepth),
        new THREE.Vector2(endRadius, -half + endDepth),
        new THREE.Vector2(endRadius, -half),
      ], 48));
      context.add(round, hub, material, new THREE.Vector3(0, boreAxisCenter - shapeAxisCenter, 0));
    } else {
      const hub = context.geometry(`wheel-hub:${hole}:${width}`, () => annularGeometry(hole, hole + 0.075, width * 0.7));
      context.add(round, hub, material);
    }
    // Radial ribs make the visible disc readable without pretending to load LDraw meshes.
    const rib = context.geometry(`wheel-rib:${radius}`, () => new THREE.BoxGeometry(radius * 0.55, 0.05, 0.045));
    for (let index = 0; index < 8; index++) {
      const angle = index * Math.PI / 4;
      const mesh = context.add(round, rib, material, new THREE.Vector3(Math.cos(angle) * radius * 0.58, width * 0.25 + 0.05, Math.sin(angle) * radius * 0.58));
      mesh.rotation.y = -angle;
    }
  }
  group.add(round);
}

function buildSpeedGraph(parts: readonly SpeedPlacedPart[], options: ModelRenderOptions = {}, includeEdges = true): THREE.Group {
  const graph = new THREE.Group();
  const highlights = new Set(options.highlightIds ?? []);
  const geometryCache = new Map<string, THREE.BufferGeometry>();
  const materialCache = new Map<string, THREE.MeshStandardMaterial>();
  let lineMaterial: THREE.LineBasicMaterial | undefined;
  let contrastLineMaterial: THREE.LineBasicMaterial | undefined;
  const context: BuildContext = {
    geometry(key, make) {
      if (!geometryCache.has(key)) {
        const geometry = make();
        geometry.userData.edgeReadability = /^(box:|shape:|18975-side:|wheel-barrel:|wheel-face:|tyre:)/.test(key);
        geometryCache.set(key, geometry);
      }
      return geometryCache.get(key)!;
    },
    material(hex, kind, active, muted, transparent = false) {
      const key = `${hex}:${kind}:${active}:${muted}:${transparent}`;
      if (!materialCache.has(key)) {
        const color = new THREE.Color(hex);
        if (muted) color.lerp(new THREE.Color('#cbd6cf'), 0.38);
        const dark = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722 < 0.035;
        const rubber = kind.includes('rubber');
        const material = new THREE.MeshStandardMaterial({
          color,
          roughness: rubber ? 0.86 : dark ? 0.25 : 0.31,
          metalness: 0,
          transparent,
          opacity: transparent ? 0.5 : 1,
          depthWrite: !transparent,
          side: transparent ? THREE.DoubleSide : THREE.FrontSide,
          // A small environment reflection keeps real black plastic readable;
          // the material's base colour and the inventory hex stay untouched.
          emissive: active ? '#2d7256' : dark ? '#63716b' : '#000000',
          emissiveIntensity: active ? 0.11 : dark ? (rubber ? 0.035 : 0.07) : 0,
        });
        material.userData = { darkSurface: dark, rubber };
        materialCache.set(key, material);
      }
      return materialCache.get(key)!;
    },
    add(group, geometry, material, position, outline = false) {
      const mesh = new THREE.Mesh(geometry, material);
      if (position) mesh.position.copy(position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      const contrast = material.userData.darkSurface && geometry.userData.edgeReadability;
      if (includeEdges && (outline || contrast)) {
        if (outline) lineMaterial ??= new THREE.LineBasicMaterial({ color: '#42aa89', transparent: true, opacity: 0.8 });
        else contrastLineMaterial ??= new THREE.LineBasicMaterial({ color: '#78887e', transparent: true, opacity: 0.25, depthWrite: false });
        const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 35), outline ? lineMaterial : contrastLineMaterial);
        lines.position.copy(mesh.position);
        group.add(lines);
      }
      return mesh;
    },
  };
  const skipped: string[] = [];
  for (const part of parts) {
    const definition = getSpeedPartDefinition(part.partId);
    if (definition?.support !== 'supported' || !definition.shape || !definition.dimensions) {
      skipped.push(part.instanceId);
      continue;
    }
    const shape = definition.shape;
    const active = highlights.has(part.instanceId);
    const muted = highlights.size > 0 && !active;
    const material = context.material(part.color.hex, part.category === 'Tyre' ? 'rubber' : 'plastic', active, muted, shape.transparent);
    const group = new THREE.Group();
    group.name = part.instanceId;
    group.userData = { instanceId: part.instanceId, partId: part.partId, highlighted: active, renderIndex: graph.children.length + 1 };
    group.matrix.copy(speedPartMatrix(part, options.exploded));
    group.matrixAutoUpdate = false;

    if (shape.kind === 'wheel' || shape.kind === 'tyre' || part.partId === '3673') {
      addRoundPart(group, definition, material, context, active);
    } else if (part.partId === '18975') {
      // Outer faces have complete counterbores. Inner extended openings are
      // conservatively drawn with their radius-6 LDU inscribed bearing bore.
      const holes = shape.holes?.filter(hole => hole.axis === 'x') ?? [];
      for (const origin of [0, 3]) {
        const start = origin + 0.015, end = origin + 0.985;
        const cuts = new Set([start, end]);
        for (const hole of holes) for (const position of [hole.center.x - hole.width / 2, hole.center.x + hole.width / 2]) if (position > start && position < end) cuts.add(position);
        const segments = [...cuts].sort((a, b) => a - b);
        for (let index = 0; index < segments.length - 1; index++) {
          const offset = segments[index], width = segments[index + 1] - offset;
          const midpoint = offset + width / 2;
          const holeRadius = Math.max(0.3, ...holes.filter(hole => Math.abs(midpoint - hole.center.x) < hole.width / 2).map(hole => hole.radius));
          const side = context.geometry(`18975-side:${holeRadius}:${width}:${offset}`, () => holderSideGeometry(holeRadius, width, offset));
          context.add(group, side, material, undefined, active);
        }
      }
      addBox(group, { min: { x: 1, y: 0, z: 0 }, max: { x: 3, y: 2, z: 1 } }, material, context, active);
    } else if (shape.kind === 'slope' || shape.kind === 'curved') {
      context.add(group, context.geometry(`shape:${part.partId}`, () => slopeGeometry(definition)), material, undefined, active);
    } else {
      for (const box of shape.boxes ?? []) addBox(group, box, material, context, active);
      if (shape.radius && shape.width && shape.axis) addRoundPart(group, definition, material, context, active);
      if (part.partId === '4600') {
        const pin = context.geometry('classic-wheel-pin', () => {
          const geometry = new THREE.CylinderGeometry(0.2, 0.2, 0.6, 16);
          geometry.rotateZ(Math.PI / 2);
          return geometry;
        });
        for (const direction of [-1, 1]) {
          context.add(group, pin, material, new THREE.Vector3(direction === 1 ? 2.4 : -0.4, 0.15, 1), active);
        }
      }
    }

    // Only explicit canonical stud connectors get visible studs, including SNOT.
    for (const point of definition.connectionPoints) {
      if (point.type !== 'stud' && point.type !== 'sideStud') continue;
      const axis = new THREE.Vector3(point.direction.x, point.direction.z, point.direction.y).normalize();
      const stud = context.add(group, context.geometry('stud', () => new THREE.CylinderGeometry(0.296, 0.3, 0.16, 20)), material);
      stud.position.copy(threePoint(point.localPosition)).addScaledVector(axis, 0.08);
      stud.quaternion.setFromUnitVectors(UP, axis);
      const top = context.add(group, context.geometry('stud-top', () => new THREE.CylinderGeometry(0.252, 0.252, 0.008, 20)), material);
      top.position.copy(threePoint(point.localPosition)).addScaledVector(axis, 0.164);
      top.quaternion.copy(stud.quaternion);
    }
    graph.add(group);
  }
  graph.userData.skippedPartIds = skipped;
  return graph;
}

export const speedRenderingAdapter: ModelRenderingAdapter = {
  name: 'speed-canonical',
  build(parts, options) { return buildSpeedGraph(unwrap(parts), options); },
  renderFallback(canvas, parts, options) { renderSpeedIsometric(canvas, unwrap(parts), options); },
};

function disposeGraph(graph: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  graph.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

interface CanvasFace { points: (readonly [number, number, number])[]; depth: number; color: number; alpha: number; highlight: boolean; owner: number; dark: boolean }

function paintFaces(ctx: CanvasRenderingContext2D, faces: CanvasFace[], width: number, height: number) {
  const image = ctx.getImageData(0, 0, width, height);
  const pixels = image.data;
  const depths = new Float32Array(width * height).fill(-Infinity);
  const highlights = new Uint8Array(width * height);
  const owners = new Int32Array(width * height);
  const darkSurfaces = new Uint8Array(width * height);
  for (const face of faces) {
    const [a, b, c] = face.points;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 0.00001) continue;
    const red = (face.color >> 16) & 255, green = (face.color >> 8) & 255, blue = face.color & 255;
    const ax = (b[1] - c[1]) / denominator, ay = (c[0] - b[0]) / denominator;
    const bx = (c[1] - a[1]) / denominator, by = (a[0] - c[0]) / denominator;
    for (let y = minY; y <= maxY; y++) {
      let wa = ax * (minX + 0.5 - c[0]) + ay * (y + 0.5 - c[1]);
      let wb = bx * (minX + 0.5 - c[0]) + by * (y + 0.5 - c[1]);
      for (let x = minX; x <= maxX; x++, wa += ax, wb += bx) {
        const wc = 1 - wa - wb;
        if (wa < -0.00001 || wb < -0.00001 || wc < -0.00001) continue;
        const pixel = y * width + x;
        const depth = wa * a[2] + wb * b[2] + wc * c[2];
        if (depth < depths[pixel] - 0.00001) continue;
        depths[pixel] = depth;
        const offset = pixel * 4;
        const alpha = face.alpha;
        pixels[offset] = red * alpha + pixels[offset] * (1 - alpha);
        pixels[offset + 1] = green * alpha + pixels[offset + 1] * (1 - alpha);
        pixels[offset + 2] = blue * alpha + pixels[offset + 2] * (1 - alpha);
        pixels[offset + 3] = 255;
        highlights[pixel] = Number(face.highlight);
        owners[pixel] = face.owner;
        darkSurfaces[pixel] = Number(face.dark);
      }
    }
  }
  // Outline visible newly added surfaces; hidden pieces never bleed through.
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const pixel = y * width + x;
    if (highlights[pixel] && (!highlights[pixel - 1] || !highlights[pixel + 1] || !highlights[pixel - width] || !highlights[pixel + width])) {
      pixels[pixel * 4] = 65;
      pixels[pixel * 4 + 1] = 170;
      pixels[pixel * 4 + 2] = 137;
    } else if (darkSurfaces[pixel] && (owners[pixel - 1] !== owners[pixel] || owners[pixel + 1] !== owners[pixel] || owners[pixel - width] !== owners[pixel] || owners[pixel + width] !== owners[pixel])) {
      // Subtle visible part boundaries reveal stacked black plates and hubs.
      pixels[pixel * 4] = Math.min(255, pixels[pixel * 4] + 13);
      pixels[pixel * 4 + 1] = Math.min(255, pixels[pixel * 4 + 1] + 16);
      pixels[pixel * 4 + 2] = Math.min(255, pixels[pixel * 4 + 2] + 14);
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** CPU-only projection of the same geometry for PDF and WebGL-unavailable browsers. */
export function renderSpeedIsometric(canvas: HTMLCanvasElement, parts: readonly SpeedPlacedPart[], options: SpeedIsometricOptions = {}): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || !canvas.height) return;
  // Bound per-page PDF buffers, including when the caller supplies a large DPR.
  const maxPixels = 1_500_000;
  if (canvas.width * canvas.height > maxPixels && canvas.ownerDocument) {
    const scratch = canvas.ownerDocument.createElement('canvas');
    const ratio = Math.sqrt(maxPixels / (canvas.width * canvas.height));
    scratch.width = Math.max(1, Math.floor(canvas.width * ratio));
    scratch.height = Math.max(1, Math.floor(canvas.height * ratio));
    renderSpeedIsometric(scratch, parts, options);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);
    return;
  }
  const graph = buildSpeedGraph(parts, options, false);
  try {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = options.background ?? '#e9eee5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    graph.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(graph);
    if (bounds.isEmpty()) {
      ctx.fillStyle = '#6c7c70';
      ctx.font = `${Math.max(12, canvas.width / 45)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(parts.length ? '当前零件尚未提供可验证几何' : '等待车辆模型', canvas.width / 2, canvas.height / 2);
      return;
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const viewpoints = {
      isometric: new THREE.Vector3(20, 17, 24),
      bottom: new THREE.Vector3(20, -17, 24),
      front: new THREE.Vector3(14, 12, -28),
      rear: new THREE.Vector3(14, 12, 28),
      side: new THREE.Vector3(28, 10, 8),
    };
    const view = viewpoints[options.cameraHint ?? 'isometric'].normalize();
    const right = new THREE.Vector3().crossVectors(UP, view).normalize();
    const up = new THREE.Vector3().crossVectors(view, right).normalize();
    const project = (point: THREE.Vector3): [number, number, number] => [point.dot(right), -point.dot(up), point.dot(view)];
    const screenBounds = new THREE.Box2();
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const [px, py] = project(new THREE.Vector3(x, y, z).sub(center));
      screenBounds.expandByPoint(new THREE.Vector2(px, py));
    }
    const extent = screenBounds.getSize(new THREE.Vector2());
    const scale = Math.min(canvas.width / Math.max(extent.x * 1.24, 1), canvas.height / Math.max(extent.y * 1.24, 1));
    const screen = (point: THREE.Vector3) => {
      const [x, y, depth] = project(point.clone().sub(center));
      return [canvas.width / 2 + x * scale, canvas.height / 2 + y * scale, depth] as const;
    };
    const floor = screen(new THREE.Vector3(center.x, bounds.min.y, center.z));
    ctx.fillStyle = '#728b6e16';
    ctx.beginPath();
    ctx.ellipse(floor[0], floor[1] + scale * 0.05, Math.max(extent.x * scale * 0.44, scale), scale * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    if (options.showGrid) {
      const size = bounds.getSize(new THREE.Vector3());
      const radius = Math.ceil(Math.max(size.x, size.z) / 2 + 1);
      ctx.strokeStyle = '#9fb39a40';
      ctx.lineWidth = Math.max(0.5, canvas.width / 1600);
      for (let step = -radius; step <= radius; step++) {
        for (const axis of ['x', 'z'] as const) {
          const a = new THREE.Vector3(center.x - radius, bounds.min.y, center.z + step);
          const b = new THREE.Vector3(center.x + radius, bounds.min.y, center.z + step);
          if (axis === 'z') { a.set(center.x + step, bounds.min.y, center.z - radius); b.set(center.x + step, bounds.min.y, center.z + radius); }
          const p = screen(a), q = screen(b);
          ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        }
      }
    }

    const faces: CanvasFace[] = [];
    const lamp = new THREE.Vector3(-0.4, 0.8, 0.6).normalize();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
    graph.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const positions = object.geometry.getAttribute('position');
      if (!positions) return;
      const indices = object.geometry.index;
      const material = (Array.isArray(object.material) ? object.material[0] : object.material) as THREE.MeshStandardMaterial;
      let parent: THREE.Object3D | null = object;
      while (parent && !parent.userData.instanceId) parent = parent.parent;
      const highlighted = Boolean(parent?.userData.highlighted);
      for (let index = 0; index < (indices?.count ?? positions.count); index += 3) {
        a.fromBufferAttribute(positions, indices ? indices.getX(index) : index).applyMatrix4(object.matrixWorld);
        b.fromBufferAttribute(positions, indices ? indices.getX(index + 1) : index + 1).applyMatrix4(object.matrixWorld);
        c.fromBufferAttribute(positions, indices ? indices.getX(index + 2) : index + 2).applyMatrix4(object.matrixWorld);
        normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
        if (normal.dot(view) <= 0 && material.side !== THREE.DoubleSide) continue;
        const light = 0.55 + Math.max(0, normal.dot(lamp)) * 0.45;
        const color = material.color.clone();
        if (material.userData.darkSurface) color.add(new THREE.Color('#53635b').multiplyScalar(material.userData.rubber ? 0.07 : 0.16));
        color.multiplyScalar(light);
        const p = screen(a), q = screen(b), r = screen(c);
        faces.push({ points: [p, q, r], depth: (p[2] + q[2] + r[2]) / 3, color: color.getHex(), alpha: material.opacity, highlight: highlighted, owner: Number(parent?.userData.renderIndex ?? 0), dark: Boolean(material.userData.darkSurface) });
      }
    });
    faces.sort((a, b) => a.depth - b.depth);
    paintFaces(ctx, faces, canvas.width, canvas.height);
    if (graph.userData.skippedPartIds.length) {
      ctx.fillStyle = '#7d6554';
      ctx.font = `${Math.max(10, canvas.width / 65)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(`${graph.userData.skippedPartIds.length} 个零件尚无已验证几何`, canvas.width * 0.03, canvas.height * 0.96);
    }
  } finally {
    disposeGraph(graph);
  }
}
