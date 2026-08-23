import {
  extractRemovedAnnotationId,
  extractSupportedMeasurement,
  extractSupportedMeasurementAnnotationId,
} from './measurement';

describe('extractSupportedMeasurement', () => {
  it('identifies an ellipse before its cached statistics are ready', () => {
    const event = {
      measurement: {
        uid: 'annotation-pending',
        toolName: 'EllipticalROI',
        data: {},
      },
    };

    expect(extractSupportedMeasurementAnnotationId(event, 'EllipticalROI')).toBe(
      'annotation-pending'
    );
    expect(extractSupportedMeasurement(event, 'EllipticalROI')).toBeNull();
  });

  it('extracts and normalizes area from the real OHIF measurement shape', () => {
    expect(
      extractSupportedMeasurement({
        source: { name: 'Cornerstone3DTools' },
        measurement: {
          uid: 'annotation-1',
          toolName: 'EllipticalROI',
          data: {
            'imageId:wadors:study/series/instance': {
              area: 176768.34,
              areaUnit: 'mm²',
              mean: -431.2,
            },
          },
        },
      })
    ).toEqual({
      annotationId: 'annotation-1',
      measurement: {
        kind: 'area',
        value: 176768.34,
        unit: 'mm2',
        rawUnit: 'mm²',
      },
    });
  });

  it('uses the first complete target when cached stats contain incomplete entries', () => {
    expect(
      extractSupportedMeasurement({
        measurement: {
          uid: 'annotation-2',
          toolName: 'EllipticalROI',
          data: {
            first: { area: undefined, areaUnit: undefined },
            second: { area: 25, areaUnit: 'px² USER' },
          },
        },
      })
    ).toEqual({
      annotationId: 'annotation-2',
      measurement: {
        kind: 'area',
        value: 25,
        unit: 'px2',
        rawUnit: 'px² USER',
        calibrationType: 'USER',
      },
    });
  });

  it('extracts and normalizes length from the real OHIF measurement shape', () => {
    expect(
      extractSupportedMeasurement(
        {
          source: { name: 'Cornerstone3DTools' },
          measurement: {
            uid: 'length-annotation',
            toolName: 'Length',
            data: {
              'imageId:wadors:study/series/instance': {
                length: 18.5,
                unit: 'mm',
              },
            },
          },
        },
        'Length'
      )
    ).toEqual({
      annotationId: 'length-annotation',
      measurement: {
        kind: 'length',
        value: 18.5,
        unit: 'mm',
        rawUnit: 'mm',
      },
    });
  });

  it('does not accept a supported measurement for a differently armed tool', () => {
    const event = {
      measurement: {
        uid: 'length-annotation',
        toolName: 'Length',
        data: { target: { length: 18.5, unit: 'mm' } },
      },
    };

    expect(extractSupportedMeasurementAnnotationId(event, 'EllipticalROI')).toBeNull();
    expect(extractSupportedMeasurement(event, 'EllipticalROI')).toBeNull();
  });

  it.each([
    undefined,
    {},
    { measurement: { uid: 'annotation-1', toolName: 'Length', data: {} } },
    { measurement: { uid: '', toolName: 'EllipticalROI', data: {} } },
    {
      measurement: {
        uid: 'annotation-1',
        toolName: 'EllipticalROI',
        data: { target: { area: Number.NaN, areaUnit: 'mm²' } },
      },
    },
    {
      measurement: {
        uid: 'annotation-1',
        toolName: 'EllipticalROI',
        data: { target: { area: 10, areaUnit: '' } },
      },
    },
  ])('ignores unrelated or malformed payload %#', event => {
    expect(extractSupportedMeasurement(event)).toBeNull();
  });
});

describe('extractRemovedAnnotationId', () => {
  it('extracts the identifier from an OHIF removal event', () => {
    expect(extractRemovedAnnotationId({ measurement: 'annotation-1' })).toBe('annotation-1');
  });

  it.each([undefined, {}, { measurement: '' }, { measurement: { uid: 'annotation-1' } }])(
    'ignores malformed removal payload %#',
    event => {
      expect(extractRemovedAnnotationId(event)).toBeNull();
    }
  );
});
