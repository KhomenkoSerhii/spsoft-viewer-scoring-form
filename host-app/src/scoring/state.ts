import type {
  AreaMeasurement,
  MeasurementAddedPayload,
  SupportedToolName,
  ViewerReadyPayload,
} from '@spsoft/viewer-protocol';

export type MeasurementRowStatus = 'waiting' | 'queued' | 'drawing' | 'ready' | 'error';

export interface MeasurementRow {
  activationId?: string;
  annotationId?: string;
  error?: 'unsupported' | 'bridge-error';
  id: string;
  measurement?: AreaMeasurement;
  status: MeasurementRowStatus;
}

export interface ScoringState {
  connection:
    | { status: 'connecting' }
    | {
        status: 'ready';
        supportedTools: SupportedToolName[];
        viewerInstanceId: string;
      };
  rows: MeasurementRow[];
}

export type ScoringAction =
  | { type: 'rowAdded'; rowId: string }
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
        rows: [...state.rows, { id: action.rowId, status: 'waiting' }],
      };

    case 'viewerReady':
      return {
        ...state,
        connection: {
          status: 'ready',
          viewerInstanceId: action.payload.viewerInstanceId,
          supportedTools: action.payload.supportedTools,
        },
      };

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
            error: action.outcome === 'unsupported' ? 'unsupported' : 'bridge-error',
          };
        }

        return {
          id: row.id,
          status: action.outcome === 'queued' ? 'queued' : 'drawing',
          activationId: action.activationId,
        };
      });
    }

    case 'activationSent':
      return updateMatchingActivation(state, action, row => ({ ...row, status: 'drawing' }));

    case 'activationRejected':
      return updateMatchingActivation(state, action, row => ({
        id: row.id,
        status: 'error',
        error: action.reason === 'unsupported' ? 'unsupported' : 'bridge-error',
      }));

    case 'measurementReceived':
      return updateMatchingActivation(
        state,
        {
          rowId: action.payload.rowId,
          activationId: action.payload.activationId,
        },
        row => ({
          id: row.id,
          status: 'ready',
          annotationId: action.payload.annotationId,
          measurement: action.payload.measurement,
        })
      );

    case 'activationCancelled':
    case 'activationReset':
      return updateMatchingActivation(state, action, row => ({
        id: row.id,
        status: 'waiting',
      }));
  }
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
