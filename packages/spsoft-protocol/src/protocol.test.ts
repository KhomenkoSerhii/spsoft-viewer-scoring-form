import {
  BRIDGE_CHANNEL,
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_VERSION,
  createAreaMeasurement,
  createBridgeMessage,
  createLengthMeasurement,
  isHostToViewerMessage,
  isViewerToHostMessage,
  measurementMatchesTool,
  parseBridgeMessage,
} from './index';

const areaMeasurement = createAreaMeasurement(42.25, 'mm² ERMF');
const lengthMeasurement = createLengthMeasurement(18.5, 'mm');

describe('createBridgeMessage', () => {
  it('creates a versioned message envelope', () => {
    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
      {
        targetViewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        activationId: 'activation-1',
        toolName: 'EllipticalROI',
      },
      'message-1'
    );

    expect(message).toEqual({
      channel: BRIDGE_CHANNEL,
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
      messageId: 'message-1',
      payload: {
        targetViewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        activationId: 'activation-1',
        toolName: 'EllipticalROI',
      },
    });
  });
});

describe('parseBridgeMessage', () => {
  it.each([
    createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.VIEWER_READY,
      {
        viewerInstanceId: 'viewer-1',
        supportedTools: ['EllipticalROI'],
        capabilities: {
          measurementDeletion: true,
          measurementFocus: true,
          measurementUpdates: true,
          statePersistence: false,
        },
      },
      'message-ready'
    ),
    createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
      {
        targetViewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        activationId: 'activation-1',
        toolName: 'EllipticalROI',
      },
      'message-activate'
    ),
    createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.DEACTIVATE_TOOL,
      {
        targetViewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        activationId: 'activation-1',
        reason: 'user-cancelled',
      },
      'message-deactivate'
    ),
    createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.FOCUS_MEASUREMENT,
      {
        targetViewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        annotationId: 'annotation-1',
      },
      'message-focus'
    ),
    createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT,
      {
        targetViewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        annotationId: 'annotation-1',
      },
      'message-remove'
    ),
    createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.RESTORE_MEASUREMENTS,
      {
        targetViewerInstanceId: 'viewer-1',
        measurements: [{ annotationId: 'annotation-1', rowId: 'row-1', toolName: 'EllipticalROI' }],
      },
      'message-restore'
    ),
    createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED,
      {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        activationId: 'activation-1',
        annotationId: 'annotation-1',
        measurement: areaMeasurement,
      },
      'message-added'
    ),
    createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENT_UPDATED,
      {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        annotationId: 'annotation-1',
        measurement: areaMeasurement,
      },
      'message-updated'
    ),
    createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED,
      {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-length',
        activationId: 'activation-length',
        annotationId: 'annotation-length',
        measurement: lengthMeasurement,
      },
      'message-length-added'
    ),
    createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENT_REMOVED,
      {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        annotationId: 'annotation-1',
      },
      'message-removed'
    ),
    createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENTS_RESTORED,
      {
        viewerInstanceId: 'viewer-1',
        measurements: [
          {
            annotationId: 'annotation-1',
            rowId: 'row-1',
            toolName: 'EllipticalROI',
            measurement: areaMeasurement,
          },
        ],
      },
      'message-restored'
    ),
  ])('accepts $type', message => {
    expect(parseBridgeMessage(message)).toEqual(message);
  });

  it('defaults omitted additive capabilities to false', () => {
    expect(
      parseBridgeMessage({
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.VIEWER_READY,
        messageId: 'message-ready-without-focus',
        payload: {
          viewerInstanceId: 'viewer-1',
          supportedTools: ['EllipticalROI'],
          capabilities: {
            measurementDeletion: true,
            measurementUpdates: true,
          },
        },
      })
    ).toEqual({
      channel: BRIDGE_CHANNEL,
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.VIEWER_READY,
      messageId: 'message-ready-without-focus',
      payload: {
        viewerInstanceId: 'viewer-1',
        supportedTools: ['EllipticalROI'],
        capabilities: {
          measurementDeletion: true,
          measurementFocus: false,
          measurementUpdates: true,
          statePersistence: false,
        },
      },
    });
  });

  it('rejects duplicate and mismatched restoration entries', () => {
    const duplicateBindings = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.RESTORE_MEASUREMENTS,
      {
        targetViewerInstanceId: 'viewer-1',
        measurements: [
          { annotationId: 'annotation-1', rowId: 'row-1', toolName: 'EllipticalROI' },
          { annotationId: 'annotation-1', rowId: 'row-2', toolName: 'EllipticalROI' },
        ],
      },
      'duplicate-bindings'
    );
    const mismatchedMeasurement = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENTS_RESTORED,
      {
        viewerInstanceId: 'viewer-1',
        measurements: [
          {
            annotationId: 'annotation-1',
            rowId: 'row-1',
            toolName: 'Length',
            measurement: areaMeasurement,
          },
        ],
      },
      'mismatched-measurement'
    );

    expect(parseBridgeMessage(duplicateBindings)).toBeNull();
    expect(parseBridgeMessage(mismatchedMeasurement)).toBeNull();
  });

  it('rejects a non-boolean focus capability', () => {
    expect(
      parseBridgeMessage({
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.VIEWER_READY,
        messageId: 'message-ready-with-invalid-focus',
        payload: {
          viewerInstanceId: 'viewer-1',
          supportedTools: ['EllipticalROI'],
          capabilities: {
            measurementDeletion: true,
            measurementFocus: 'true',
            measurementUpdates: true,
          },
        },
      })
    ).toBeNull();
  });

  it.each([
    ['channel', { channel: 'foreign.channel' }],
    ['version', { version: 2 }],
    ['type', { type: 'UNKNOWN_MESSAGE' }],
    ['messageId', { messageId: '' }],
    ['payload', { payload: null }],
  ])('rejects an invalid %s', (_field, override) => {
    const validMessage = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.VIEWER_READY,
      {
        viewerInstanceId: 'viewer-1',
        supportedTools: ['EllipticalROI'],
        capabilities: {
          measurementDeletion: false,
          measurementFocus: false,
          measurementUpdates: false,
          statePersistence: false,
        },
      },
      'message-1'
    );

    expect(parseBridgeMessage({ ...validMessage, ...override })).toBeNull();
  });

  it('rejects an unsupported tool', () => {
    expect(
      parseBridgeMessage({
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        messageId: 'message-1',
        payload: {
          targetViewerInstanceId: 'viewer-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          toolName: 'RectangleROI',
        },
      })
    ).toBeNull();
  });

  it('accepts Length as a supported activation tool', () => {
    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
      {
        targetViewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        activationId: 'activation-1',
        toolName: 'Length',
      },
      'message-length-activation'
    );

    expect(parseBridgeMessage(message)).toEqual(message);
  });

  it('rejects a deactivation reason that cannot be handled by the current viewer instance', () => {
    expect(
      parseBridgeMessage({
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.DEACTIVATE_TOOL,
        messageId: 'message-1',
        payload: {
          targetViewerInstanceId: 'viewer-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          reason: 'viewer-reloaded',
        },
      })
    ).toBeNull();
  });

  it('rejects a focus command without complete correlation identifiers', () => {
    expect(
      parseBridgeMessage({
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.FOCUS_MEASUREMENT,
        messageId: 'message-1',
        payload: {
          targetViewerInstanceId: 'viewer-1',
          rowId: 'row-1',
          annotationId: '',
        },
      })
    ).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects an invalid area value: %s',
    value => {
      expect(
        parseBridgeMessage({
          channel: BRIDGE_CHANNEL,
          version: BRIDGE_VERSION,
          type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED,
          messageId: 'message-1',
          payload: {
            viewerInstanceId: 'viewer-1',
            rowId: 'row-1',
            activationId: 'activation-1',
            annotationId: 'annotation-1',
            measurement: { ...areaMeasurement, value },
          },
        })
      ).toBeNull();
    }
  );

  it.each([
    ['unsupported canonical unit', { ...areaMeasurement, unit: 'm2' }],
    ['canonical unit inconsistent with raw unit', { ...areaMeasurement, unit: 'px2' }],
    ['empty raw unit', { ...areaMeasurement, rawUnit: ' ' }],
    ['empty calibration type', { ...areaMeasurement, calibrationType: '' }],
  ])('rejects an area measurement with %s', (_caseName, measurement) => {
    expect(
      parseBridgeMessage({
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_UPDATED,
        messageId: 'message-1',
        payload: {
          viewerInstanceId: 'viewer-1',
          rowId: 'row-1',
          annotationId: 'annotation-1',
          measurement,
        },
      })
    ).toBeNull();
  });

  it.each([
    ['unsupported canonical unit', { ...lengthMeasurement, unit: 'm' }],
    ['canonical unit inconsistent with raw unit', { ...lengthMeasurement, unit: 'px' }],
    ['empty raw unit', { ...lengthMeasurement, rawUnit: ' ' }],
    ['empty calibration type', { ...lengthMeasurement, calibrationType: '' }],
  ])('rejects a length measurement with %s', (_caseName, measurement) => {
    expect(
      parseBridgeMessage({
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_UPDATED,
        messageId: 'message-length-invalid',
        payload: {
          viewerInstanceId: 'viewer-1',
          rowId: 'row-length',
          annotationId: 'annotation-length',
          measurement,
        },
      })
    ).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects an invalid length value: %s',
    value => {
      expect(
        parseBridgeMessage({
          channel: BRIDGE_CHANNEL,
          version: BRIDGE_VERSION,
          type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED,
          messageId: 'message-length-invalid-value',
          payload: {
            viewerInstanceId: 'viewer-1',
            rowId: 'row-length',
            activationId: 'activation-length',
            annotationId: 'annotation-length',
            measurement: { ...lengthMeasurement, value },
          },
        })
      ).toBeNull();
    }
  );

  it('returns a sanitized copy without unrecognized fields', () => {
    const validMessage = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED,
      {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        activationId: 'activation-1',
        annotationId: 'annotation-1',
        measurement: areaMeasurement,
      },
      'message-1'
    );

    expect(
      parseBridgeMessage({
        ...validMessage,
        untrustedEnvelopeField: 'discard me',
        payload: {
          ...validMessage.payload,
          untrustedPayloadField: 'discard me',
          measurement: {
            ...validMessage.payload.measurement,
            untrustedMeasurementField: 'discard me',
          },
        },
      })
    ).toEqual(validMessage);
  });
});

describe('message direction guards', () => {
  it('distinguishes host commands from viewer events', () => {
    const hostCommand = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.FOCUS_MEASUREMENT,
      {
        targetViewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        annotationId: 'annotation-1',
      },
      'message-host'
    );
    const viewerEvent = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENT_REMOVED,
      {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        annotationId: 'annotation-1',
      },
      'message-viewer'
    );

    expect(isHostToViewerMessage(hostCommand)).toBe(true);
    expect(isViewerToHostMessage(hostCommand)).toBe(false);
    expect(isHostToViewerMessage(viewerEvent)).toBe(false);
    expect(isViewerToHostMessage(viewerEvent)).toBe(true);
  });
});

describe('measurementMatchesTool', () => {
  it('keeps each measurement kind bound to its OHIF tool', () => {
    expect(measurementMatchesTool(areaMeasurement, 'EllipticalROI')).toBe(true);
    expect(measurementMatchesTool(areaMeasurement, 'Length')).toBe(false);
    expect(measurementMatchesTool(lengthMeasurement, 'Length')).toBe(true);
    expect(measurementMatchesTool(lengthMeasurement, 'EllipticalROI')).toBe(false);
  });
});
