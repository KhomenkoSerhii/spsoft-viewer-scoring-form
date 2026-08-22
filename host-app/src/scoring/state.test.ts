import { initialScoringState, scoringReducer } from './state';

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
});
