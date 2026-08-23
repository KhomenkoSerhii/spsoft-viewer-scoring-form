import {
  SUPPORTED_TOOLS,
  measurementMatchesTool,
  parseMeasurement,
  type MeasurementBinding,
  type SupportedToolName,
} from '@spsoft/viewer-protocol';

import type { MeasurementRow } from './state';

const PERSISTENCE_VERSION = 1;
const STORAGE_KEY_PREFIX = 'spsoft.scoring-state.v1';
const MAX_PERSISTED_ROWS = 100;

interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
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

export function getScoringStorageKey(studyInstanceUid: string): string {
  return `${STORAGE_KEY_PREFIX}:${studyInstanceUid}`;
}

export function loadPersistedRows(
  storage: StorageLike,
  studyInstanceUid: string
): MeasurementRow[] {
  let parsed: unknown;

  try {
    const serialized = storage.getItem(getScoringStorageKey(studyInstanceUid));

    if (!serialized) {
      return [];
    }

    parsed = JSON.parse(serialized);
  } catch {
    return [];
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== PERSISTENCE_VERSION ||
    parsed.studyInstanceUid !== studyInstanceUid ||
    !Array.isArray(parsed.rows) ||
    parsed.rows.length > MAX_PERSISTED_ROWS
  ) {
    return [];
  }

  const rows: MeasurementRow[] = [];
  const rowIds = new Set<string>();
  const annotationIds = new Set<string>();

  for (const candidate of parsed.rows) {
    if (
      !isRecord(candidate) ||
      !isNonEmptyString(candidate.id) ||
      !isSupportedTool(candidate.toolName) ||
      rowIds.has(candidate.id)
    ) {
      continue;
    }

    rowIds.add(candidate.id);

    if (candidate.status !== 'ready') {
      rows.push({ id: candidate.id, status: 'waiting', toolName: candidate.toolName });
      continue;
    }

    const measurement = parseMeasurement(candidate.measurement);

    if (
      !isNonEmptyString(candidate.annotationId) ||
      annotationIds.has(candidate.annotationId) ||
      !measurement ||
      !measurementMatchesTool(measurement, candidate.toolName)
    ) {
      rows.push({ id: candidate.id, status: 'waiting', toolName: candidate.toolName });
      continue;
    }

    annotationIds.add(candidate.annotationId);
    rows.push({
      id: candidate.id,
      status: 'restoring',
      annotationId: candidate.annotationId,
      measurement,
      toolName: candidate.toolName,
    });
  }

  return rows;
}

export function savePersistedRows(
  storage: StorageLike,
  studyInstanceUid: string,
  rows: MeasurementRow[]
): void {
  const persistedRows = rows.slice(0, MAX_PERSISTED_ROWS).map(row => {
    const persistAsReady =
      (row.status === 'ready' || row.status === 'restoring' || row.status === 'deleting') &&
      row.annotationId &&
      row.measurement;

    return persistAsReady
      ? {
          id: row.id,
          status: 'ready',
          toolName: row.toolName,
          annotationId: row.annotationId,
          measurement: row.measurement,
        }
      : { id: row.id, status: 'waiting', toolName: row.toolName };
  });
  const key = getScoringStorageKey(studyInstanceUid);

  try {
    if (persistedRows.length === 0) {
      storage.removeItem(key);
      return;
    }

    storage.setItem(
      key,
      JSON.stringify({
        version: PERSISTENCE_VERSION,
        studyInstanceUid,
        rows: persistedRows,
      })
    );
  } catch {
    // Storage can be disabled or full; the in-memory workflow must remain usable.
  }
}

export function getRestorableMeasurementBindings(rows: MeasurementRow[]): MeasurementBinding[] {
  return rows.flatMap(row =>
    (row.status === 'ready' || row.status === 'restoring' || row.status === 'deleting') &&
    row.annotationId &&
    row.measurement
      ? [{ annotationId: row.annotationId, rowId: row.id, toolName: row.toolName }]
      : []
  );
}
