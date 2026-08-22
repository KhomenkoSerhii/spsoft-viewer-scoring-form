import { createAreaMeasurement, getAreaAggregationKey, normalizeAreaUnit } from './units';

describe('normalizeAreaUnit', () => {
  it.each([
    ['mm²', 'mm2', undefined],
    ['mm^2 ERMF', 'mm2', 'ERMF'],
    ['cm² US Region', 'cm2', 'US Region'],
    ['px²', 'px2', undefined],
    ['unknown² CALIBRATED', 'unknown', 'CALIBRATED'],
  ] as const)('normalizes %s to %s', (rawUnit, unit, calibrationType) => {
    expect(normalizeAreaUnit(rawUnit)).toEqual({
      unit,
      rawUnit,
      ...(calibrationType ? { calibrationType } : {}),
    });
  });

  it('preserves the exact raw unit for diagnostics', () => {
    const rawUnit = '  mm²   USER  ';

    expect(normalizeAreaUnit(rawUnit)).toEqual({
      unit: 'mm2',
      rawUnit,
      calibrationType: 'USER',
    });
  });
});

describe('createAreaMeasurement', () => {
  it('creates a consistent measurement from an OHIF raw unit', () => {
    expect(createAreaMeasurement(42.25, 'mm² ERMF')).toEqual({
      kind: 'area',
      value: 42.25,
      unit: 'mm2',
      rawUnit: 'mm² ERMF',
      calibrationType: 'ERMF',
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects invalid area value %s', value => {
    expect(() => createAreaMeasurement(value, 'mm²')).toThrow(RangeError);
  });

  it('rejects an empty raw unit', () => {
    expect(() => createAreaMeasurement(1, ' ')).toThrow(TypeError);
  });
});

describe('getAreaAggregationKey', () => {
  it('groups known physical units independently of calibration metadata', () => {
    expect(getAreaAggregationKey(createAreaMeasurement(1, 'mm²'))).toBe('area:mm2');
    expect(getAreaAggregationKey(createAreaMeasurement(2, 'mm² ERMF'))).toBe('area:mm2');
  });

  it('keeps different unknown units in separate buckets', () => {
    const squareMeters = getAreaAggregationKey(createAreaMeasurement(1, 'm²'));
    const squareInches = getAreaAggregationKey(createAreaMeasurement(1, 'in²'));

    expect(squareMeters).not.toBe(squareInches);
  });

  it('normalizes whitespace and casing within the same unknown unit', () => {
    const firstKey = getAreaAggregationKey(createAreaMeasurement(1, 'M²  CUSTOM'));
    const secondKey = getAreaAggregationKey(createAreaMeasurement(1, '  m² custom  '));

    expect(firstKey).toBe(secondKey);
  });
});
