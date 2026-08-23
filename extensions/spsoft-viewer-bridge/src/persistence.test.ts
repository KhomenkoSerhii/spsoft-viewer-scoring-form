import { getViewerStorageKey, ViewerPersistenceStore } from './persistence';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function createAnnotation(annotationId = 'annotation-1') {
  return {
    annotationUID: annotationId,
    metadata: {
      toolName: 'EllipticalROI',
      FrameOfReferenceUID: 'frame-1',
      referencedImageId: 'wadors:image-1',
    },
    data: {
      handles: {
        points: [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
          [10, 11, 12],
        ],
      },
    },
  };
}

describe('ViewerPersistenceStore', () => {
  it('round-trips a validated Cornerstone annotation', () => {
    const storage = new MemoryStorage();
    const store = new ViewerPersistenceStore(storage, 'study-1');

    store.upsert({
      annotation: createAnnotation(),
      annotationId: 'annotation-1',
      rowId: 'row-1',
      toolName: 'EllipticalROI',
      measurement: { kind: 'area', value: 42.75, unit: 'mm2', rawUnit: 'mm²' },
    });

    expect(store.load()).toEqual([
      expect.objectContaining({ annotationId: 'annotation-1', rowId: 'row-1' }),
    ]);
    store.remove('annotation-1');
    expect(store.load()).toEqual([]);
    expect(storage.getItem(getViewerStorageKey('study-1'))).toBeNull();
  });

  it('drops corrupted geometry and mismatched tool measurements', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      getViewerStorageKey('study-1'),
      JSON.stringify({
        version: 1,
        studyInstanceUid: 'study-1',
        measurements: [
          {
            annotation: createAnnotation(),
            annotationId: 'annotation-1',
            rowId: 'row-1',
            toolName: 'Length',
            measurement: { kind: 'area', value: 1, unit: 'mm2', rawUnit: 'mm²' },
          },
          {
            annotation: {
              ...createAnnotation('annotation-2'),
              data: { handles: { points: [[Number.NaN, 2, 3]] } },
            },
            annotationId: 'annotation-2',
            rowId: 'row-2',
            toolName: 'EllipticalROI',
            measurement: { kind: 'area', value: 1, unit: 'mm2', rawUnit: 'mm²' },
          },
        ],
      })
    );

    expect(new ViewerPersistenceStore(storage, 'study-1').load()).toEqual([]);
  });
});
