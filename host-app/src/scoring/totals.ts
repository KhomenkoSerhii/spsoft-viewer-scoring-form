import {
  getAreaAggregationKey,
  getLengthAggregationKey,
  type AreaMeasurement,
  type AreaUnit,
  type LengthMeasurement,
  type LengthUnit,
} from '@spsoft/viewer-protocol';

import type { MeasurementRow } from './state';

export interface AreaTotal {
  displayUnit: string;
  key: string;
  value: number;
}

export interface LengthTotal {
  displayUnit: string;
  key: string;
  value: number;
}

const AREA_UNIT_LABELS: Record<Exclude<AreaUnit, 'unknown'>, string> = {
  mm2: 'mm²',
  cm2: 'cm²',
  px2: 'px²',
};

const LENGTH_UNIT_LABELS: Record<Exclude<LengthUnit, 'unknown'>, string> = {
  mm: 'mm',
  cm: 'cm',
  px: 'px',
};

export function calculateAreaTotals(rows: readonly MeasurementRow[]): AreaTotal[] {
  const totalsByUnit = new Map<string, AreaTotal>();

  for (const row of rows) {
    if ((row.status !== 'ready' && row.status !== 'deleting') || row.measurement?.kind !== 'area') {
      continue;
    }

    const key = getAreaAggregationKey(row.measurement);
    const existingTotal = totalsByUnit.get(key);

    if (existingTotal) {
      existingTotal.value += row.measurement.value;
      continue;
    }

    totalsByUnit.set(key, {
      key,
      value: row.measurement.value,
      displayUnit: getDisplayUnit(row.measurement),
    });
  }

  return [...totalsByUnit.values()];
}

export function calculateLengthTotals(rows: readonly MeasurementRow[]): LengthTotal[] {
  const totalsByUnit = new Map<string, LengthTotal>();

  for (const row of rows) {
    if (
      (row.status !== 'ready' && row.status !== 'deleting') ||
      row.measurement?.kind !== 'length'
    ) {
      continue;
    }

    const key = getLengthAggregationKey(row.measurement);
    const existingTotal = totalsByUnit.get(key);

    if (existingTotal) {
      existingTotal.value += row.measurement.value;
      continue;
    }

    totalsByUnit.set(key, {
      key,
      value: row.measurement.value,
      displayUnit: getLengthDisplayUnit(row.measurement),
    });
  }

  return [...totalsByUnit.values()];
}

function getDisplayUnit(measurement: AreaMeasurement): string {
  if (measurement.unit !== 'unknown') {
    return AREA_UNIT_LABELS[measurement.unit];
  }

  return measurement.rawUnit.trim().replace(/\s+/g, ' ');
}

function getLengthDisplayUnit(measurement: LengthMeasurement): string {
  if (measurement.unit !== 'unknown') {
    return LENGTH_UNIT_LABELS[measurement.unit];
  }

  return measurement.rawUnit.trim().replace(/\s+/g, ' ');
}
