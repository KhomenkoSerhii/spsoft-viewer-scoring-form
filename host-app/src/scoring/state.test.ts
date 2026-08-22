import { initialScoringState, scoringReducer, type ScoringState } from './state';
import { calculateAreaTotals } from './totals';

describe('scoringReducer', () => {
  it('adds any number of independent waiting rows', () => {
    const withFirstRow = scoringReducer(initialScoringState, {
      type: 'rowAdded',
      rowId: 'row-1',
    });
    const withSecondRow = scoringReducer(withFirstRow, {
      type: 'rowAdded',
      rowId: 'row-2',
    });

    expect(withSecondRow.rows).toEqual([
      { id: 'row-1', status: 'waiting' },
      { id: 'row-2', status: 'waiting' },
    ]);
  });

  it('tracks queued activation until the command is actually sent', () => {
    const withRow = scoringReducer(initialScoringState, { type: 'rowAdded', rowId: 'row-1' });
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
    });
    expect(drawing.rows[0]?.status).toBe('drawing');
  });

  it('allows only one queued or drawing row at a time', () => {
    const withRows = scoringReducer(
      scoringReducer(initialScoringState, { type: 'rowAdded', rowId: 'row-1' }),
      { type: 'rowAdded', rowId: 'row-2' }
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
      scoringReducer(initialScoringState, { type: 'rowAdded', rowId: 'row-1' }),
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
    expect(cancelled.rows[0]).toEqual({ id: 'row-1', status: 'waiting' });
  });

  it('stores a correlated area measurement and completes only the matching row', () => {
    const drawing = scoringReducer(
      scoringReducer(initialScoringState, { type: 'rowAdded', rowId: 'row-1' }),
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
    });
  });

  it('updates a completed correlated measurement in the current Viewer session', () => {
    const readyState: ScoringState = {
      connection: {
        status: 'ready',
        viewerInstanceId: 'viewer-1',
        supportedTools: ['EllipticalROI'],
      },
      rows: [
        {
          id: 'row-1',
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

  it('stores viewer capabilities and exposes unsupported-tool errors', () => {
    const connected = scoringReducer(initialScoringState, {
      type: 'viewerReady',
      payload: {
        viewerInstanceId: 'viewer-1',
        supportedTools: [],
        capabilities: { measurementUpdates: false },
      },
    });
    const withRow = scoringReducer(connected, { type: 'rowAdded', rowId: 'row-1' });
    const rejected = scoringReducer(withRow, {
      type: 'activationRequested',
      rowId: 'row-1',
      activationId: 'activation-1',
      outcome: 'unsupported',
    });

    expect(connected.connection).toEqual({
      status: 'ready',
      viewerInstanceId: 'viewer-1',
      supportedTools: [],
    });
    expect(rejected.rows[0]).toEqual({
      id: 'row-1',
      status: 'error',
      error: 'unsupported',
    });
  });

  it('exposes bridge failures as retryable row errors', () => {
    const withRow = scoringReducer(initialScoringState, { type: 'rowAdded', rowId: 'row-1' });

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
    });
  });

  it.each([
    ['unsupported', 'unsupported'],
    ['error', 'bridge-error'],
  ] as const)('records an %s rejection for the matching activation', (reason, expectedError) => {
    const drawing = scoringReducer(
      scoringReducer(initialScoringState, { type: 'rowAdded', rowId: 'row-1' }),
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
    });
  });

  it('clears completed bindings while the viewer reloads', () => {
    const readyState = {
      connection: {
        status: 'ready' as const,
        viewerInstanceId: 'viewer-1',
        supportedTools: ['EllipticalROI' as const],
      },
      rows: [
        {
          id: 'row-1',
          status: 'ready' as const,
          annotationId: 'annotation-1',
          measurement: { kind: 'area' as const, value: 42, unit: 'mm2' as const, rawUnit: 'mm²' },
        },
        { id: 'row-2', status: 'waiting' as const },
      ],
    };

    const loading = scoringReducer(readyState, { type: 'viewerLoading' });

    expect(loading.connection).toEqual({ status: 'connecting' });
    expect(loading.rows).toEqual([
      { id: 'row-1', status: 'waiting' },
      { id: 'row-2', status: 'waiting' },
    ]);
  });

  it('also clears completed bindings when a new session arrives without a load callback', () => {
    const connected = scoringReducer(initialScoringState, {
      type: 'viewerReady',
      payload: {
        viewerInstanceId: 'viewer-1',
        supportedTools: ['EllipticalROI'],
        capabilities: { measurementUpdates: false },
      },
    });
    const stateWithCompletedRow = {
      ...connected,
      rows: [
        {
          id: 'row-1',
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
        capabilities: { measurementUpdates: false },
      },
    });

    expect(nextSession.rows).toEqual([{ id: 'row-1', status: 'waiting' }]);
  });
});
