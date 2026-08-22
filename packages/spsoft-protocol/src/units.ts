import type { AreaMeasurement, AreaUnit } from './types';

export interface NormalizedAreaUnit {
  unit: AreaUnit;
  rawUnit: string;
  calibrationType?: string;
}

const CANONICAL_AREA_UNITS: Record<string, AreaUnit> = {
  mm2: 'mm2',
  cm2: 'cm2',
  px2: 'px2',
};

export function normalizeAreaUnit(rawUnit: string): NormalizedAreaUnit {
  const [baseUnit = '', ...calibrationParts] = rawUnit.trim().split(/\s+/);
  const normalizedBaseUnit = baseUnit.toLowerCase().replace('²', '2').replace('^2', '2');
  const unit = CANONICAL_AREA_UNITS[normalizedBaseUnit] ?? 'unknown';
  const calibrationType = calibrationParts.join(' ');

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

export function getAreaAggregationKey(measurement: AreaMeasurement): string {
  if (measurement.unit !== 'unknown') {
    return `${measurement.kind}:${measurement.unit}`;
  }

  const normalizedRawUnit = measurement.rawUnit.trim().toLowerCase().replace(/\s+/g, ' ');

  return `${measurement.kind}:unknown:${normalizedRawUnit}`;
}
