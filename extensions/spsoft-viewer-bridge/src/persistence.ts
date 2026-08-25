import {
  SUPPORTED_TOOLS,
  measurementMatchesTool,
  parseMeasurement,
  type Measurement,
  type SupportedToolName,
} from '@spsoft/viewer-protocol';

const PERSISTENCE_VERSION = 1;
const STORAGE_KEY_PREFIX = 'spsoft.viewer-measurements.v1';
const MAX_PERSISTED_MEASUREMENTS = 100;
const MAX_SERIALIZED_LENGTH = 2_000_000;
export const PERSISTENCE_WRITE_DELAY_MS = 250;

export interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface PersistedViewerMeasurement {
  annotation: Record<string, unknown>;
  annotationId: string;
  measurement: Measurement;
  referenceSeriesUID?: string;
  rowId: string;
  toolName: SupportedToolName;
}

interface UnknownRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function isSupportedTool(value: unknown): value is SupportedToolName {
  return typeof value === 'string' && SUPPORTED_TOOLS.includes(value as SupportedToolName);
}

function hasValidPoint(point: unknown): boolean {
  return (
    Array.isArray(point) &&
    point.length >= 3 &&
    point
      .slice(0, 3)
      .every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))
  );
}

function parseAnnotation(
  value: unknown,
  annotationId: string,
  toolName: SupportedToolName
): Record<string, unknown> | null {
  if (!isRecord(value) || value.annotationUID !== annotationId) {
    return null;
  }

  const { data, metadata } = value;
  const hasImageReference = isRecord(metadata) && isNonEmptyString(metadata.referencedImageId);
  const hasVolumeReference = isRecord(metadata) && isNonEmptyString(metadata.volumeId);

  if (
    !isRecord(metadata) ||
    metadata.toolName !== toolName ||
    !isNonEmptyString(metadata.FrameOfReferenceUID) ||
    (!hasImageReference && !hasVolumeReference) ||
    !isRecord(data) ||
    !isRecord(data.handles) ||
    !Array.isArray(data.handles.points)
  ) {
    return null;
  }

  const minimumPointCount = toolName === 'EllipticalROI' ? 4 : 2;

  return data.handles.points.length >= minimumPointCount && data.handles.points.every(hasValidPoint)
    ? value
    : null;
}

function parsePersistedMeasurement(value: unknown): PersistedViewerMeasurement | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.annotationId) ||
    !isNonEmptyString(value.rowId) ||
    !isSupportedTool(value.toolName)
  ) {
    return null;
  }

  const measurement = parseMeasurement(value.measurement);
  const annotation = parseAnnotation(value.annotation, value.annotationId, value.toolName);

  if (!measurement || !annotation || !measurementMatchesTool(measurement, value.toolName)) {
    return null;
  }

  return {
    annotation,
    annotationId: value.annotationId,
    measurement,
    ...(isNonEmptyString(value.referenceSeriesUID)
      ? { referenceSeriesUID: value.referenceSeriesUID }
      : {}),
    rowId: value.rowId,
    toolName: value.toolName,
  };
}

export function getViewerStorageKey(studyInstanceUid: string): string {
  return `${STORAGE_KEY_PREFIX}:${studyInstanceUid}`;
}

export class ViewerPersistenceStore {
  private cachedMeasurements: PersistedViewerMeasurement[] | null = null;
  private dirty = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly storage: StorageLike,
    private readonly studyInstanceUid: string
  ) {}

  load(): PersistedViewerMeasurement[] {
    if (this.cachedMeasurements) {
      return [...this.cachedMeasurements];
    }

    let parsed: unknown;

    try {
      const serialized = this.storage.getItem(getViewerStorageKey(this.studyInstanceUid));

      if (!serialized || serialized.length > MAX_SERIALIZED_LENGTH) {
        this.cachedMeasurements = [];
        return [];
      }

      parsed = JSON.parse(serialized);
    } catch {
      this.cachedMeasurements = [];
      return [];
    }

    if (
      !isRecord(parsed) ||
      parsed.version !== PERSISTENCE_VERSION ||
      parsed.studyInstanceUid !== this.studyInstanceUid ||
      !Array.isArray(parsed.measurements) ||
      parsed.measurements.length > MAX_PERSISTED_MEASUREMENTS
    ) {
      this.cachedMeasurements = [];
      return [];
    }

    const measurements: PersistedViewerMeasurement[] = [];
    const annotationIds = new Set<string>();
    const rowIds = new Set<string>();

    for (const candidate of parsed.measurements) {
      const measurement = parsePersistedMeasurement(candidate);

      if (
        !measurement ||
        annotationIds.has(measurement.annotationId) ||
        rowIds.has(measurement.rowId)
      ) {
        continue;
      }

      annotationIds.add(measurement.annotationId);
      rowIds.add(measurement.rowId);
      measurements.push(measurement);
    }

    this.cachedMeasurements = measurements;
    return [...measurements];
  }

  remove(annotationId: string): void {
    this.replace(this.load().filter(measurement => measurement.annotationId !== annotationId));
  }

  replace(measurements: PersistedViewerMeasurement[]): void {
    this.cancelScheduledWrite();
    this.cachedMeasurements = measurements.slice(0, MAX_PERSISTED_MEASUREMENTS);
    this.dirty = true;
    this.flush();
  }

  flush(): void {
    this.cancelScheduledWrite();

    if (!this.dirty || !this.cachedMeasurements) {
      return;
    }

    this.dirty = false;
    const key = getViewerStorageKey(this.studyInstanceUid);

    try {
      if (this.cachedMeasurements.length === 0) {
        this.storage.removeItem(key);
        return;
      }

      const serialized = JSON.stringify({
        version: PERSISTENCE_VERSION,
        studyInstanceUid: this.studyInstanceUid,
        measurements: this.cachedMeasurements,
      });

      if (serialized.length <= MAX_SERIALIZED_LENGTH) {
        this.storage.setItem(key, serialized);
      }
    } catch {
      // Storage can be disabled, full, or contain a non-serializable annotation.
    }
  }

  upsert(measurement: PersistedViewerMeasurement): void {
    const measurements = this.load();
    const existingIndex = measurements.findIndex(
      candidate => candidate.annotationId === measurement.annotationId
    );

    if (existingIndex === -1) {
      measurements.push(measurement);
    } else {
      measurements[existingIndex] = measurement;
    }

    this.cachedMeasurements = measurements;
    this.dirty = true;
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.writeTimer !== null) {
      return;
    }

    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush();
    }, PERSISTENCE_WRITE_DELAY_MS);
  }

  private cancelScheduledWrite(): void {
    if (this.writeTimer === null) {
      return;
    }

    clearTimeout(this.writeTimer);
    this.writeTimer = null;
  }
}
