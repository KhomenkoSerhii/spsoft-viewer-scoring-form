import {
  BRIDGE_CHANNEL,
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_VERSION,
  createBridgeMessage,
  parseBridgeMessage,
} from '@spsoft/viewer-protocol';

import type {
  BridgeEventService,
  BridgeSubscription,
  BridgeWindow,
  MessageTarget,
  ToolGroup,
  ToolGroupService,
  ViewerBridgeServices,
  ViewportGridService,
  ViewportGridState,
} from './types';
import { ViewerBridgeController } from './ViewerBridgeController';

class FakeEventService implements BridgeEventService {
  readonly EVENTS: Record<string, string>;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(events: Record<string, string>) {
    this.EVENTS = events;
  }

  subscribe(eventName: string, callback: () => void): BridgeSubscription {
    const callbacks = this.listeners.get(eventName) ?? new Set();
    callbacks.add(callback);
    this.listeners.set(eventName, callbacks);

    return {
      unsubscribe: () => callbacks.delete(callback),
    };
  }

  emit(eventName: string): void {
    this.listeners.get(eventName)?.forEach(callback => callback());
  }

  getListenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

class FakeViewportGridService extends FakeEventService implements ViewportGridService {
  state: ViewportGridState = { viewports: { size: 0 } };
  throwOnGetState = false;

  constructor() {
    super({
      VIEWPORTS_READY: 'viewports-ready',
      ACTIVE_VIEWPORT_ID_CHANGED: 'active-viewport-changed',
    });
  }

  getState(): ViewportGridState {
    if (this.throwOnGetState) {
      throw new Error('Viewport service implementation is not ready.');
    }

    return this.state;
  }
}

class FakeToolGroupService extends FakeEventService implements ToolGroupService {
  toolGroup: ToolGroup | undefined;

  constructor() {
    super({
      TOOLGROUP_CREATED: 'toolgroup-created',
      VIEWPORT_ADDED: 'viewport-added',
    });
  }

  getToolGroup(): ToolGroup | undefined {
    return this.toolGroup;
  }
}

class FakeBridgeWindow implements BridgeWindow {
  readonly postedMessages: Array<{ message: unknown; targetOrigin: string }> = [];
  readonly parent: MessageTarget = {
    postMessage: (message, targetOrigin) => {
      this.postedMessages.push({ message, targetOrigin });
    },
  };
  private readonly messageListeners = new Set<(event: MessageEvent<unknown>) => void>();

  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    if (type === 'message') {
      this.messageListeners.add(listener);
    }
  }

  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    if (type === 'message') {
      this.messageListeners.delete(listener);
    }
  }

  dispatchMessage({
    data,
    origin,
    source = this.parent,
  }: {
    data: unknown;
    origin: string;
    source?: MessageTarget;
  }): void {
    const event = { data, origin, source } as unknown as MessageEvent<unknown>;
    this.messageListeners.forEach(listener => listener(event));
  }

  getListenerCount(): number {
    return this.messageListeners.size;
  }
}

function createHarness({ supportsEllipse = true }: { supportsEllipse?: boolean } = {}) {
  const bridgeWindow = new FakeBridgeWindow();
  const viewportGridService = new FakeViewportGridService();
  const toolGroupService = new FakeToolGroupService();
  const services: ViewerBridgeServices = { viewportGridService, toolGroupService };
  const ids = ['viewer-session-1', 'ready-message-1', 'viewer-session-2', 'ready-message-2'];
  const onHostMessage = jest.fn();
  const controller = new ViewerBridgeController({
    bridgeWindow,
    hostOrigin: 'http://localhost:5173',
    services,
    createId: () => ids.shift() ?? 'fallback-id',
    onHostMessage,
  });

  const makeReady = () => {
    viewportGridService.state = {
      activeViewportId: 'viewport-1',
      viewports: { size: 1 },
    };
    toolGroupService.toolGroup = {
      hasTool: toolName => supportsEllipse && toolName === 'EllipticalROI',
    };
    viewportGridService.emit(viewportGridService.EVENTS.VIEWPORTS_READY!);
  };

  return {
    bridgeWindow,
    controller,
    makeReady,
    onHostMessage,
    toolGroupService,
    viewportGridService,
  };
}

describe('ViewerBridgeController handshake', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('announces readiness once after the viewport and tool group exist', () => {
    const { bridgeWindow, controller, makeReady, viewportGridService } = createHarness();

    controller.install();
    controller.enterMode();

    expect(bridgeWindow.postedMessages).toHaveLength(0);

    makeReady();
    viewportGridService.emit(viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED!);

    expect(bridgeWindow.postedMessages).toHaveLength(1);
    expect(bridgeWindow.postedMessages[0]?.targetOrigin).toBe('http://localhost:5173');
    expect(parseBridgeMessage(bridgeWindow.postedMessages[0]?.message)).toEqual({
      channel: BRIDGE_CHANNEL,
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.VIEWER_READY,
      messageId: 'ready-message-1',
      payload: {
        viewerInstanceId: 'viewer-session-1',
        supportedTools: ['EllipticalROI'],
        capabilities: { measurementUpdates: false },
      },
    });
  });

  it('announces an empty supported tool list when EllipticalROI is unavailable', () => {
    const { bridgeWindow, controller, makeReady } = createHarness({ supportsEllipse: false });

    controller.enterMode();
    makeReady();

    const message = parseBridgeMessage(bridgeWindow.postedMessages[0]?.message);

    if (!message || message.type !== BRIDGE_MESSAGE_TYPES.VIEWER_READY) {
      throw new Error('Expected a VIEWER_READY message.');
    }

    expect(message.payload.supportedTools).toEqual([]);
  });

  it('waits when OHIF enters the mode before the viewport service is initialized', () => {
    const { bridgeWindow, controller, makeReady, viewportGridService } = createHarness();
    viewportGridService.throwOnGetState = true;

    expect(() => controller.enterMode()).not.toThrow();
    expect(bridgeWindow.postedMessages).toHaveLength(0);

    viewportGridService.throwOnGetState = false;
    makeReady();

    expect(bridgeWindow.postedMessages).toHaveLength(1);
  });

  it('uses a bounded retry when readiness events arrive too early', () => {
    const { bridgeWindow, controller, toolGroupService, viewportGridService } = createHarness();

    controller.enterMode();
    viewportGridService.state = {
      activeViewportId: 'viewport-1',
      viewports: { size: 1 },
    };
    toolGroupService.toolGroup = { hasTool: toolName => toolName === 'EllipticalROI' };

    jest.advanceTimersByTime(100);

    expect(bridgeWindow.postedMessages).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops retrying when the bounded retry schedule is exhausted', () => {
    const { bridgeWindow, controller } = createHarness();

    controller.enterMode();
    jest.runAllTimers();

    expect(bridgeWindow.postedMessages).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('creates a new viewer session after mode exit and re-entry', () => {
    const { bridgeWindow, controller, makeReady } = createHarness();

    controller.enterMode();
    makeReady();
    controller.exitMode();
    controller.enterMode();
    makeReady();

    const sessionIds = bridgeWindow.postedMessages.map(({ message }) => {
      const parsedMessage = parseBridgeMessage(message);
      return parsedMessage?.type === BRIDGE_MESSAGE_TYPES.VIEWER_READY
        ? parsedMessage.payload.viewerInstanceId
        : null;
    });

    expect(sessionIds).toEqual(['viewer-session-1', 'viewer-session-2']);
  });
});

describe('ViewerBridgeController message boundary', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('forwards only valid commands from the configured parent and current viewer session', () => {
    const { bridgeWindow, controller, onHostMessage } = createHarness();
    controller.enterMode();

    const validCommand = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
      {
        targetViewerInstanceId: 'viewer-session-1',
        rowId: 'row-1',
        activationId: 'activation-1',
        toolName: 'EllipticalROI',
      },
      'command-1'
    );

    bridgeWindow.dispatchMessage({
      data: validCommand,
      origin: 'https://attacker.example',
    });
    bridgeWindow.dispatchMessage({
      data: validCommand,
      origin: 'http://localhost:5173',
      source: { postMessage: jest.fn() },
    });
    bridgeWindow.dispatchMessage({
      data: { ...validCommand, channel: 'other-channel' },
      origin: 'http://localhost:5173',
    });
    bridgeWindow.dispatchMessage({
      data: {
        ...validCommand,
        payload: { ...validCommand.payload, targetViewerInstanceId: 'stale-session' },
      },
      origin: 'http://localhost:5173',
    });
    bridgeWindow.dispatchMessage({
      data: validCommand,
      origin: 'http://localhost:5173',
    });

    expect(onHostMessage).toHaveBeenCalledTimes(1);
    expect(onHostMessage).toHaveBeenCalledWith(validCommand);
  });

  it('removes the listener and readiness subscriptions on mode exit', () => {
    const { bridgeWindow, controller, toolGroupService, viewportGridService } = createHarness();

    controller.enterMode();
    expect(bridgeWindow.getListenerCount()).toBe(1);
    expect(viewportGridService.getListenerCount()).toBe(2);
    expect(toolGroupService.getListenerCount()).toBe(2);

    controller.exitMode();

    expect(bridgeWindow.getListenerCount()).toBe(0);
    expect(viewportGridService.getListenerCount()).toBe(0);
    expect(toolGroupService.getListenerCount()).toBe(0);
  });
});
