import type { AreaMeasurement, AreaUnit, LengthMeasurement, LengthUnit } from './types';

export interface NormalizedAreaUnit {
  unit: AreaUnit;
  rawUnit: string;
  calibrationType?: string;
}

export interface NormalizedLengthUnit {
  unit: LengthUnit;
  rawUnit: string;
  calibrationType?: string;
}

const CANONICAL_AREA_UNITS: Record<string, AreaUnit> = {
  mm2: 'mm2',
  cm2: 'cm2',
  px2: 'px2',
};

const CANONICAL_LENGTH_UNITS: Record<string, LengthUnit> = {
  mm: 'mm',
  cm: 'cm',
  px: 'px',
};

function splitRawUnit(rawUnit: string): {
  baseUnit: string;
  calibrationType?: string;
} {
  const [baseUnit = '', ...calibrationParts] = rawUnit.trim().split(/\s+/);
  const calibrationType = calibrationParts.join(' ');

  return calibrationType ? { baseUnit, calibrationType } : { baseUnit };
}

export function normalizeAreaUnit(rawUnit: string): NormalizedAreaUnit {
  const { baseUnit, calibrationType } = splitRawUnit(rawUnit);
  const normalizedBaseUnit = baseUnit.toLowerCase().replace('²', '2').replace('^2', '2');
  const unit = CANONICAL_AREA_UNITS[normalizedBaseUnit] ?? 'unknown';

  return calibrationType ? { unit, rawUnit, calibrationType } : { unit, rawUnit };
}

export function normalizeLengthUnit(rawUnit: string): NormalizedLengthUnit {
  const { baseUnit, calibrationType } = splitRawUnit(rawUnit);
  const unit = CANONICAL_LENGTH_UNITS[baseUnit.toLowerCase()] ?? 'unknown';

  return calibrationType ? { unit, rawUnit, calibrationType } : { unit, rawUnit };
}

export function createAreaMeasurement(value: number, rawUnit: string): AreaMeasurement {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Area value must be a finite, non-negative number.');
  }

  if (!rawUnit.trim()) {
    throw new TypeError('Area raw unit must be a non-empty string.');
  }

  return {
    kind: 'area',
    value,
    ...normalizeAreaUnit(rawUnit),
  };
}

export function createLengthMeasurement(value: number, rawUnit: string): LengthMeasurement {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Length value must be a finite, non-negative number.');
  }

  if (!rawUnit.trim()) {
    throw new TypeError('Length raw unit must be a non-empty string.');
  }

  return {
    kind: 'length',
    value,
    ...normalizeLengthUnit(rawUnit),
  };
}

export function getAreaAggregationKey(measurement: AreaMeasurement): string {
  if (measurement.unit !== 'unknown') {
    return `${measurement.kind}:${measurement.unit}`;
  }

  const normalizedRawUnit = measurement.rawUnit.trim().toLowerCase().replace(/\s+/g, ' ');

  return `${measurement.kind}:unknown:${normalizedRawUnit}`;
}

export function getLengthAggregationKey(measurement: LengthMeasurement): string {
  if (measurement.unit !== 'unknown') {
    return `${measurement.kind}:${measurement.unit}`;
  }

  const normalizedRawUnit = measurement.rawUnit.trim().toLowerCase().replace(/\s+/g, ' ');

  return `${measurement.kind}:unknown:${normalizedRawUnit}`;
}
