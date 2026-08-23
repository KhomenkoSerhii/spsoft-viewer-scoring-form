import {
  getRestorableMeasurementBindings,
  getScoringStorageKey,
  loadPersistedRows,
  savePersistedRows,
} from './persistence';
import type { MeasurementRow } from './state';

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

const studyInstanceUid = 'study-1';

describe('scoring persistence', () => {
  it('serializes completed rows and restores transient rows safely', () => {
    const storage = new MemoryStorage();
    const rows: MeasurementRow[] = [
      {
        id: 'area-row',
        status: 'ready',
        annotationId: 'area-annotation',
        toolName: 'EllipticalROI',
        measurement: { kind: 'area', value: 42.75, unit: 'mm2', rawUnit: 'mm²' },
      },
      {
        id: 'length-row',
        status: 'drawing',
        activationId: 'activation-1',
        toolName: 'Length',
      },
    ];

    savePersistedRows(storage, studyInstanceUid, rows);

    expect(loadPersistedRows(storage, studyInstanceUid)).toEqual([
      {
        id: 'area-row',
        status: 'restoring',
        annotationId: 'area-annotation',
        toolName: 'EllipticalROI',
        measurement: { kind: 'area', value: 42.75, unit: 'mm2', rawUnit: 'mm²' },
      },
      { id: 'length-row', status: 'waiting', toolName: 'Length' },
    ]);
  });

  it('rejects invalid measurement kinds, duplicate IDs, and another study', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      getScoringStorageKey(studyInstanceUid),
      JSON.stringify({
        version: 1,
        studyInstanceUid,
        rows: [
          {
            id: 'row-1',
            status: 'ready',
            annotationId: 'annotation-1',
            toolName: 'Length',
            measurement: { kind: 'area', value: 1, unit: 'mm2', rawUnit: 'mm²' },
          },
          { id: 'row-1', status: 'waiting', toolName: 'EllipticalROI' },
        ],
      })
    );

    expect(loadPersistedRows(storage, studyInstanceUid)).toEqual([
      { id: 'row-1', status: 'waiting', toolName: 'Length' },
    ]);
    expect(loadPersistedRows(storage, 'another-study')).toEqual([]);
  });

  it('derives restoration bindings only from rows with complete correlation data', () => {
    expect(
      getRestorableMeasurementBindings([
        {
          id: 'row-1',
          status: 'restoring',
          annotationId: 'annotation-1',
          toolName: 'Length',
          measurement: { kind: 'length', value: 18, unit: 'mm', rawUnit: 'mm' },
        },
        { id: 'row-2', status: 'waiting', toolName: 'EllipticalROI' },
      ])
    ).toEqual([{ annotationId: 'annotation-1', rowId: 'row-1', toolName: 'Length' }]);
  });
});
