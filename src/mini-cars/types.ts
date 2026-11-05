import type { RigidTransform, Vector3 } from '../parts/assembly/types.js';
import type { LDrawSourceFile } from '../parts/ldraw/types.js';

export const MINI_SCHEMA = 'bricklab-mini-car-appearance-1';
export const MINI_GENERATOR_VERSION = 'mini-car-layout-1';
export const MINI_MAX_PARTS = 128;
export const MINI_COLORS = {
  red: { ldraw: 4, label: '赛车红', hex: '#b52528' },
  blue: { ldraw: 1, label: '竞速蓝', hex: '#2357a7' },
  white: { ldraw: 15, label: '珍珠白', hex: '#e8e9e5' },
  yellow: { ldraw: 14, label: '明黄', hex: '#f0c327' },
  black: { ldraw: 0, label: '黑色', hex: '#171c24' },
  graphite: { ldraw: 72, label: '深灰', hex: '#626a70' },
} as const;
export type MiniColor = keyof typeof MINI_COLORS;
export interface MiniOptions { style: 'sprint' | 'gt'; color: 'red' | 'blue' | 'white' | 'yellow'; seed: string; spoiler: boolean }
export type MiniRole = 'chassis' | 'body' | 'window' | 'roof' | 'wheel' | 'trim' | 'spoiler';
export interface MiniPlacement { instanceId: string; partId: string; role: MiniRole; color: MiniColor; transform: RigidTransform; assemblyStatus: 'NOT_VERIFIED' }
export interface MiniSource { partId: string; name: string; revision: string; rootFile: string; geometryParser: string; meshSha256: string; files: LDrawSourceFile[] }
export interface MiniBomRow { partId: string; name: string; color: MiniColor; ldrawColor: number; quantity: number; colorAvailability: 'NOT_VERIFIED'; assemblyStatus: 'NOT_VERIFIED' }
export interface MiniWheel { id: string; center: Vector3; axis: Vector3; tyreInstanceId: string; rimInstanceId: string; fit: 'UNKNOWN'; chassisMount: 'UNKNOWN' }
export interface MiniModel {
  schema: typeof MINI_SCHEMA; generatorVersion: string; id: string; state: 'APPEARANCE_DRAFT'; units: 'LDU';
  sourceSnapshot: string; options: MiniOptions; placements: MiniPlacement[]; sources: MiniSource[]; bom: MiniBomRow[]; wheels: MiniWheel[];
  layout: { bodyWidthStuds: 6; lengthLdu: number; wheelbaseLdu: number; roofLengthLdu: number; cover: 'rounded' | 'angular' };
  checks: { version: 'mini-appearance-checks-1'; rigidTransforms: true; sourceIntegrity: true; wheelCount: 4; bilateralBounds: true;
    bodyWidthLdu: number; bodyBounds: { min: Vector3; max: Vector3 }; scope: 'layout-and-source-only';
    collision: 'UNKNOWN'; connections: 'NOT_VERIFIED'; wheelFit: 'UNKNOWN'; physicalBuildVerified: false };
  contentSha256: string;
}
