import {
  getAreaAggregationKey,
  type AreaMeasurement,
  type AreaUnit,
} from '@spsoft/viewer-protocol';

import type { MeasurementRow } from './state';

export interface AreaTotal {
  displayUnit: string;
  key: string;
  value: number;
}

const AREA_UNIT_LABELS: Record<Exclude<AreaUnit, 'unknown'>, string> = {
  mm2: 'mm²',
  cm2: 'cm²',
  px2: 'px²',
};

export function calculateAreaTotals(rows: readonly MeasurementRow[]): AreaTotal[] {
  const totalsByUnit = new Map<string, AreaTotal>();

  for (const row of rows) {
    if (row.status !== 'ready' || !row.measurement) {
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

function getDisplayUnit(measurement: AreaMeasurement): string {
  if (measurement.unit !== 'unknown') {
    return AREA_UNIT_LABELS[measurement.unit];
  }

  return measurement.rawUnit.trim().replace(/\s+/g, ' ');
}
