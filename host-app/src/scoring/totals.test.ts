import { createAreaMeasurement } from '@spsoft/viewer-protocol';

import type { MeasurementRow } from './state';
import { calculateAreaTotals } from './totals';

function readyRow(id: string, value: number, rawUnit: string): MeasurementRow {
  return {
    id,
    status: 'ready',
    annotationId: `annotation-${id}`,
    measurement: createAreaMeasurement(value, rawUnit),
  };
}

describe('calculateAreaTotals', () => {
  it('sums ready measurements that share a normalized known unit', () => {
    const rows = [
      readyRow('1', 10.25, 'mm²'),
      readyRow('2', 2.5, 'mm^2 ERMF'),
      readyRow('3', 0.125, 'MM2'),
    ];

    expect(calculateAreaTotals(rows)).toEqual([
      { key: 'area:mm2', value: 12.875, displayUnit: 'mm²' },
    ]);
  });

  it('keeps mm², cm², and px² in separate totals without conversion', () => {
    const rows = [readyRow('1', 10, 'mm²'), readyRow('2', 10, 'cm²'), readyRow('3', 10, 'px²')];

    expect(calculateAreaTotals(rows)).toEqual([
      { key: 'area:mm2', value: 10, displayUnit: 'mm²' },
      { key: 'area:cm2', value: 10, displayUnit: 'cm²' },
      { key: 'area:px2', value: 10, displayUnit: 'px²' },
    ]);
  });

  it('groups equivalent unknown units while keeping different unknown units separate', () => {
    const rows = [
      readyRow('1', 1.25, 'SUV bw'),
      readyRow('2', 2.5, '  suv   BW  '),
      readyRow('3', 4, 'SUV lbm'),
    ];

    expect(calculateAreaTotals(rows)).toEqual([
      { key: 'area:unknown:suv bw', value: 3.75, displayUnit: 'SUV bw' },
      { key: 'area:unknown:suv lbm', value: 4, displayUnit: 'SUV lbm' },
    ]);
  });

  it('ignores rows that have not completed a correlated measurement', () => {
    const rows: MeasurementRow[] = [
      { id: 'waiting', status: 'waiting' },
      { id: 'drawing', status: 'drawing', activationId: 'activation-1' },
      readyRow('ready', 7.125, 'mm²'),
    ];

    expect(calculateAreaTotals(rows)).toEqual([
      { key: 'area:mm2', value: 7.125, displayUnit: 'mm²' },
    ]);
  });

  it('keeps a measurement in totals while Viewer deletion is pending', () => {
    const deletingRow = { ...readyRow('deleting', 7.125, 'mm²'), status: 'deleting' as const };

    expect(calculateAreaTotals([deletingRow])).toEqual([
      { key: 'area:mm2', value: 7.125, displayUnit: 'mm²' },
    ]);
  });
});
