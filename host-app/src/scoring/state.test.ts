import { initialScoringState, scoringReducer, type ScoringState } from './state';
import { calculateAreaTotals } from './totals';

const viewerCapabilities = {
  measurementDeletion: true,
  measurementFocus: true,
  measurementUpdates: true,
  statePersistence: false,
} as const;

describe('scoringReducer', () => {
  it('adds any number of independent waiting rows', () => {
    const withFirstRow = scoringReducer(initialScoringState, {
      type: 'rowAdded',
      rowId: 'row-1',
      toolName: 'EllipticalROI',
    });
    const withSecondRow = scoringReducer(withFirstRow, {
      type: 'rowAdded',
      rowId: 'row-2',
      toolName: 'Length',
    });

    expect(withSecondRow.rows).toEqual([
      { id: 'row-1', status: 'waiting', toolName: 'EllipticalROI' },
      { id: 'row-2', status: 'waiting', toolName: 'Length' },
    ]);
  });

  it('tracks queued activation until the command is actually sent', () => {
    const withRow = scoringReducer(initialScoringState, {
      type: 'rowAdded',
      rowId: 'row-1',
      toolName: 'EllipticalROI',
    });
    const queued = scoringReducer(withRow, {
      type: 'activationRequested',
      rowId: 'row-1',
      activationId: 'activation-1',
      outcome: 'queued',
    });
    const drawing = scoringReducer(queued, {
      type: 'activationSent',
      rowId: 'row-1',
      activationId: 'activation-1',
    });

    expect(queued.rows[0]).toEqual({
      id: 'row-1',
      status: 'queued',
      activationId: 'activation-1',
      toolName: 'EllipticalROI',
    });
    expect(drawing.rows[0]?.status).toBe('drawing');
  });

  it('allows only one queued or drawing row at a time', () => {
    const withRows = scoringReducer(
      scoringReducer(initialScoringState, {
        type: 'rowAdded',
        rowId: 'row-1',
        toolName: 'EllipticalROI',
      }),
      { type: 'rowAdded', rowId: 'row-2', toolName: 'Length' }
    );
    const firstDrawing = scoringReducer(withRows, {
      type: 'activationRequested',
      rowId: 'row-1',
      activationId: 'activation-1',
      outcome: 'sent',
    });
    const secondAttempt = scoringReducer(firstDrawing, {
      type: 'activationRequested',
      rowId: 'row-2',
      activationId: 'activation-2',
      outcome: 'sent',
    });

    expect(secondAttempt).toBe(firstDrawing);
    expect(secondAttempt.rows[1]?.status).toBe('waiting');
  });

  it('does not reactivate a row that already has a completed measurement', () => {
    const readyState: ScoringState = {
      connection: { status: 'connecting' },
      rows: [
        {
          id: 'row-1',
          toolName: 'EllipticalROI',
          status: 'ready',
          annotationId: 'annotation-1',
          measurement: { kind: 'area', value: 42.75, unit: 'mm2', rawUnit: 'mm²' },
        },
      ],
    };

    const repeatedActivation = scoringReducer(readyState, {
      type: 'activationRequested',
      rowId: 'row-1',
      activationId: 'activation-2',
      outcome: 'sent',
    });

    expect(repeatedActivation).toBe(readyState);
  });

  it('ignores stale activation callbacks and resets only the matching operation', () => {
    const queued = scoringReducer(
      scoringReducer(initialScoringState, {
        type: 'rowAdded',
        rowId: 'row-1',
        toolName: 'EllipticalROI',
      }),
      {
        type: 'activationRequested',
        rowId: 'row-1',
        activationId: 'activation-current',
        outcome: 'queued',
      }
    );
    const staleResult = scoringReducer(queued, {
      type: 'activationSent',
      rowId: 'row-1',
      activationId: 'activation-stale',
    });
    const cancelled = scoringReducer(staleResult, {
      type: 'activationCancelled',
      rowId: 'row-1',
      activationId: 'activation-current',
    });

    expect(staleResult).toBe(queued);
    expect(cancelled.rows[0]).toEqual({
      id: 'row-1',
      status: 'waiting',
      toolName: 'EllipticalROI',
    });
  });

  it('stores a correlated area measurement and completes only the matching row', () => {
    const drawing = scoringReducer(
      scoringReducer(initialScoringState, {
        type: 'rowAdded',
        rowId: 'row-1',
        toolName: 'EllipticalROI',
      }),
      {
        type: 'activationRequested',
        rowId: 'row-1',
        activationId: 'activation-1',
        outcome: 'sent',
      }
    );
    const staleResult = scoringReducer(drawing, {
      type: 'measurementReceived',
      payload: {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        activationId: 'stale-activation',
        annotationId: 'stale-annotation',
        measurement: { kind: 'area', value: 1, unit: 'mm2', rawUnit: 'mm²' },
      },
    });
    const completed = scoringReducer(staleResult, {
      type: 'measurementReceived',
      payload: {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        activationId: 'activation-1',
        annotationId: 'annotation-1',
        measurement: { kind: 'area', value: 42.75, unit: 'mm2', rawUnit: 'mm²' },
      },
    });

    expect(staleResult).toBe(drawing);
    expect(completed.rows[0]).toEqual({
      id: 'row-1',
      status: 'ready',
      annotationId: 'annotation-1',
      measurement: { kind: 'area', value: 42.75, unit: 'mm2', rawUnit: 'mm²' },
      toolName: 'EllipticalROI',
    });
  });

  it('stores only a length measurement in a Length row', () => {
    const drawing = scoringReducer(
      scoringReducer(initialScoringState, {
        type: 'rowAdded',
        rowId: 'row-length',
        toolName: 'Length',
      }),
      {
        type: 'activationRequested',
        rowId: 'row-length',
        activationId: 'activation-length',
        outcome: 'sent',
      }
    );
    const mismatched = scoringReducer(drawing, {
      type: 'measurementReceived',
      payload: {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-length',
        activationId: 'activation-length',
        annotationId: 'annotation-area',
        measurement: { kind: 'area', value: 42, unit: 'mm2', rawUnit: 'mm²' },
      },
    });
    const completed = scoringReducer(drawing, {
      type: 'measurementReceived',
      payload: {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-length',
        activationId: 'activation-length',
        annotationId: 'annotation-length',
        measurement: { kind: 'length', value: 18.5, unit: 'mm', rawUnit: 'mm' },
      },
    });

    expect(mismatched).toBe(drawing);
    expect(completed.rows[0]).toEqual({
      id: 'row-length',
      status: 'ready',
      toolName: 'Length',
      annotationId: 'annotation-length',
      measurement: { kind: 'length', value: 18.5, unit: 'mm', rawUnit: 'mm' },
    });
  });

  it('updates a completed correlated measurement in the current Viewer session', () => {
    const readyState: ScoringState = {
      connection: {
        capabilities: viewerCapabilities,
        status: 'ready',
        viewerInstanceId: 'viewer-1',
        supportedTools: ['EllipticalROI'],
      },
      rows: [
        {
          id: 'row-1',
          toolName: 'EllipticalROI',
          status: 'ready',
          annotationId: 'annotation-1',
          measurement: { kind: 'area', value: 42.75, unit: 'mm2', rawUnit: 'mm²' },
        },
      ],
    };
    const payload = {
      viewerInstanceId: 'viewer-1',
      rowId: 'row-1',
      annotationId: 'annotation-1',
      measurement: { kind: 'area' as const, value: 50.25, unit: 'mm2' as const, rawUnit: 'mm²' },
    };

    const staleSession = scoringReducer(readyState, {
      type: 'measurementUpdated',
      payload: { ...payload, viewerInstanceId: 'viewer-stale' },
    });
    const wrongAnnotation = scoringReducer(readyState, {
      type: 'measurementUpdated',
      payload: { ...payload, annotationId: 'annotation-other' },
    });
    const updated = scoringReducer(readyState, { type: 'measurementUpdated', payload });

    expect(staleSession).toBe(readyState);
    expect(wrongAnnotation).toBe(readyState);
    expect(updated.rows[0]?.measurement?.value).toBe(50.25);
    expect(calculateAreaTotals(updated.rows)).toEqual([
      { key: 'area:mm2', value: 50.25, displayUnit: 'mm²' },
    ]);
  });

  it('removes a host-deleted row only after the Viewer confirms deletion', () => {
    const readyState: ScoringState = {
      connection: {
        capabilities: viewerCapabilities,
        status: 'ready',
        viewerInstanceId: 'viewer-1',
        supportedTools: ['EllipticalROI'],
      },
      rows: [
        {
          id: 'row-1',
          toolName: 'EllipticalROI',
          status: 'ready',
          annotationId: 'annotation-1',
          measurement: { kind: 'area', value: 42.75, unit: 'mm2', rawUnit: 'mm²' },
        },
      ],
    };
    const deleting = scoringReducer(readyState, {
      type: 'deletionRequested',
      rowId: 'row-1',
      annotationId: 'annotation-1',
    });
    const removed = scoringReducer(deleting, {
      type: 'measurementRemoved',
      payload: {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        annotationId: 'annotation-1',
      },
    });

    expect(deleting.rows[0]?.status).toBe('deleting');
    expect(calculateAreaTotals(deleting.rows)[0]?.value).toBe(42.75);
    expect(removed.rows).toEqual([]);
  });

  it('clears a row when its annotation is deleted directly in the Viewer', () => {
    const readyState: ScoringState = {
      connection: {
        capabilities: viewerCapabilities,
        status: 'ready',
        viewerInstanceId: 'viewer-1',
        supportedTools: ['EllipticalROI'],
      },
      rows: [
        {
          id: 'row-1',
          toolName: 'EllipticalROI',
          status: 'ready',
          annotationId: 'annotation-1',
          measurement: { kind: 'area', value: 42.75, unit: 'mm2', rawUnit: 'mm²' },
        },
      ],
    };
    const staleRemoval = scoringReducer(readyState, {
      type: 'measurementRemoved',
      payload: {
        viewerInstanceId: 'stale-viewer',
        rowId: 'row-1',
        annotationId: 'annotation-1',
      },
    });
    const cleared = scoringReducer(readyState, {
      type: 'measurementRemoved',
      payload: {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        annotationId: 'annotation-1',
      },
    });

    expect(staleRemoval).toBe(readyState);
    expect(cleared.rows).toEqual([{ id: 'row-1', status: 'waiting', toolName: 'EllipticalROI' }]);
  });

  it('stores viewer capabilities and exposes unsupported-tool errors', () => {
    const connected = scoringReducer(initialScoringState, {
      type: 'viewerReady',
      payload: {
        viewerInstanceId: 'viewer-1',
        supportedTools: [],
        capabilities: {
          measurementDeletion: false,
          measurementFocus: false,
          measurementUpdates: false,
          statePersistence: false,
        },
      },
    });
    const withRow = scoringReducer(connected, {
      type: 'rowAdded',
      rowId: 'row-1',
      toolName: 'EllipticalROI',
    });
    const rejected = scoringReducer(withRow, {
      type: 'activationRequested',
      rowId: 'row-1',
      activationId: 'activation-1',
      outcome: 'unsupported',
    });

    expect(connected.connection).toEqual({
      capabilities: {
        measurementDeletion: false,
        measurementFocus: false,
        measurementUpdates: false,
        statePersistence: false,
      },
      status: 'ready',
      viewerInstanceId: 'viewer-1',
      supportedTools: [],
    });
    expect(rejected.rows[0]).toEqual({
      id: 'row-1',
      status: 'error',
      error: 'unsupported',
      toolName: 'EllipticalROI',
    });
  });

  it('exposes bridge failures as retryable row errors', () => {
    const withRow = scoringReducer(initialScoringState, {
      type: 'rowAdded',
      rowId: 'row-1',
      toolName: 'EllipticalROI',
    });

    const rejected = scoringReducer(withRow, {
      type: 'activationRequested',
      rowId: 'row-1',
      activationId: 'activation-1',
      outcome: 'error',
    });

    expect(rejected.rows[0]).toEqual({
      id: 'row-1',
      status: 'error',
      error: 'bridge-error',
      toolName: 'EllipticalROI',
    });
  });

  it.each([
    ['unsupported', 'unsupported'],
    ['error', 'bridge-error'],
  ] as const)('records an %s rejection for the matching activation', (reason, expectedError) => {
    const drawing = scoringReducer(
      scoringReducer(initialScoringState, {
        type: 'rowAdded',
        rowId: 'row-1',
        toolName: 'EllipticalROI',
      }),
      {
        type: 'activationRequested',
        rowId: 'row-1',
        activationId: 'activation-1',
        outcome: 'sent',
      }
    );

    const rejected = scoringReducer(drawing, {
      type: 'activationRejected',
      rowId: 'row-1',
      activationId: 'activation-1',
      reason,
    });

    expect(rejected.rows[0]).toEqual({
      id: 'row-1',
      status: 'error',
      error: expectedError,
      toolName: 'EllipticalROI',
    });
  });

  it('keeps completed bindings pending while a persistent Viewer reloads', () => {
    const readyState = {
      connection: {
        capabilities: { ...viewerCapabilities, statePersistence: true },
        status: 'ready' as const,
        viewerInstanceId: 'viewer-1',
        supportedTools: ['EllipticalROI' as const],
      },
      rows: [
        {
          id: 'row-1',
          toolName: 'EllipticalROI' as const,
          status: 'ready' as const,
          annotationId: 'annotation-1',
          measurement: { kind: 'area' as const, value: 42, unit: 'mm2' as const, rawUnit: 'mm²' },
        },
        { id: 'row-2', status: 'waiting' as const, toolName: 'Length' as const },
      ],
    };

    const loading = scoringReducer(readyState, { type: 'viewerLoading' });

    expect(loading.connection).toEqual({ status: 'connecting' });
    expect(loading.rows).toEqual([
      {
        id: 'row-1',
        status: 'restoring',
        annotationId: 'annotation-1',
        measurement: { kind: 'area', value: 42, unit: 'mm2', rawUnit: 'mm²' },
        toolName: 'EllipticalROI',
      },
      { id: 'row-2', status: 'waiting', toolName: 'Length' },
    ]);
  });

  it('keeps a queued pre-handshake activation while the iframe starts loading', () => {
    const queued: ScoringState = {
      connection: { status: 'connecting' },
      rows: [
        {
          id: 'row-1',
          status: 'queued',
          activationId: 'activation-1',
          toolName: 'EllipticalROI',
        },
      ],
    };

    expect(scoringReducer(queued, { type: 'viewerLoading' }).rows).toEqual(queued.rows);
  });

  it('accepts matching restoration confirmations and resets missing annotations', () => {
    const state: ScoringState = {
      connection: {
        capabilities: { ...viewerCapabilities, statePersistence: true },
        status: 'ready',
        viewerInstanceId: 'viewer-2',
        supportedTools: ['EllipticalROI', 'Length'],
      },
      rows: [
        {
          id: 'row-1',
          status: 'restoring',
          annotationId: 'annotation-1',
          toolName: 'EllipticalROI',
          measurement: { kind: 'area', value: 40, unit: 'mm2', rawUnit: 'mm²' },
        },
        {
          id: 'row-2',
          status: 'restoring',
          annotationId: 'annotation-2',
          toolName: 'Length',
          measurement: { kind: 'length', value: 10, unit: 'mm', rawUnit: 'mm' },
        },
      ],
    };

    const restored = scoringReducer(state, {
      type: 'measurementsRestored',
      payload: {
        viewerInstanceId: 'viewer-2',
        measurements: [
          {
            annotationId: 'annotation-1',
            rowId: 'row-1',
            toolName: 'EllipticalROI',
            measurement: { kind: 'area', value: 42, unit: 'mm2', rawUnit: 'mm²' },
          },
        ],
      },
    });

    expect(restored.rows).toEqual([
      {
        id: 'row-1',
        status: 'ready',
        annotationId: 'annotation-1',
        toolName: 'EllipticalROI',
        measurement: { kind: 'area', value: 42, unit: 'mm2', rawUnit: 'mm²' },
      },
      { id: 'row-2', status: 'waiting', toolName: 'Length' },
    ]);
  });

  it('also clears completed bindings when a new session arrives without a load callback', () => {
    const connected = scoringReducer(initialScoringState, {
      type: 'viewerReady',
      payload: {
        viewerInstanceId: 'viewer-1',
        supportedTools: ['EllipticalROI'],
        capabilities: {
          measurementDeletion: false,
          measurementFocus: false,
          measurementUpdates: false,
          statePersistence: false,
        },
      },
    });
    const stateWithCompletedRow = {
      ...connected,
      rows: [
        {
          id: 'row-1',
          toolName: 'EllipticalROI' as const,
          status: 'ready' as const,
          annotationId: 'annotation-1',
          measurement: { kind: 'area' as const, value: 42, unit: 'mm2' as const, rawUnit: 'mm²' },
        },
      ],
    };

    const nextSession = scoringReducer(stateWithCompletedRow, {
      type: 'viewerReady',
      payload: {
        viewerInstanceId: 'viewer-2',
        supportedTools: ['EllipticalROI'],
        capabilities: {
          measurementDeletion: false,
          measurementFocus: false,
          measurementUpdates: false,
          statePersistence: false,
        },
      },
    });

    expect(nextSession.rows).toEqual([
      { id: 'row-1', status: 'waiting', toolName: 'EllipticalROI' },
    ]);
  });
});
