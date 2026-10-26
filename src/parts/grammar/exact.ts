/** Exact decimal/rational LEGO coordinates. This module never snaps a near
 * number onto a stud grid and never turns a mathematical equality into a
 * source, collision, stressing or physical-build certificate. */
export const LEGO_LDU = Object.freeze({ studPitch: 20, halfStud: 10, plateHeight: 8, brickHeight: 24, studDiameter: 12, studHeight: 4 });

export interface ExactLdu { readonly numerator: bigint; readonly denominator: bigint }
export type LduValue = ExactLdu | number | string;
export type LduVectorInput = readonly [LduValue, LduValue, LduValue];
type ExactVector = [ExactLdu, ExactLdu, ExactLdu];

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b) { const next = a % b; a = b; b = next; }
  return a || 1n;
}
function fraction(numerator: bigint, denominator: bigint): ExactLdu {
  if (denominator === 0n) throw new Error('A rational LDU denominator cannot be zero.');
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const divisor = gcd(numerator, denominator);
  return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

/** Numbers are interpreted as their written decimal value, including all
 * digits of a computed approximation. 39.99999999999999 therefore is not 40. */
export function exactLdu(input: LduValue): ExactLdu {
  if (typeof input === 'object') {
    if (!input || typeof input.numerator !== 'bigint' || typeof input.denominator !== 'bigint') throw new Error('Invalid rational LDU.');
    return fraction(input.numerator, input.denominator);
  }
  if (typeof input === 'number' && (!Number.isFinite(input) || Math.abs(input) > Number.MAX_SAFE_INTEGER)) throw new Error('LDU numbers must be finite and within the safe integer magnitude.');
  const text = String(input).trim();
  if (text.length > 256) throw new Error('LDU precision exceeds the bounded exact-coordinate format.');
  const rational = /^([+-]?\d+)\/([+-]?\d+)$/.exec(text);
  if (rational) return fraction(BigInt(rational[1]), BigInt(rational[2]));
  const decimal = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!decimal) throw new Error('An LDU value must be an explicit decimal or rational.');
  const exponent = Number(decimal[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 128) throw new Error('LDU exponent exceeds the exact-coordinate budget.');
  const decimals = decimal[3] ?? '', power = exponent - decimals.length;
  const numerator = BigInt((decimal[1] === '-' ? '-' : '') + decimal[2] + decimals);
  return power >= 0 ? fraction(numerator * 10n ** BigInt(power), 1n) : fraction(numerator, 10n ** BigInt(-power));
}

export function addLdu(a: LduValue, b: LduValue): ExactLdu {
  const x = exactLdu(a), y = exactLdu(b);
  return fraction(x.numerator * y.denominator + y.numerator * x.denominator, x.denominator * y.denominator);
}
export function subtractLdu(a: LduValue, b: LduValue): ExactLdu {
  const x = exactLdu(a), y = exactLdu(b);
  return fraction(x.numerator * y.denominator - y.numerator * x.denominator, x.denominator * y.denominator);
}
export function multiplyLdu(a: LduValue, b: LduValue): ExactLdu {
  const x = exactLdu(a), y = exactLdu(b);
  return fraction(x.numerator * y.numerator, x.denominator * y.denominator);
}
export function equalLdu(a: LduValue, b: LduValue): boolean {
  const x = exactLdu(a), y = exactLdu(b);
  return x.numerator === y.numerator && x.denominator === y.denominator;
}
export function compareLdu(a: LduValue, b: LduValue): -1 | 0 | 1 {
  const delta = subtractLdu(a, b).numerator;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
export function isMultipleLdu(value: LduValue, pitch: LduValue): boolean {
  const x = exactLdu(value), y = exactLdu(pitch);
  if (!y.numerator) return false;
  return (x.numerator * y.denominator) % (x.denominator * y.numerator) === 0n;
}
export function formatLdu(input: LduValue): string {
  const value = exactLdu(input);
  return value.denominator === 1n ? String(value.numerator) : `${value.numerator}/${value.denominator}`;
}
export function exactVector(input: LduVectorInput): ExactVector { return input.map(exactLdu) as ExactVector; }
export function equalLduVector(a: LduVectorInput, b: LduVectorInput): boolean { return a.every((value, axis) => equalLdu(value, b[axis])); }

export interface ExactClosureConstraint {
  fixedFeatureId: string;
  movingFeatureId: string;
  fixedPosition: LduVectorInput;
  movingPosition: LduVectorInput;
  /** Axes must use an already agreed rule convention, not outward normals. */
  fixedAxis?: LduVectorInput;
  movingAxis?: LduVectorInput;
}
export interface ExactClosureResult {
  status: 'EXACT' | 'MISALIGNED' | 'UNKNOWN';
  exact: boolean;
  reason: string;
  residuals: { fixedFeatureId: string; movingFeatureId: string; position: [string, string, string]; axis?: [string, string, string] }[];
  scope: 'mathematical-world-endpoint-closure-only';
}

/** Checks every declared endpoint under one already solved pose. No averaging,
 * millimetre conversion, stress compensation or epsilon acceptance occurs. */
export function validateExactClosure(constraints: readonly ExactClosureConstraint[]): ExactClosureResult {
  const result: ExactClosureResult = { status: 'UNKNOWN', exact: false, reason: 'At least one bounded endpoint constraint is required.', residuals: [], scope: 'mathematical-world-endpoint-closure-only' };
  if (!constraints.length || constraints.length > 4096) return result;
  try {
    let matching = true;
    for (const constraint of constraints) {
      if (!constraint.fixedFeatureId || !constraint.movingFeatureId || constraint.fixedPosition.length !== 3 || constraint.movingPosition.length !== 3) throw new Error('Invalid closure endpoint.');
      if (!!constraint.fixedAxis !== !!constraint.movingAxis || constraint.fixedAxis && constraint.fixedAxis.length !== 3 || constraint.movingAxis && constraint.movingAxis.length !== 3) throw new Error('Both axes must be explicitly supplied in the same convention.');
      const delta = constraint.fixedPosition.map((value, axis) => subtractLdu(value, constraint.movingPosition[axis])) as ExactVector;
      const axisDelta = constraint.fixedAxis?.map((value, axis) => subtractLdu(value, constraint.movingAxis![axis])) as ExactVector | undefined;
      matching &&= delta.every(value => value.numerator === 0n) && (!axisDelta || axisDelta.every(value => value.numerator === 0n));
      result.residuals.push({ fixedFeatureId: constraint.fixedFeatureId, movingFeatureId: constraint.movingFeatureId, position: delta.map(formatLdu) as [string, string, string], ...(axisDelta ? { axis: axisDelta.map(formatLdu) as [string, string, string] } : {}) });
    }
    return { ...result, status: matching ? 'EXACT' : 'MISALIGNED', exact: matching, reason: matching ? 'Every declared world endpoint agrees exactly.' : 'At least one endpoint or axis disagrees; a rigid assembly cannot compensate by bending or averaging.' };
  } catch (error) { return { ...result, reason: error instanceof Error ? error.message : 'Unknown exact-coordinate input.' }; }
}
