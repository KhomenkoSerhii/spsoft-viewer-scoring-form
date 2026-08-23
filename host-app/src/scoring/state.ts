import {
  measurementMatchesTool,
  type Measurement,
  type MeasurementAddedPayload,
  type MeasurementRemovedPayload,
  type MeasurementsRestoredPayload,
  type MeasurementUpdatedPayload,
  type SupportedToolName,
  type ViewerReadyPayload,
} from '@spsoft/viewer-protocol';

export type MeasurementRowStatus =
  | 'waiting'
  | 'queued'
  | 'drawing'
  | 'restoring'
  | 'ready'
  | 'deleting'
  | 'error';

export interface MeasurementRow {
  activationId?: string;
  annotationId?: string;
  error?: 'unsupported' | 'bridge-error';
  id: string;
  measurement?: Measurement;
  status: MeasurementRowStatus;
  toolName: SupportedToolName;
}

export interface ScoringState {
  connection:
    | { status: 'connecting' }
    | {
        capabilities: ViewerReadyPayload['capabilities'];
        status: 'ready';
        supportedTools: SupportedToolName[];
        viewerInstanceId: string;
      };
  rows: MeasurementRow[];
}

export type ScoringAction =
  | { type: 'rowAdded'; rowId: string; toolName: SupportedToolName }
  | {
      type: 'activationRequested';
      activationId: string;
      outcome: 'queued' | 'sent' | 'unsupported' | 'error';
      rowId: string;
    }
  | { type: 'activationSent'; activationId: string; rowId: string }
  | { type: 'activationCancelled'; activationId: string; rowId: string }
  | {
      type: 'activationRejected';
      activationId: string;
      reason: 'unsupported' | 'error';
      rowId: string;
    }
  | { type: 'activationReset'; activationId: string; rowId: string }
  | { type: 'measurementReceived'; payload: MeasurementAddedPayload }
  | { type: 'measurementUpdated'; payload: MeasurementUpdatedPayload }
  | { type: 'deletionRequested'; annotationId: string; rowId: string }
  | { type: 'measurementRemoved'; payload: MeasurementRemovedPayload }
  | { type: 'measurementsRestored'; payload: MeasurementsRestoredPayload }
  | { type: 'viewerLoading' }
  | { type: 'viewerReady'; payload: ViewerReadyPayload };

export const initialScoringState: ScoringState = {
  connection: { status: 'connecting' },
  rows: [],
};

export function hasActiveDrawing(state: ScoringState): boolean {
  return state.rows.some(row => row.status === 'queued' || row.status === 'drawing');
}

export function scoringReducer(state: ScoringState, action: ScoringAction): ScoringState {
  switch (action.type) {
    case 'rowAdded':
      return {
        ...state,
        rows: [...state.rows, { id: action.rowId, status: 'waiting', toolName: action.toolName }],
      };

    case 'viewerLoading':
      return {
        connection: { status: 'connecting' },
        rows: prepareRowsForRestore(state.rows),
      };

    case 'viewerReady': {
      const changedViewerSession =
        state.connection.status === 'ready' &&
        state.connection.viewerInstanceId !== action.payload.viewerInstanceId;

      const rows = changedViewerSession ? prepareRowsForRestore(state.rows) : state.rows;

      return {
        ...state,
        connection: {
          capabilities: action.payload.capabilities,
          status: 'ready',
          viewerInstanceId: action.payload.viewerInstanceId,
          supportedTools: action.payload.supportedTools,
        },
        rows: action.payload.capabilities.statePersistence ? rows : resetRestoringRows(rows),
      };
    }

    case 'measurementsRestored': {
      if (
        state.connection.status !== 'ready' ||
        state.connection.viewerInstanceId !== action.payload.viewerInstanceId
      ) {
        return state;
      }

      const restoredByRowId = new Map(
        action.payload.measurements.map(measurement => [measurement.rowId, measurement])
      );

      return {
        ...state,
        rows: state.rows.map(row => {
          if (row.status !== 'restoring') {
            return row;
          }

          const restored = restoredByRowId.get(row.id);

          return restored &&
            restored.annotationId === row.annotationId &&
            restored.toolName === row.toolName &&
            measurementMatchesTool(restored.measurement, row.toolName)
            ? {
                id: row.id,
                status: 'ready',
                annotationId: restored.annotationId,
                measurement: restored.measurement,
                toolName: row.toolName,
              }
            : { id: row.id, status: 'waiting', toolName: row.toolName };
        }),
      };
    }

    case 'activationRequested': {
      if (hasActiveDrawing(state)) {
        return state;
      }

      return updateRow(state, action.rowId, row => {
        if (row.status !== 'waiting' && row.status !== 'error') {
          return row;
        }

        if (action.outcome === 'unsupported' || action.outcome === 'error') {
          return {
            id: row.id,
            status: 'error',
            toolName: row.toolName,
            error: action.outcome === 'unsupported' ? 'unsupported' : 'bridge-error',
          };
        }

        return {
          id: row.id,
          status: action.outcome === 'queued' ? 'queued' : 'drawing',
          activationId: action.activationId,
          toolName: row.toolName,
        };
      });
    }

    case 'activationSent':
      return updateMatchingActivation(state, action, row => ({ ...row, status: 'drawing' }));

    case 'activationRejected':
      return updateMatchingActivation(state, action, row => ({
        id: row.id,
        status: 'error',
        toolName: row.toolName,
        error: action.reason === 'unsupported' ? 'unsupported' : 'bridge-error',
      }));

    case 'measurementReceived':
      return updateMatchingActivation(
        state,
        {
          rowId: action.payload.rowId,
          activationId: action.payload.activationId,
        },
        row =>
          measurementMatchesTool(action.payload.measurement, row.toolName)
            ? {
                id: row.id,
                status: 'ready',
                annotationId: action.payload.annotationId,
                measurement: action.payload.measurement,
                toolName: row.toolName,
              }
            : row
      );

    case 'measurementUpdated': {
      if (
        state.connection.status !== 'ready' ||
        state.connection.viewerInstanceId !== action.payload.viewerInstanceId
      ) {
        return state;
      }

      return updateRow(state, action.payload.rowId, row =>
        row.status === 'ready' &&
        row.annotationId === action.payload.annotationId &&
        measurementMatchesTool(action.payload.measurement, row.toolName)
          ? { ...row, measurement: action.payload.measurement }
          : row
      );
    }

    case 'deletionRequested':
      return updateRow(state, action.rowId, row =>
        row.status === 'ready' && row.annotationId === action.annotationId
          ? { ...row, status: 'deleting' }
          : row
      );

    case 'measurementRemoved': {
      if (
        state.connection.status !== 'ready' ||
        state.connection.viewerInstanceId !== action.payload.viewerInstanceId
      ) {
        return state;
      }

      const row = state.rows.find(item => item.id === action.payload.rowId);

      if (
        !row ||
        (row.status !== 'ready' && row.status !== 'deleting') ||
        row.annotationId !== action.payload.annotationId
      ) {
        return state;
      }

      if (row.status === 'deleting') {
        return { ...state, rows: state.rows.filter(item => item.id !== row.id) };
      }

      return updateRow(state, row.id, currentRow => ({
        id: currentRow.id,
        status: 'waiting',
        toolName: currentRow.toolName,
      }));
    }

    case 'activationCancelled':
    case 'activationReset':
      return updateMatchingActivation(state, action, row => ({
        id: row.id,
        status: 'waiting',
        toolName: row.toolName,
      }));
  }
}

function prepareRowsForRestore(rows: MeasurementRow[]): MeasurementRow[] {
  let changed = false;
  const resetRows = rows.map(row => {
    if (
      (row.status === 'ready' || row.status === 'deleting') &&
      row.annotationId &&
      row.measurement
    ) {
      changed = true;
      return { ...row, status: 'restoring' } satisfies MeasurementRow;
    }

    if (row.status === 'waiting' || row.status === 'queued' || row.status === 'restoring') {
      return row;
    }

    changed = true;
    return { id: row.id, status: 'waiting', toolName: row.toolName } satisfies MeasurementRow;
  });

  return changed ? resetRows : rows;
}

function resetRestoringRows(rows: MeasurementRow[]): MeasurementRow[] {
  let changed = false;
  const nextRows = rows.map(row => {
    if (row.status !== 'restoring') {
      return row;
    }

    changed = true;
    return { id: row.id, status: 'waiting', toolName: row.toolName } satisfies MeasurementRow;
  });

  return changed ? nextRows : rows;
}

function updateMatchingActivation(
  state: ScoringState,
  action: { activationId: string; rowId: string },
  update: (row: MeasurementRow) => MeasurementRow
): ScoringState {
  return updateRow(state, action.rowId, row =>
    row.activationId === action.activationId ? update(row) : row
  );
}

function updateRow(
  state: ScoringState,
  rowId: string,
  update: (row: MeasurementRow) => MeasurementRow
): ScoringState {
  let changed = false;
  const rows = state.rows.map(row => {
    if (row.id !== rowId) {
      return row;
    }

    const nextRow = update(row);
    changed ||= nextRow !== row;
    return nextRow;
  });

  return changed ? { ...state, rows } : state;
}
