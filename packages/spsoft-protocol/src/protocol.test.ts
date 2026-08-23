import {
  BRIDGE_CHANNEL,
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_VERSION,
  createAreaMeasurement,
  createBridgeMessage,
  isHostToViewerMessage,
  isViewerToHostMessage,
  parseBridgeMessage,
} from './index';

const areaMeasurement = createAreaMeasurement(42.25, 'mm² ERMF');

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
      BRIDGE_MESSAGE_TYPES.MEASUREMENT_REMOVED,
      {
        viewerInstanceId: 'viewer-1',
        rowId: 'row-1',
        annotationId: 'annotation-1',
      },
      'message-removed'
    ),
  ])('accepts $type', message => {
    expect(parseBridgeMessage(message)).toEqual(message);
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
