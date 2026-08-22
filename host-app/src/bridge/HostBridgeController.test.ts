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

  postMessage(message: unknown, targetOrigin: string): void {
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
    source = viewerWindow,
    supportedTools = ['EllipticalROI'] as const,
    viewerInstanceId = 'viewer-1',
  }: {
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
          capabilities: { measurementUpdates: false },
        },
        `ready-${viewerInstanceId}`
      ),
      'http://localhost:3000',
      source
    );
  };

  return { activation, announceReady, callbacks, controller, hostWindow, viewerWindow };
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
          capabilities: { measurementUpdates: false },
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

  it('resets an active row when Viewer announces a new session', () => {
    const { activation, announceReady, callbacks, controller } = createHarness();
    controller.install();
    announceReady();
    controller.activate(activation);

    announceReady({ viewerInstanceId: 'viewer-2' });

    expect(callbacks.onActivationReset).toHaveBeenCalledWith(activation);
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
