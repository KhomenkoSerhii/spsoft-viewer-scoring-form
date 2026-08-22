import { extractEllipticalRoiAnnotationId, extractEllipticalRoiMeasurement } from './measurement';

describe('extractEllipticalRoiMeasurement', () => {
  it('identifies an ellipse before its cached statistics are ready', () => {
    const event = {
      measurement: {
        uid: 'annotation-pending',
        toolName: 'EllipticalROI',
        data: {},
      },
    };

    expect(extractEllipticalRoiAnnotationId(event)).toBe('annotation-pending');
    expect(extractEllipticalRoiMeasurement(event)).toBeNull();
  });

  it('extracts and normalizes area from the real OHIF measurement shape', () => {
    expect(
      extractEllipticalRoiMeasurement({
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
      extractEllipticalRoiMeasurement({
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
    expect(extractEllipticalRoiMeasurement(event)).toBeNull();
  });
});
