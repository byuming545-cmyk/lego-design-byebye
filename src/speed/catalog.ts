import type { ConnectionPoint, SpeedCategory, SpeedPartDefinition, SpeedShape } from './types.js';

/**
 * Nominal dimensions and part names verified against official LDraw headers in
 * the Pybricks LDraw mirror at this pinned revision. LDraw library: CC BY 4.0.
 * https://github.com/pybricks/ldraw/tree/c43ed06a128a10ed65675166bf42eb6fd608b9b0
 * x/y are studs; z is plates. Body dimensions exclude the projecting studs.
 * Phase 1 does not infer complex geometry from a name or upstream category.
 */
export const SPEED_LDRAW_REVISION = 'c43ed06a128a10ed65675166bf42eb6fd608b9b0';
const SOURCE_ROOT = `https://raw.githubusercontent.com/pybricks/ldraw/${SPEED_LDRAW_REVISION}/parts/`;

function standardGrid(x: number, y: number, z: number, hasTopStuds: boolean): ConnectionPoint[] {
  const points: ConnectionPoint[] = [];
  for (let row = 0; row < y; row++) for (let column = 0; column < x; column++) {
    if (hasTopStuds) points.push({
      id: `stud:${column}:${row}`, type: 'stud',
      localPosition: { x: column + 0.5, y: row + 0.5, z },
      direction: { x: 0, y: 0, z: 1 }, compatibleTypes: ['antiStud', 'sideAntiStud'],
    });
    points.push({
      id: `antiStud:${column}:${row}`, type: 'antiStud',
      localPosition: { x: column + 0.5, y: row + 0.5, z: 0 },
      direction: { x: 0, y: 0, z: -1 }, compatibleTypes: ['stud', 'sideStud'],
    });
  }
  return points;
}

/** Collision boxes are conservative; never infer top studs from the footprint. */
function shapedSlope(partId: string, name: string, x: number, y: number, z: number, kind: 'slope' | 'curved', raisedRear: boolean, hasRearStuds: boolean): SpeedPartDefinition {
  const definition = box(partId, name, 'Tile', x, y, z);
  definition.category = kind === 'curved' ? 'CurvedSlope' : 'Slope';
  definition.shape!.kind = kind;
  definition.connectionPoints = standardGrid(x, y, z, false);
  if (raisedRear) {
    for (const point of definition.connectionPoints) if (point.localPosition.y === y - 0.5) point.localPosition.z = 1;
    definition.shape!.boxes = [
      { min: { x: 0, y: 0, z: 0 }, max: { x, y: y - 1, z } },
      { min: { x: 0, y: y - 1, z: 1 }, max: { x, y, z } },
    ];
  }
  if (hasRearStuds) for (let column = 0; column < x; column++) {
    definition.connectionPoints.push({
      id: `stud:${column}:${y - 1}`, type: 'stud', localPosition: { x: column + 0.5, y: y - 0.5, z },
      direction: { x: 0, y: 0, z: 1 }, compatibleTypes: ['antiStud', 'sideAntiStud'],
    });
  }
  definition.notes = [
    '尺寸及凸点 / 反凸点位置来自固定版本 LDraw 几何；曲面与斜面碰撞采用保守外包络，可能拒绝狭小但实际可行的间隙。',
    raisedRear ? '后排底面及反凸点较前排高 1 plate；无顶面凸点，采用分段外包络保留真实底部台阶。' : hasRearStuds ? '仅后排平顶有凸点，前方斜面没有凸点。' : '平底反凸点可连接；斜面无顶面凸点。',
  ];
  return definition;
}

/** The side interface lies 14 LDU above the bottom, not at half-brick height. */
function sideStudBrick(partId: string, name: string, x: number): SpeedPartDefinition {
  const definition = box(partId, name, 'Brick', x, 1, 3);
  definition.category = 'ModifiedBrick';
  for (let column = 0; column < x; column++) definition.connectionPoints.push({
    id: `sideStud:${column}`, type: 'sideStud', localPosition: { x: column + 0.5, y: 0, z: 1.75 },
    direction: { x: 0, y: -1, z: 0 }, compatibleTypes: ['antiStud', 'sideAntiStud'],
  });
  definition.notes = ['LDraw stud2a 侧向接口基点位于主体底面上方 14 LDU，即 1.75 plate；按实际方向连接旋转后的反凸点，不按空间接触判定连接。'];
  return definition;
}

/** The family is justified by LDraw peghole/connect/connhol2 interfaces. */
export const MODERN_SPEED_AXLE_FAMILY = 'technic-pin6';
export const MODERN_SPEED_TYRE_FAMILY = 'speed-66727-18977';

function mechanical(partId: string, name: string, category: SpeedCategory, dimensions: { x: number; y: number; z: number }, shape: SpeedShape, connectionPoints: ConnectionPoint[], notes: string[]): SpeedPartDefinition {
  return {
    partId, name, category, support: 'supported', dimensions, shape, connectionPoints,
    notes: [...notes, 'LDraw 标准接口及尺寸的保守几何模型；尚未做实物承重、制造公差或带载旋转试验。'],
    ldrawFile: `parts/${partId}.dat`, sourceUrl: `${SOURCE_ROOT}${partId}.dat`,
  };
}

function modernHolder(): SpeedPartDefinition {
  const points = standardGrid(4, 2, 4, true);
  for (const point of points) if (point.type === 'stud' && point.localPosition.x > 1 && point.localPosition.x < 3) point.localPosition.z = 1;
  for (const x of [0.5, 3.5]) points.push({
    id: `wheelSocket:${x < 2 ? 'left' : 'right'}`, type: 'wheelSocket',
    localPosition: { x, y: 1, z: 2.75 }, direction: { x: x < 2 ? -1 : 1, y: 0, z: 0 },
    compatibleTypes: ['wheelPin'], fitFamily: MODERN_SPEED_AXLE_FAMILY, allowsRotation: true,
  });
  return mechanical('18975', 'Plate 2 x 4 with Side Bricks 1 x 2 x 1.333 with Hole', 'WheelHolder', { x: 4, y: 2, z: 4 }, {
    kind: 'holder', wheelSystem: 'speed-modern', boxes: [
      { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 2, z: 1 } },
      { min: { x: 0, y: 0, z: 1 }, max: { x: 1, y: 2, z: 4 } },
      { min: { x: 3, y: 0, z: 1 }, max: { x: 4, y: 2, z: 4 } },
    ],
    holes: [
      { axis: 'x', center: { x: 0.5, y: 1, z: 2.75 }, radius: 0.3, width: 1 },
      { axis: 'x', center: { x: 3.5, y: 1, z: 2.75 }, radius: 0.3, width: 1 },
      { axis: 'x', center: { x: 0.05, y: 1, z: 2.75 }, radius: 0.4, width: 0.1 },
      { axis: 'x', center: { x: 3.95, y: 1, z: 2.75 }, radius: 0.4, width: 0.1 },
    ],
  }, points, [
    '中央 Plate 顶面高 1 plate，左右支柱顶面高 4 plates；左右 Technic 孔中心距底面 22 LDU，即 2.75 plates。',
    '支柱采用保守外包络并显式扣除圆孔与外端 counterbore；内端半圆扩孔未扩大为虚构的整圆孔，不能忽略整个支柱碰撞。',
    '该零件只有母孔，必须另用 Technic Pin 3673，不包含虚构的一体轮轴。',
  ]);
}

function modernPin(): SpeedPartDefinition {
  return mechanical('3673', 'Technic Pin', 'Other', { x: 2, y: 0.8, z: 2 }, {
    kind: 'round', axis: 'x', radius: 0.3, width: 2, center: { x: 0, y: 0, z: 0 }, wheelSystem: 'speed-modern',
    cylinders: [
      { axis: 'x', center: { x: 0, y: 0, z: 0 }, radius: 0.4, width: 0.2 },
      { axis: 'x', center: { x: -0.95, y: 0, z: 0 }, radius: 0.325, width: 0.1 },
      { axis: 'x', center: { x: 0.95, y: 0, z: 0 }, radius: 0.325, width: 0.1 },
    ],
  }, [-1, 1].map(sign => ({
    id: `wheelPin:${sign < 0 ? 'left' : 'right'}`, type: 'wheelPin' as const,
    localPosition: { x: sign * 0.5, y: 0, z: 0 }, direction: { x: sign, y: 0, z: 0 },
    compatibleTypes: ['wheelSocket'], fitFamily: MODERN_SPEED_AXLE_FAMILY, allowsRotation: true,
  })), [
    '原点在中央 collar，轴向为 x；连接参考点在两半轴段中心 x=±0.5 stud，不能将 Pin 当作独立轮架。',
    '主体轴半径 6 LDU，中央 collar 半径 8 LDU、全宽 4 LDU，端部保留唇半径 6.5 LDU；各轴段使用独立同轴圆柱包络，未虚构方形 collar。',
  ]);
}

function modernRim(): SpeedPartDefinition {
  return mechanical('66727', 'Wheel Rim 11 x 18 with Drilled Disc Brake', 'Wheel', { x: 1.5, y: 2.2, z: 5.5 }, {
    kind: 'wheel', axis: 'x', radius: 1.1, innerRadius: 0, width: 1.5, center: { x: 0.25, y: 0, z: 0 }, wheelSystem: 'speed-modern',
    holes: [
      { axis: 'x', center: { x: 0, y: 0, z: 0 }, radius: 0.3, width: 1 },
      { axis: 'x', center: { x: -0.45, y: 0, z: 0 }, radius: 0.4, width: 0.1 },
    ],
  }, [
    { id: 'wheelSocket', type: 'wheelSocket', localPosition: { x: 0, y: 0, z: 0 }, direction: { x: -1, y: 0, z: 0 }, compatibleTypes: ['wheelPin'], fitFamily: MODERN_SPEED_AXLE_FAMILY, allowsRotation: true },
    { id: 'rim', type: 'rim', localPosition: { x: 0.3, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, compatibleTypes: ['tyre'], fitFamily: MODERN_SPEED_TYRE_FAMILY },
  ], [
    '原点在轮轴孔参考位置；轴向外包络 x=-0.5..1 stud。使用 connhol2 标准 Technic 圆孔，不兼容 4600 的较细 wheel pin。',
    '66727c01 将此轮毂与 18977 轮胎组合；轮胎中心沿规范 x 轴相对轮毂原点偏移 +0.3 stud。',
  ]);
}

function modernTyre(): SpeedPartDefinition {
  return mechanical('18977', 'Tyre 11.2/28 x 17.6 Intermediate', 'Tyre', { x: 1.4, y: 3, z: 7.5 }, {
    kind: 'tyre', axis: 'x', radius: 1.5, innerRadius: 1, width: 1.4, center: { x: 0, y: 0, z: 0 }, wheelSystem: 'speed-modern',
  }, [{ id: 'tyre', type: 'tyre', localPosition: { x: 0, y: 0, z: 0 }, direction: { x: -1, y: 0, z: 0 }, compatibleTypes: ['rim'], fitFamily: MODERN_SPEED_TYRE_FAMILY }], [
    '外半径 30 LDU、轴宽 28 LDU；中心段内孔半径 20 LDU，外段为 22 LDU，不会人为扩大内孔来隐藏碰撞。',
    '圆环为保守包络，真实 66727 配合面存在分段形状；只有对齐的已验证 tyre-fit 接口可作为预期配合处理。',
  ]);
}

function box(partId: string, name: string, category: 'Brick' | 'Plate' | 'Tile', x: number, y: number, z: number): SpeedPartDefinition {
  return {
    partId, name, category, support: 'supported', dimensions: { x, y, z },
    shape: { kind: 'box', boxes: [{ min: { x: 0, y: 0, z: 0 }, max: { x, y, z } }] },
    connectionPoints: standardGrid(x, y, z, category !== 'Tile'),
    notes: ['已建模标准垂直凸点连接及标称主体外包络；不模拟内壁、商标、弹性及夹持连接。'],
    ldrawFile: `parts/${partId}.dat`, sourceUrl: `${SOURCE_ROOT}${partId}.dat`,
  };
}

function partial(partId: string, name: string, category: SpeedCategory): SpeedPartDefinition {
  const notes = ['已通过 LDraw 编号识别；复杂几何与精确连接尚未实现，不计入当前可生成库存。'];
  if (['Bracket', 'ModifiedBrick', 'ModifiedPlate', 'Jumper'].includes(category)) notes.push('偏移或侧向连接待校准，不能按普通整格凸点连接处理。');
  if (['Wheel', 'Tyre', 'WheelHolder'].includes(category)) notes.push('轮组装配与旋转空间尚未验证，不会仅凭类别推断兼容性。');
  if (partId === '18976') notes.push('LDraw 18976c01 核实其与 18977 组成轮胎总成；中心为 axl3hole，与 66727 的圆孔接口不同。');
  if (partId === '66727') notes.push('LDraw 66727c01 核实其与 18977 组成轮胎总成；中心采用 roundconnhol2，轮架匹配待验证。');
  if (partId === '18977') notes.push('LDraw 几何核实外半径 30 LDU、轴向宽 28 LDU；此处保留待验证状态。');
  if (['4600', '4624', '3641'].includes(partId)) notes.push('LDraw 官方 car.ldr 与 4624c01 核实 4600 / 4624 / 3641 装配关系；精确连接实现仍待后续阶段。');
  if (partId === '15573') notes.push('此变体无中心 underside stud，不能复用 3794b 的底部连接假设。');
  return {
    partId, name, category, support: 'partiallySupported', dimensions: null, shape: null,
    connectionPoints: [], notes, ldrawFile: `parts/${partId}.dat`, sourceUrl: `${SOURCE_ROOT}${partId}.dat`,
  };
}

const DEFINITIONS: SpeedPartDefinition[] = [
  box('3001', "Brick  2 x  4", 'Brick', 2, 4, 3),
  box('3002', "Brick  2 x  3", 'Brick', 2, 3, 3),
  box('3003', "Brick  2 x  2", 'Brick', 2, 2, 3),
  box('3004', "Brick  1 x  2", 'Brick', 1, 2, 3),
  box('3005', "Brick  1 x  1", 'Brick', 1, 1, 3),
  box('3006', "Brick  2 x 10", 'Brick', 2, 10, 3),
  box('3007', "Brick  2 x  8", 'Brick', 2, 8, 3),
  box('3008', "Brick  1 x  8", 'Brick', 1, 8, 3),
  box('3009', "Brick  1 x  6", 'Brick', 1, 6, 3),
  box('3010', "Brick  1 x  4", 'Brick', 1, 4, 3),
  box('3622', "Brick  1 x  3", 'Brick', 1, 3, 3),
  box('2456', "Brick  2 x  6", 'Brick', 2, 6, 3),
  box('6111', "Brick  1 x 10", 'Brick', 1, 10, 3),
  box('3020', "Plate  2 x  4", 'Plate', 2, 4, 1),
  box('3021', "Plate  2 x  3", 'Plate', 2, 3, 1),
  box('3022', "Plate  2 x  2", 'Plate', 2, 2, 1),
  box('3023', "Plate 1 x 2 (legacy alias of 3023b)", 'Plate', 1, 2, 1),
  box('3024', "Plate  1 x  1", 'Plate', 1, 1, 1),
  box('3026', "Plate  6 x 24", 'Plate', 6, 24, 1),
  box('3027', "Plate  6 x 16", 'Plate', 6, 16, 1),
  box('3028', "Plate  6 x 12", 'Plate', 6, 12, 1),
  box('3029', "Plate  4 x 12", 'Plate', 4, 12, 1),
  box('3030', "Plate  4 x 10", 'Plate', 4, 10, 1),
  box('3031', "Plate  4 x  4", 'Plate', 4, 4, 1),
  box('3032', "Plate  4 x  6", 'Plate', 4, 6, 1),
  box('3033', "Plate  6 x 10", 'Plate', 6, 10, 1),
  box('3034', "Plate  2 x  8", 'Plate', 2, 8, 1),
  box('3035', "Plate  4 x  8", 'Plate', 4, 8, 1),
  box('3036', "Plate  6 x  8", 'Plate', 6, 8, 1),
  box('3460', "Plate  1 x  8", 'Plate', 1, 8, 1),
  box('3666', "Plate  1 x  6", 'Plate', 1, 6, 1),
  box('3710', "Plate  1 x  4", 'Plate', 1, 4, 1),
  box('3795', "Plate  2 x  6", 'Plate', 2, 6, 1),
  box('3832', "Plate  2 x 10", 'Plate', 2, 10, 1),
  box('3958', "Plate  6 x  6", 'Plate', 6, 6, 1),
  box('4282', "Plate  2 x 16", 'Plate', 2, 16, 1),
  box('4477', "Plate  1 x 10", 'Plate', 1, 10, 1),
  box('3023b', "Plate  1 x  2", 'Plate', 1, 2, 1),
  box('2445', "Plate  2 x 12", 'Plate', 2, 12, 1),
  box('91988', "Plate  2 x 14", 'Plate', 2, 14, 1),
  box('11212', "Plate  3 x  3", 'Plate', 3, 3, 1),
  box('3068b', "Tile  2 x  2 with Groove", 'Tile', 2, 2, 1),
  box('3069b', "Tile  1 x  2 with Groove", 'Tile', 1, 2, 1),
  box('3070b', "Tile  1 x  1 with Groove", 'Tile', 1, 1, 1),
  box('2431', "Tile  1 x  4 with Groove", 'Tile', 1, 4, 1),
  box('6636', "Tile  1 x  6", 'Tile', 1, 6, 1),
  box('4162', "Tile  1 x  8", 'Tile', 1, 8, 1),
  box('87079', "Tile  2 x  4 with Groove", 'Tile', 2, 4, 1),
  box('63864', "Tile  1 x  3", 'Tile', 1, 3, 1),
  box('26603', "Tile  2 x  3", 'Tile', 2, 3, 1),

  partial('3794b', "Plate  1 x  2 with Groove with 1 Centre Stud", 'Jumper'),
  partial('15573', "Plate  1 x  2 with Groove with 1 Centre Stud, without Understud", 'Jumper'),
  partial('87580', "Plate  2 x  2 with Groove with 1 Centre Stud", 'Jumper'),
  shapedSlope('3040b', 'Slope Brick 45 2 x 1', 1, 2, 3, 'slope', false, true),
  shapedSlope('3039', 'Slope Brick 45 2 x 2', 2, 2, 3, 'slope', false, true),
  partial('3041', "Slope Brick 45  2 x  4 Double", 'Slope'),
  partial('3038', "Slope Brick 45  2 x  3", 'Slope'),
  shapedSlope('11477', 'Slope Brick Curved 2 x 1', 1, 2, 2, 'curved', true, false),
  shapedSlope('15068', 'Slope Brick Curved 2 x 2 x 0.667', 2, 2, 2, 'curved', true, false),
  shapedSlope('50950', 'Slope Brick Curved 3 x 1', 1, 3, 3, 'curved', true, false),
  shapedSlope('54200', 'Slope Brick 31 1 x 1 x 0.667', 1, 1, 2, 'slope', false, false),
  partial('29119', "Slope Brick Curved  2 x  1 with Cutout Right", 'CurvedSlope'),
  partial('29120', "Slope Brick Curved  2 x  1 with Cutout Left", 'CurvedSlope'),
  partial('43722', "Wing  2 x  3 Right", 'Wing'),
  partial('43723', "Wing  2 x  3 Left", 'Wing'),
  partial('41769', "Wing  2 x  4 Right", 'Wing'),
  partial('41770', "Wing  2 x  4 Left", 'Wing'),
  partial('24299', "Wing  2 x  2 Left", 'Wing'),
  partial('24307', "Wing  2 x  2 Right", 'Wing'),
  partial('99780', "Bracket  1 x  2 -  1 x  2 Up", 'Bracket'),
  partial('99781', "Bracket  1 x  2 -  1 x  2 Down", 'Bracket'),
  partial('99207', "Bracket  1 x  2 -  2 x  2 Up", 'Bracket'),
  partial('4070', "Brick  1 x  1 with Headlight", 'ModifiedBrick'),
  sideStudBrick('87087', 'Brick 1 x 1 with Stud on 1 Side', 1),
  sideStudBrick('11211', 'Brick 1 x 2 with Two Studs on One Side', 2),
  partial('52107', "Brick  1 x  2 with Studs on Sides", 'ModifiedBrick'),
  partial('47905', "Brick  1 x  1 with Studs on Two Opposite Sides", 'ModifiedBrick'),
  partial('99206', "Plate  2 x  2 x  0.667 with Two Studs On Side and Two Raised with Closed Understud", 'ModifiedPlate'),
  partial('65635', "Plate  2 x  6 with Side Bricks  1 x  2 x  1.333 with Axlehole", 'ModifiedPlate'),
  partial('98282', "Car Mudguard  4 x  2.5 x  1", 'Mudguard'),
  partial('18974', "Car Mudguard  4 x  2.5 x  2.333", 'Mudguard'),
  partial('35789', "Car Mudguard  4 x  2.5 x  2 with Rounded Ends", 'Mudguard'),
  partial('65633', "Windscreen  6 x  6 x  1.333 Angled Curved", 'Windscreen'),
  partial('65632', "Windscreen  6 x  6 x  1.667 Curved", 'Windscreen'),
  partial('18973', "Windscreen  6 x  4 x  1.333 Curved", 'Windscreen'),
  partial('62360', "Windscreen  3 x  6 x  1 Curved", 'Windscreen'),
  partial('2412b', "Tile  1 x  2 Grille with Groove", 'Grille'),
  partial('98138', "Tile  1 x  1 Round with Groove", 'RoundTile'),
  partial('14769', "Tile  2 x  2 Round with Round Underside Stud", 'RoundTile'),
  partial('4079', "Minifig Seat  2 x  2", 'Seat'),
  partial('18976', "Wheel Rim 11 x 18 with Vented Disc Brake", 'Wheel'),
  modernRim(),
  partial('4624', 'Wheel Rim 6.4 x 8', 'Wheel'),
  modernTyre(),
  partial('3641', 'Tyre 6/50 x 8 Offset Tread', 'Tyre'),
  partial('4600', "Plate  2 x  2 with 2 Wheel Pins", 'WheelHolder'),
  modernHolder(),
  modernPin(),
  partial('87552', "Panel  1 x  2 x  2 Reinforced", 'Panel'),
  shapedSlope('85984', 'Slope Brick 31 1 x 2 x 0.667', 2, 1, 2, 'slope', false, false),
];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The immutable catalog is independent from V0.1 classification. */
export const SPEED_PART_CATALOG: Readonly<Record<string, SpeedPartDefinition>> = Object.freeze(
  Object.fromEntries(DEFINITIONS.map(definition => [definition.partId, deepFreeze(definition)])),
);

export function getSpeedPartDefinition(partId: string): SpeedPartDefinition | undefined {
  return Object.hasOwn(SPEED_PART_CATALOG, partId) ? SPEED_PART_CATALOG[partId] : undefined;
}

export const SPEED_CATALOG_STATS = Object.freeze({
  total: DEFINITIONS.length,
  supported: DEFINITIONS.filter(part => part.support === 'supported').length,
  partiallySupported: DEFINITIONS.filter(part => part.support === 'partiallySupported').length,
  unsupported: DEFINITIONS.filter(part => part.support === 'unsupported').length,
  categories: Object.freeze(DEFINITIONS.reduce<Record<string, number>>((counts, part) => {
    counts[part.category] = (counts[part.category] ?? 0) + 1;
    return counts;
  }, {})),
});
