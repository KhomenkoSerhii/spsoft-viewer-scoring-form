import {
  BRIDGE_MESSAGE_TYPES,
  createBridgeMessage,
  parseBridgeMessage,
} from '@spsoft/viewer-protocol';

import {
  HostBridgeController,
  type ActivationRequest,
  type HostMessageWindow,
  type ViewerMessageWindow,
} from './HostBridgeController';

class FakeHostWindow implements HostMessageWindow {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }

  dispatch(data: unknown, origin: string, source: ViewerMessageWindow): void {
    const event = { data, origin, source } as unknown as MessageEvent<unknown>;
    this.listeners.forEach(listener => listener(event));
  }

  getListenerCount(): number {
    return this.listeners.size;
  }
}

class FakeViewerWindow implements ViewerMessageWindow {
  readonly postedMessages: Array<{ message: unknown; targetOrigin: string }> = [];
  throwOnPostMessage = false;

  postMessage(message: unknown, targetOrigin: string): void {
    if (this.throwOnPostMessage) {
      throw new Error('The Viewer iframe is unavailable.');
    }

    this.postedMessages.push({ message, targetOrigin });
  }
}

function createHarness() {
  const hostWindow = new FakeHostWindow();
  const viewerWindow = new FakeViewerWindow();
  const ids = ['activate-message', 'deactivate-message', 'dispose-message'];
  const callbacks = {
    onActivationRejected: jest.fn(),
    onActivationReset: jest.fn(),
    onActivationSent: jest.fn(),
    onMeasurementAdded: jest.fn(),
    onMeasurementRemoved: jest.fn(),
    onMeasurementUpdated: jest.fn(),
    onViewerLoading: jest.fn(),
    onViewerReady: jest.fn(),
  };
  const controller = new HostBridgeController({
    callbacks,
    createId: () => ids.shift() ?? 'fallback-message',
    getViewerWindow: () => viewerWindow,
    hostWindow,
    viewerOrigin: 'http://localhost:3000',
  });
  const activation: ActivationRequest = {
    rowId: 'row-1',
    activationId: 'activation-1',
    toolName: 'EllipticalROI',
  };
  const announceReady = ({
    measurementDeletion = true,
    source = viewerWindow,
    supportedTools = ['EllipticalROI'] as const,
    viewerInstanceId = 'viewer-1',
  }: {
    measurementDeletion?: boolean;
    source?: ViewerMessageWindow;
    supportedTools?: readonly ['EllipticalROI'] | readonly [];
    viewerInstanceId?: string;
  } = {}) => {
    hostWindow.dispatch(
      createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.VIEWER_READY,
        {
          viewerInstanceId,
          supportedTools: [...supportedTools],
          capabilities: { measurementDeletion, measurementUpdates: true },
        },
        `ready-${viewerInstanceId}`
      ),
      'http://localhost:3000',
      source
    );
  };

  const dispatchMeasurement = ({
    activationId = 'activation-1',
    annotationId = 'annotation-1',
    messageId = 'measurement-message',
    rowId = 'row-1',
    viewerInstanceId = 'viewer-1',
  }: {
    activationId?: string;
    annotationId?: string;
    messageId?: string;
    rowId?: string;
    viewerInstanceId?: string;
  } = {}) => {
    const payload = {
      viewerInstanceId,
      rowId,
      activationId,
      annotationId,
      measurement: {
        kind: 'area' as const,
        value: 42.75,
        unit: 'mm2' as const,
        rawUnit: 'mm²',
      },
    };
    hostWindow.dispatch(
      createBridgeMessage(BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED, payload, messageId),
      'http://localhost:3000',
      viewerWindow
    );
    return payload;
  };

  const dispatchMeasurementUpdate = ({
    annotationId = 'annotation-1',
    messageId = 'measurement-update-message',
    rowId = 'row-1',
    value = 50.25,
    viewerInstanceId = 'viewer-1',
  }: {
    annotationId?: string;
    messageId?: string;
    rowId?: string;
    value?: number;
    viewerInstanceId?: string;
  } = {}) => {
    const payload = {
      viewerInstanceId,
      rowId,
      annotationId,
      measurement: {
        kind: 'area' as const,
        value,
        unit: 'mm2' as const,
        rawUnit: 'mm²',
      },
    };
    hostWindow.dispatch(
      createBridgeMessage(BRIDGE_MESSAGE_TYPES.MEASUREMENT_UPDATED, payload, messageId),
      'http://localhost:3000',
      viewerWindow
    );
    return payload;
  };

  const dispatchMeasurementRemoval = ({
    annotationId = 'annotation-1',
    messageId = 'measurement-removed-message',
    rowId = 'row-1',
    viewerInstanceId = 'viewer-1',
  }: {
    annotationId?: string;
    messageId?: string;
    rowId?: string;
    viewerInstanceId?: string;
  } = {}) => {
    const payload = { viewerInstanceId, rowId, annotationId };
    hostWindow.dispatch(
      createBridgeMessage(BRIDGE_MESSAGE_TYPES.MEASUREMENT_REMOVED, payload, messageId),
      'http://localhost:3000',
      viewerWindow
    );
    return payload;
  };

  return {
    activation,
    announceReady,
    callbacks,
    controller,
    dispatchMeasurement,
    dispatchMeasurementRemoval,
    dispatchMeasurementUpdate,
    hostWindow,
    viewerWindow,
  };
}

describe('HostBridgeController', () => {
  it('accepts VIEWER_READY only from the configured iframe and origin', () => {
    const { announceReady, callbacks, controller, hostWindow } = createHarness();
    controller.install();

    hostWindow.dispatch(
      createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.VIEWER_READY,
        {
          viewerInstanceId: 'attacker',
          supportedTools: ['EllipticalROI'],
          capabilities: { measurementDeletion: false, measurementUpdates: false },
        },
        'attacker-message'
      ),
      'https://attacker.example',
      new FakeViewerWindow()
    );
    announceReady({ source: new FakeViewerWindow() });
    announceReady();

    expect(callbacks.onViewerReady).toHaveBeenCalledTimes(1);
    expect(callbacks.onViewerReady).toHaveBeenCalledWith(
      expect.objectContaining({ viewerInstanceId: 'viewer-1' })
    );
  });

  it('queues activation before handshake and flushes it after VIEWER_READY', () => {
    const { activation, announceReady, callbacks, controller, viewerWindow } = createHarness();
    controller.install();

    expect(controller.activate(activation)).toBe('queued');
    expect(viewerWindow.postedMessages).toHaveLength(0);

    announceReady();

    expect(callbacks.onActivationSent).toHaveBeenCalledWith(activation);
    expect(viewerWindow.postedMessages).toHaveLength(1);
    expect(parseBridgeMessage(viewerWindow.postedMessages[0]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        payload: {
          targetViewerInstanceId: 'viewer-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          toolName: 'EllipticalROI',
        },
      })
    );
  });

  it('cancels a queued activation without sending a stale command later', () => {
    const { activation, announceReady, callbacks, controller, viewerWindow } = createHarness();
    controller.install();

    expect(controller.activate(activation)).toBe('queued');
    controller.cancel(activation);
    announceReady();

    expect(viewerWindow.postedMessages).toHaveLength(0);
    expect(callbacks.onActivationSent).not.toHaveBeenCalled();
  });

  it('sends activation immediately after handshake and sends cancellation for it', () => {
    const { activation, announceReady, controller, viewerWindow } = createHarness();
    controller.install();
    announceReady();

    expect(controller.activate(activation)).toBe('sent');
    controller.cancel(activation);

    expect(viewerWindow.postedMessages).toHaveLength(2);
    expect(parseBridgeMessage(viewerWindow.postedMessages[1]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.DEACTIVATE_TOOL,
        payload: expect.objectContaining({
          targetViewerInstanceId: 'viewer-1',
          reason: 'user-cancelled',
        }),
      })
    );
  });

  it('rejects a queued activation when the mode does not support EllipticalROI', () => {
    const { activation, announceReady, callbacks, controller, viewerWindow } = createHarness();
    controller.install();

    expect(controller.activate(activation)).toBe('queued');
    announceReady({ supportedTools: [] });

    expect(callbacks.onActivationRejected).toHaveBeenCalledWith(activation, 'unsupported');
    expect(viewerWindow.postedMessages).toHaveLength(0);
  });

  it('returns unsupported without posting when the ready Viewer lacks EllipticalROI', () => {
    const { activation, announceReady, controller, viewerWindow } = createHarness();
    controller.install();
    announceReady({ supportedTools: [] });

    expect(controller.activate(activation)).toBe('unsupported');
    expect(viewerWindow.postedMessages).toHaveLength(0);
  });

  it('reports an immediate activation error when the Viewer command cannot be posted', () => {
    const { activation, announceReady, controller, viewerWindow } = createHarness();
    controller.install();
    announceReady();
    viewerWindow.throwOnPostMessage = true;

    expect(controller.activate(activation)).toBe('error');
    expect(viewerWindow.postedMessages).toHaveLength(0);
  });

  it('rejects a queued activation when the Viewer disappears before handshake flush', () => {
    const { activation, announceReady, callbacks, controller, viewerWindow } = createHarness();
    controller.install();

    expect(controller.activate(activation)).toBe('queued');
    viewerWindow.throwOnPostMessage = true;
    announceReady();

    expect(callbacks.onActivationRejected).toHaveBeenCalledWith(activation, 'error');
    expect(callbacks.onActivationSent).not.toHaveBeenCalled();
  });

  it('resets an active row when Viewer announces a new session', () => {
    const { activation, announceReady, callbacks, controller } = createHarness();
    controller.install();
    announceReady();
    controller.activate(activation);

    announceReady({ viewerInstanceId: 'viewer-2' });

    expect(callbacks.onActivationReset).toHaveBeenCalledWith(activation);
  });

  it('invalidates the current session while the iframe reloads', () => {
    const { activation, announceReady, callbacks, controller } = createHarness();
    controller.install();
    announceReady();
    controller.activate(activation);

    controller.notifyViewerLoading();

    expect(callbacks.onActivationReset).toHaveBeenCalledWith(activation);
    expect(callbacks.onViewerLoading).toHaveBeenCalledTimes(1);
    expect(controller.activate({ ...activation, activationId: 'activation-2' })).toBe('queued');
  });

  it('accepts one measurement matching the active Viewer session and activation', () => {
    const { activation, announceReady, callbacks, controller, dispatchMeasurement } =
      createHarness();
    controller.install();
    announceReady();
    controller.activate(activation);

    const payload = dispatchMeasurement();
    dispatchMeasurement();

    expect(callbacks.onMeasurementAdded).toHaveBeenCalledTimes(1);
    expect(callbacks.onMeasurementAdded).toHaveBeenCalledWith(payload);
    expect(controller.activate({ ...activation, activationId: 'activation-2' })).toBe('sent');
  });

  it('ignores measurements with stale session or correlation identifiers', () => {
    const { activation, announceReady, callbacks, controller, dispatchMeasurement } =
      createHarness();
    controller.install();
    announceReady();
    controller.activate(activation);

    dispatchMeasurement({ viewerInstanceId: 'stale-viewer' });
    dispatchMeasurement({ rowId: 'stale-row' });
    dispatchMeasurement({ activationId: 'stale-activation' });

    expect(callbacks.onMeasurementAdded).not.toHaveBeenCalled();
    expect(controller.activate({ ...activation, activationId: 'activation-2' })).toBe('busy');
  });

  it('rejects repeated message and annotation identifiers across activations', () => {
    const { activation, announceReady, callbacks, controller, dispatchMeasurement } =
      createHarness();
    controller.install();
    announceReady();
    controller.activate(activation);
    dispatchMeasurement();

    const secondActivation = { ...activation, activationId: 'activation-2' };
    expect(controller.activate(secondActivation)).toBe('sent');
    dispatchMeasurement({ activationId: 'activation-2', messageId: 'measurement-message-2' });
    dispatchMeasurement({
      activationId: 'activation-2',
      annotationId: 'annotation-2',
      messageId: 'measurement-message',
    });

    expect(callbacks.onMeasurementAdded).toHaveBeenCalledTimes(1);
    expect(controller.activate({ ...activation, activationId: 'activation-3' })).toBe('busy');

    dispatchMeasurement({
      activationId: 'activation-2',
      annotationId: 'annotation-2',
      messageId: 'measurement-message-2',
    });

    expect(callbacks.onMeasurementAdded).toHaveBeenCalledTimes(2);
  });

  it('accepts live updates only for the current correlated annotation and session', () => {
    const {
      activation,
      announceReady,
      callbacks,
      controller,
      dispatchMeasurement,
      dispatchMeasurementUpdate,
    } = createHarness();
    controller.install();
    announceReady();
    controller.activate(activation);
    dispatchMeasurement();

    dispatchMeasurementUpdate({ viewerInstanceId: 'stale-viewer' });
    dispatchMeasurementUpdate({ rowId: 'other-row' });
    dispatchMeasurementUpdate({ annotationId: 'other-annotation' });
    const payload = dispatchMeasurementUpdate();
    dispatchMeasurementUpdate();

    expect(callbacks.onMeasurementUpdated).toHaveBeenCalledTimes(1);
    expect(callbacks.onMeasurementUpdated).toHaveBeenCalledWith(payload);
  });

  it('bounds duplicate tracking to the most recent message identifiers', () => {
    const {
      activation,
      announceReady,
      callbacks,
      controller,
      dispatchMeasurement,
      dispatchMeasurementUpdate,
    } = createHarness();
    controller.install();
    announceReady();
    controller.activate(activation);
    dispatchMeasurement();

    for (let index = 0; index <= 1_000; index += 1) {
      dispatchMeasurementUpdate({ messageId: `measurement-update-${index}`, value: index });
    }

    expect(callbacks.onMeasurementUpdated).toHaveBeenCalledTimes(1_001);

    dispatchMeasurementUpdate({ messageId: 'measurement-update-0', value: 0 });
    dispatchMeasurementUpdate({ messageId: 'measurement-update-1000', value: 1_000 });

    expect(callbacks.onMeasurementUpdated).toHaveBeenCalledTimes(1_002);
  });

  it('requests deletion and accepts one correlated removal confirmation', () => {
    const {
      activation,
      announceReady,
      callbacks,
      controller,
      dispatchMeasurement,
      dispatchMeasurementRemoval,
      viewerWindow,
    } = createHarness();
    controller.install();
    announceReady();
    controller.activate(activation);
    dispatchMeasurement();

    const request = { rowId: 'row-1', annotationId: 'annotation-1' };
    expect(controller.removeMeasurement(request)).toBe('sent');
    expect(controller.removeMeasurement(request)).toBe('error');
    expect(parseBridgeMessage(viewerWindow.postedMessages[1]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT,
        payload: {
          targetViewerInstanceId: 'viewer-1',
          rowId: 'row-1',
          annotationId: 'annotation-1',
        },
      })
    );

    dispatchMeasurementRemoval({ viewerInstanceId: 'stale-viewer' });
    dispatchMeasurementRemoval({ rowId: 'other-row' });
    const payload = dispatchMeasurementRemoval();
    dispatchMeasurementRemoval();

    expect(callbacks.onMeasurementRemoved).toHaveBeenCalledTimes(1);
    expect(callbacks.onMeasurementRemoved).toHaveBeenCalledWith(payload);
  });

  it('does not send deletion when the Viewer does not advertise the capability', () => {
    const { activation, announceReady, controller, dispatchMeasurement, viewerWindow } =
      createHarness();
    controller.install();
    announceReady({ measurementDeletion: false });
    controller.activate(activation);
    dispatchMeasurement();

    expect(controller.removeMeasurement({ rowId: 'row-1', annotationId: 'annotation-1' })).toBe(
      'unsupported'
    );
    expect(viewerWindow.postedMessages).toHaveLength(1);
  });

  it('deactivates an armed tool and removes its listener during disposal', () => {
    const { activation, announceReady, controller, hostWindow, viewerWindow } = createHarness();
    controller.install();
    announceReady();
    controller.activate(activation);

    controller.dispose();

    expect(hostWindow.getListenerCount()).toBe(0);
    expect(parseBridgeMessage(viewerWindow.postedMessages[1]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.DEACTIVATE_TOOL,
        payload: expect.objectContaining({ reason: 'host-unmounted' }),
      })
    );
  });
});
