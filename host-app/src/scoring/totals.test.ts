import { createAreaMeasurement, createLengthMeasurement } from '@spsoft/viewer-protocol';

import type { MeasurementRow } from './state';
import { calculateAreaTotals, calculateLengthTotals } from './totals';

function readyRow(id: string, value: number, rawUnit: string): MeasurementRow {
  return {
    id,
    status: 'ready',
    toolName: 'EllipticalROI',
    annotationId: `annotation-${id}`,
    measurement: createAreaMeasurement(value, rawUnit),
  };
}

function readyLengthRow(id: string, value: number, rawUnit: string): MeasurementRow {
  return {
    id,
    status: 'ready',
    toolName: 'Length',
    annotationId: `annotation-${id}`,
    measurement: createLengthMeasurement(value, rawUnit),
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
      { id: 'waiting', status: 'waiting', toolName: 'EllipticalROI' },
      {
        id: 'drawing',
        status: 'drawing',
        activationId: 'activation-1',
        toolName: 'Length',
      },
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

describe('calculateLengthTotals', () => {
  it('sums lengths separately from areas', () => {
    const rows = [
      readyRow('area', 100, 'mm²'),
      readyLengthRow('length-1', 10.25, 'mm'),
      readyLengthRow('length-2', 2.5, 'MM USER'),
    ];

    expect(calculateLengthTotals(rows)).toEqual([
      { key: 'length:mm', value: 12.75, displayUnit: 'mm' },
    ]);
    expect(calculateAreaTotals(rows)).toEqual([
      { key: 'area:mm2', value: 100, displayUnit: 'mm²' },
    ]);
  });

  it('does not add physical and pixel lengths together', () => {
    const rows = [readyLengthRow('mm', 10, 'mm'), readyLengthRow('px', 10, 'px')];

    expect(calculateLengthTotals(rows)).toEqual([
      { key: 'length:mm', value: 10, displayUnit: 'mm' },
      { key: 'length:px', value: 10, displayUnit: 'px' },
    ]);
  });

  it('keeps unknown linear units in normalized independent buckets', () => {
    const rows = [
      readyLengthRow('1', 1.25, 'IN CUSTOM'),
      readyLengthRow('2', 2.5, '  in   custom  '),
      readyLengthRow('3', 4, 'ft CUSTOM'),
    ];

    expect(calculateLengthTotals(rows)).toEqual([
      { key: 'length:unknown:in custom', value: 3.75, displayUnit: 'IN CUSTOM' },
      { key: 'length:unknown:ft custom', value: 4, displayUnit: 'ft CUSTOM' },
    ]);
  });
});
