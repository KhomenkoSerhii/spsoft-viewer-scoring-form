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
  AnnotationRepository,
  MessageTarget,
  ToolGroup,
  ToolGroupService,
  ViewerBridgeServices,
  ViewportGridService,
  ViewportGridState,
} from './types';
import { ViewerPersistenceStore } from './persistence';
import { ViewerBridgeController } from './ViewerBridgeController';

class FakeEventService implements BridgeEventService {
  readonly EVENTS: Record<string, string>;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(events: Record<string, string>) {
    this.EVENTS = events;
  }

  subscribe(eventName: string, callback: (event: unknown) => void): BridgeSubscription {
    const callbacks = this.listeners.get(eventName) ?? new Set();
    callbacks.add(callback);
    this.listeners.set(eventName, callbacks);

    return {
      unsubscribe: () => callbacks.delete(callback),
    };
  }

  emit(eventName: string, event?: unknown): void {
    this.listeners.get(eventName)?.forEach(callback => callback(event));
  }

  getListenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

class FakeMeasurementService extends FakeEventService {
  readonly removedMeasurementIds: string[] = [];
  private readonly measurements = new Map<string, unknown>();

  constructor() {
    super({
      MEASUREMENT_ADDED: 'measurement-added',
      MEASUREMENT_REMOVED: 'measurement-removed',
      MEASUREMENT_UPDATED: 'measurement-updated',
    });
  }

  getMeasurement(measurementId: string): unknown {
    return this.measurements.get(measurementId) ?? { uid: measurementId };
  }

  setMeasurement(measurementId: string, measurement: unknown): void {
    this.measurements.set(measurementId, measurement);
  }

  remove(measurementId: string): void {
    this.removedMeasurementIds.push(measurementId);
    this.measurements.delete(measurementId);
    this.emit(this.EVENTS.MEASUREMENT_REMOVED!, { measurement: measurementId });
  }
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
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

function createHarness({
  supportsEllipse = true,
  supportsLength = true,
  withPersistence = false,
}: {
  supportsEllipse?: boolean;
  supportsLength?: boolean;
  withPersistence?: boolean;
} = {}) {
  const bridgeWindow = new FakeBridgeWindow();
  const measurementService = new FakeMeasurementService();
  const viewportGridService = new FakeViewportGridService();
  const toolGroupService = new FakeToolGroupService();
  const services: ViewerBridgeServices = {
    measurementService,
    viewportGridService,
    toolGroupService,
  };
  const ids = ['viewer-session-1', 'ready-message-1', 'viewer-session-2', 'ready-message-2'];
  const onHostMessage = jest.fn();
  const onCommandError = jest.fn();
  const commandsManager = { runCommand: jest.fn() };
  const storage = new MemoryStorage();
  const persistenceStore = new ViewerPersistenceStore(storage, 'study-1');
  const annotations = new Map<string, Record<string, unknown>>();
  const annotationRepository: AnnotationRepository = {
    add: annotation => {
      const annotationId = annotation.annotationUID;
      const metadata = annotation.metadata;
      const data = annotation.data;

      if (
        typeof annotationId !== 'string' ||
        typeof metadata !== 'object' ||
        metadata === null ||
        typeof data !== 'object' ||
        data === null
      ) {
        throw new Error('Invalid test annotation.');
      }

      annotations.set(annotationId, annotation);
      measurementService.setMeasurement(annotationId, {
        uid: annotationId,
        toolName: (metadata as { toolName?: unknown }).toolName,
        data: (data as { cachedStats?: unknown }).cachedStats,
      });
      return annotationId;
    },
    get: annotationId => annotations.get(annotationId),
    remove: annotationId => {
      annotations.delete(annotationId);
    },
  };
  const controller = new ViewerBridgeController({
    bridgeWindow,
    commandsManager,
    hostOrigin: 'http://localhost:5173',
    services,
    createId: () => ids.shift() ?? 'fallback-id',
    onCommandError,
    onHostMessage,
    ...(withPersistence ? { annotationRepository, persistenceStore } : {}),
  });

  const makeReady = () => {
    viewportGridService.state = {
      activeViewportId: 'viewport-1',
      viewports: { size: 1 },
    };
    toolGroupService.toolGroup = {
      hasTool: toolName =>
        (supportsEllipse && toolName === 'EllipticalROI') ||
        (supportsLength && toolName === 'Length'),
    };
    viewportGridService.emit(viewportGridService.EVENTS.VIEWPORTS_READY!);
  };

  return {
    bridgeWindow,
    annotationRepository,
    annotations,
    commandsManager,
    controller,
    makeReady,
    measurementService,
    onCommandError,
    onHostMessage,
    persistenceStore,
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
        supportedTools: ['EllipticalROI', 'Length'],
        capabilities: {
          measurementDeletion: true,
          measurementFocus: true,
          measurementUpdates: true,
          statePersistence: false,
        },
      },
    });
  });

  it('announces only the tools available in the active OHIF tool group', () => {
    const { bridgeWindow, controller, makeReady } = createHarness({ supportsLength: false });

    controller.enterMode();
    makeReady();

    const message = parseBridgeMessage(bridgeWindow.postedMessages[0]?.message);

    if (!message || message.type !== BRIDGE_MESSAGE_TYPES.VIEWER_READY) {
      throw new Error('Expected a VIEWER_READY message.');
    }

    expect(message.payload.supportedTools).toEqual(['EllipticalROI']);
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

describe('ViewerBridgeController measurement correlation', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('sends the first valid armed ellipse measurement and returns to Pan', () => {
    const { bridgeWindow, commandsManager, controller, makeReady, measurementService } =
      createHarness();
    controller.enterMode();
    makeReady();
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          toolName: 'EllipticalROI',
        },
        'activate-1'
      ),
      origin: 'http://localhost:5173',
    });

    const measurementEvent = {
      measurement: {
        uid: 'annotation-1',
        toolName: 'EllipticalROI',
        data: { target: { area: 42.75, areaUnit: 'mm²' } },
      },
    };
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, measurementEvent);
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, measurementEvent);

    expect(bridgeWindow.postedMessages).toHaveLength(2);
    expect(parseBridgeMessage(bridgeWindow.postedMessages[1]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED,
        payload: {
          viewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          annotationId: 'annotation-1',
          measurement: {
            kind: 'area',
            value: 42.75,
            unit: 'mm2',
            rawUnit: 'mm²',
          },
        },
      })
    );
    expect(commandsManager.runCommand).toHaveBeenLastCalledWith('setToolActive', {
      toolName: 'Pan',
    });
  });

  it('sends a valid armed Length measurement and returns to Pan', () => {
    const { bridgeWindow, commandsManager, controller, makeReady, measurementService } =
      createHarness();
    controller.enterMode();
    makeReady();
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-length',
          activationId: 'activation-length',
          toolName: 'Length',
        },
        'activate-length'
      ),
      origin: 'http://localhost:5173',
    });

    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, {
      measurement: {
        uid: 'annotation-length',
        toolName: 'Length',
        data: { target: { length: 18.5, unit: 'mm' } },
      },
    });

    expect(parseBridgeMessage(bridgeWindow.postedMessages[1]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED,
        payload: {
          viewerInstanceId: 'viewer-session-1',
          rowId: 'row-length',
          activationId: 'activation-length',
          annotationId: 'annotation-length',
          measurement: {
            kind: 'length',
            value: 18.5,
            unit: 'mm',
            rawUnit: 'mm',
          },
        },
      })
    );
    expect(commandsManager.runCommand).toHaveBeenLastCalledWith('setToolActive', {
      toolName: 'Pan',
    });
  });

  it('publishes changed Length updates without accepting a different measurement kind', () => {
    const { bridgeWindow, controller, makeReady, measurementService } = createHarness();
    controller.enterMode();
    makeReady();
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-length',
          activationId: 'activation-length',
          toolName: 'Length',
        },
        'activate-length'
      ),
      origin: 'http://localhost:5173',
    });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, {
      measurement: {
        uid: 'annotation-length',
        toolName: 'Length',
        data: { target: { length: 18.5, unit: 'mm' } },
      },
    });

    measurementService.emit(measurementService.EVENTS.MEASUREMENT_UPDATED!, {
      measurement: {
        uid: 'annotation-length',
        toolName: 'EllipticalROI',
        data: { target: { area: 100, areaUnit: 'mm²' } },
      },
    });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_UPDATED!, {
      measurement: {
        uid: 'annotation-length',
        toolName: 'Length',
        data: { target: { length: 22.25, unit: 'mm' } },
      },
    });

    expect(bridgeWindow.postedMessages).toHaveLength(3);
    expect(parseBridgeMessage(bridgeWindow.postedMessages[2]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_UPDATED,
        payload: expect.objectContaining({
          annotationId: 'annotation-length',
          measurement: {
            kind: 'length',
            value: 22.25,
            unit: 'mm',
            rawUnit: 'mm',
          },
        }),
      })
    );
  });

  it('ignores measurements until one matches the armed EllipticalROI operation', () => {
    const { bridgeWindow, controller, makeReady, measurementService } = createHarness();
    controller.enterMode();
    makeReady();
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, {
      measurement: {
        uid: 'before-activation',
        toolName: 'EllipticalROI',
        data: { target: { area: 10, areaUnit: 'mm²' } },
      },
    });
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          toolName: 'EllipticalROI',
        },
        'activate-1'
      ),
      origin: 'http://localhost:5173',
    });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, {
      measurement: {
        uid: 'wrong-tool',
        toolName: 'Length',
        data: { target: { area: 10, areaUnit: 'mm²' } },
      },
    });

    expect(bridgeWindow.postedMessages).toHaveLength(1);

    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, {
      measurement: {
        uid: 'annotation-1',
        toolName: 'EllipticalROI',
        data: { target: { area: 12, areaUnit: 'cm²' } },
      },
    });

    expect(bridgeWindow.postedMessages).toHaveLength(2);
  });

  it('waits for a matching update when ellipse statistics are delayed', () => {
    const { bridgeWindow, commandsManager, controller, makeReady, measurementService } =
      createHarness();
    controller.enterMode();
    makeReady();
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          toolName: 'EllipticalROI',
        },
        'activate-1'
      ),
      origin: 'http://localhost:5173',
    });

    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, {
      measurement: {
        uid: 'annotation-pending',
        toolName: 'EllipticalROI',
        data: {},
      },
    });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_UPDATED!, {
      measurement: {
        uid: 'other-annotation',
        toolName: 'EllipticalROI',
        data: { target: { area: 10, areaUnit: 'mm²' } },
      },
    });

    expect(bridgeWindow.postedMessages).toHaveLength(1);
    expect(commandsManager.runCommand).toHaveBeenCalledTimes(1);

    measurementService.emit(measurementService.EVENTS.MEASUREMENT_UPDATED!, {
      measurement: {
        uid: 'annotation-pending',
        toolName: 'EllipticalROI',
        data: { target: { area: 55.5, areaUnit: 'mm²' } },
      },
    });

    expect(bridgeWindow.postedMessages).toHaveLength(2);
    expect(parseBridgeMessage(bridgeWindow.postedMessages[1]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED,
        payload: expect.objectContaining({
          annotationId: 'annotation-pending',
          measurement: expect.objectContaining({ value: 55.5 }),
        }),
      })
    );
    expect(commandsManager.runCommand).toHaveBeenLastCalledWith('setToolActive', {
      toolName: 'Pan',
    });
  });

  it('ignores measurement updates that were not preceded by an armed add event', () => {
    const { bridgeWindow, controller, makeReady, measurementService } = createHarness();
    controller.enterMode();
    makeReady();

    measurementService.emit(measurementService.EVENTS.MEASUREMENT_UPDATED!, {
      measurement: {
        uid: 'unarmed-annotation',
        toolName: 'EllipticalROI',
        data: { target: { area: 10, areaUnit: 'mm²' } },
      },
    });

    expect(bridgeWindow.postedMessages).toHaveLength(1);
  });

  it('publishes only changed live updates for an annotation correlated by the bridge', () => {
    const { bridgeWindow, controller, makeReady, measurementService } = createHarness();
    controller.enterMode();
    makeReady();
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          toolName: 'EllipticalROI',
        },
        'activate-1'
      ),
      origin: 'http://localhost:5173',
    });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, {
      measurement: {
        uid: 'annotation-1',
        toolName: 'EllipticalROI',
        data: { target: { area: 42.75, areaUnit: 'mm²' } },
      },
    });

    measurementService.emit(measurementService.EVENTS.MEASUREMENT_UPDATED!, {
      measurement: {
        uid: 'untracked-annotation',
        toolName: 'EllipticalROI',
        data: { target: { area: 100, areaUnit: 'mm²' } },
      },
    });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_UPDATED!, {
      measurement: {
        uid: 'annotation-1',
        toolName: 'EllipticalROI',
        data: { target: { area: 42.75, areaUnit: 'mm²' } },
      },
    });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_UPDATED!, {
      measurement: {
        uid: 'annotation-1',
        toolName: 'EllipticalROI',
        data: { target: { area: 50.25, areaUnit: 'mm²' } },
      },
    });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_UPDATED!, {
      measurement: {
        uid: 'annotation-1',
        toolName: 'EllipticalROI',
        data: { target: { area: 50.25, areaUnit: 'mm²' } },
      },
    });

    expect(bridgeWindow.postedMessages).toHaveLength(3);
    expect(parseBridgeMessage(bridgeWindow.postedMessages[2]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_UPDATED,
        payload: {
          viewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          annotationId: 'annotation-1',
          measurement: {
            kind: 'area',
            value: 50.25,
            unit: 'mm2',
            rawUnit: 'mm²',
          },
        },
      })
    );
  });

  it('jumps only to a correlated annotation when no tool activation is armed', () => {
    const { bridgeWindow, commandsManager, controller, makeReady, measurementService } =
      createHarness();
    controller.enterMode();
    makeReady();

    const focusMessage = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.FOCUS_MEASUREMENT,
      {
        targetViewerInstanceId: 'viewer-session-1',
        rowId: 'row-1',
        annotationId: 'annotation-1',
      },
      'focus-1'
    );
    bridgeWindow.dispatchMessage({ data: focusMessage, origin: 'http://localhost:5173' });

    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          toolName: 'EllipticalROI',
        },
        'activate-1'
      ),
      origin: 'http://localhost:5173',
    });
    bridgeWindow.dispatchMessage({ data: focusMessage, origin: 'http://localhost:5173' });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, {
      measurement: {
        uid: 'annotation-1',
        toolName: 'EllipticalROI',
        data: { target: { area: 42.75, areaUnit: 'mm²' } },
      },
    });
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.FOCUS_MEASUREMENT,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'other-row',
          annotationId: 'annotation-1',
        },
        'focus-wrong-row'
      ),
      origin: 'http://localhost:5173',
    });
    bridgeWindow.dispatchMessage({ data: focusMessage, origin: 'http://localhost:5173' });

    expect(commandsManager.runCommand).toHaveBeenCalledWith('jumpToMeasurementViewport', {
      annotationUID: 'annotation-1',
      measurement: { uid: 'annotation-1' },
    });
    expect(
      commandsManager.runCommand.mock.calls.filter(
        ([commandName]) => commandName === 'jumpToMeasurementViewport'
      )
    ).toHaveLength(1);
  });

  it('removes a correlated annotation on host command and confirms it to the host', () => {
    const { bridgeWindow, controller, makeReady, measurementService } = createHarness();
    controller.enterMode();
    makeReady();
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          toolName: 'EllipticalROI',
        },
        'activate-1'
      ),
      origin: 'http://localhost:5173',
    });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, {
      measurement: {
        uid: 'annotation-1',
        toolName: 'EllipticalROI',
        data: { target: { area: 42.75, areaUnit: 'mm²' } },
      },
    });

    const removeMessage = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT,
      {
        targetViewerInstanceId: 'viewer-session-1',
        rowId: 'row-1',
        annotationId: 'annotation-1',
      },
      'remove-1'
    );
    bridgeWindow.dispatchMessage({ data: removeMessage, origin: 'http://localhost:5173' });
    bridgeWindow.dispatchMessage({ data: removeMessage, origin: 'http://localhost:5173' });

    expect(measurementService.removedMeasurementIds).toEqual(['annotation-1']);
    expect(parseBridgeMessage(bridgeWindow.postedMessages[2]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_REMOVED,
        payload: {
          viewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          annotationId: 'annotation-1',
        },
      })
    );
  });

  it('reports direct Viewer deletion only for a correlated annotation', () => {
    const { bridgeWindow, controller, makeReady, measurementService } = createHarness();
    controller.enterMode();
    makeReady();
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          toolName: 'EllipticalROI',
        },
        'activate-1'
      ),
      origin: 'http://localhost:5173',
    });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, {
      measurement: {
        uid: 'annotation-1',
        toolName: 'EllipticalROI',
        data: { target: { area: 42.75, areaUnit: 'mm²' } },
      },
    });

    measurementService.emit(measurementService.EVENTS.MEASUREMENT_REMOVED!, {
      measurement: 'untracked-annotation',
    });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_REMOVED!, {
      measurement: 'annotation-1',
    });

    expect(bridgeWindow.postedMessages).toHaveLength(3);
    expect(parseBridgeMessage(bridgeWindow.postedMessages[2]?.message)).toEqual(
      expect.objectContaining({ type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_REMOVED })
    );
  });
});

describe('ViewerBridgeController persistence', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('restores only a host-confirmed annotation and rebuilds its correlation maps', () => {
    const { annotations, bridgeWindow, commandsManager, controller, makeReady, persistenceStore } =
      createHarness({ withPersistence: true });
    const annotation = {
      annotationUID: 'annotation-restored',
      metadata: {
        toolName: 'EllipticalROI',
        FrameOfReferenceUID: 'frame-1',
        referencedImageId: 'wadors:image-1',
      },
      data: {
        handles: {
          points: [
            [1, 2, 3],
            [4, 5, 6],
            [7, 8, 9],
            [10, 11, 12],
          ],
        },
        cachedStats: { target: { area: 42.75, areaUnit: 'mm²' } },
      },
    };
    persistenceStore.upsert({
      annotation,
      annotationId: 'annotation-restored',
      rowId: 'row-restored',
      toolName: 'EllipticalROI',
      measurement: { kind: 'area', value: 42.75, unit: 'mm2', rawUnit: 'mm²' },
    });

    controller.enterMode();
    makeReady();

    expect(parseBridgeMessage(bridgeWindow.postedMessages[0]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.VIEWER_READY,
        payload: expect.objectContaining({
          capabilities: expect.objectContaining({ statePersistence: true }),
        }),
      })
    );

    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.RESTORE_MEASUREMENTS,
        {
          targetViewerInstanceId: 'viewer-session-1',
          measurements: [
            {
              annotationId: 'annotation-restored',
              rowId: 'row-restored',
              toolName: 'EllipticalROI',
            },
          ],
        },
        'restore-command'
      ),
      origin: 'http://localhost:5173',
    });

    expect(annotations.get('annotation-restored')).toEqual(annotation);
    expect(parseBridgeMessage(bridgeWindow.postedMessages[1]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENTS_RESTORED,
        payload: {
          viewerInstanceId: 'viewer-session-1',
          measurements: [
            {
              annotationId: 'annotation-restored',
              rowId: 'row-restored',
              toolName: 'EllipticalROI',
              measurement: { kind: 'area', value: 42.75, unit: 'mm2', rawUnit: 'mm²' },
            },
          ],
        },
      })
    );

    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.FOCUS_MEASUREMENT,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-restored',
          annotationId: 'annotation-restored',
        },
        'focus-restored'
      ),
      origin: 'http://localhost:5173',
    });

    expect(commandsManager.runCommand).toHaveBeenCalledWith(
      'jumpToMeasurementViewport',
      expect.objectContaining({ annotationUID: 'annotation-restored' })
    );
  });

  it('removes Viewer storage entries that the host no longer owns', () => {
    const { bridgeWindow, controller, makeReady, persistenceStore } = createHarness({
      withPersistence: true,
    });
    persistenceStore.upsert({
      annotation: {
        annotationUID: 'orphan',
        metadata: {
          toolName: 'Length',
          FrameOfReferenceUID: 'frame-1',
          referencedImageId: 'wadors:image-1',
        },
        data: {
          handles: {
            points: [
              [1, 2, 3],
              [4, 5, 6],
            ],
          },
          cachedStats: { target: { length: 10, unit: 'mm' } },
        },
      },
      annotationId: 'orphan',
      rowId: 'orphan-row',
      toolName: 'Length',
      measurement: { kind: 'length', value: 10, unit: 'mm', rawUnit: 'mm' },
    });
    controller.enterMode();
    makeReady();

    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.RESTORE_MEASUREMENTS,
        { targetViewerInstanceId: 'viewer-session-1', measurements: [] },
        'restore-empty'
      ),
      origin: 'http://localhost:5173',
    });

    expect(persistenceStore.load()).toEqual([]);
    expect(parseBridgeMessage(bridgeWindow.postedMessages[1]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENTS_RESTORED,
        payload: { viewerInstanceId: 'viewer-session-1', measurements: [] },
      })
    );
  });

  it('removes a partially restored annotation when OHIF cannot recreate its measurement', () => {
    const {
      annotations,
      bridgeWindow,
      controller,
      makeReady,
      measurementService,
      onCommandError,
      persistenceStore,
    } = createHarness({ withPersistence: true });
    persistenceStore.upsert({
      annotation: {
        annotationUID: 'broken-annotation',
        metadata: {
          toolName: 'Length',
          FrameOfReferenceUID: 'frame-1',
          referencedImageId: 'wadors:image-1',
        },
        data: {
          handles: {
            points: [
              [1, 2, 3],
              [4, 5, 6],
            ],
          },
          cachedStats: { target: { length: 10, unit: 'mm' } },
        },
      },
      annotationId: 'broken-annotation',
      rowId: 'broken-row',
      toolName: 'Length',
      measurement: { kind: 'length', value: 10, unit: 'mm', rawUnit: 'mm' },
    });
    jest.spyOn(measurementService, 'getMeasurement').mockReturnValue(undefined);
    controller.enterMode();
    makeReady();

    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.RESTORE_MEASUREMENTS,
        {
          targetViewerInstanceId: 'viewer-session-1',
          measurements: [
            {
              annotationId: 'broken-annotation',
              rowId: 'broken-row',
              toolName: 'Length',
            },
          ],
        },
        'restore-broken'
      ),
      origin: 'http://localhost:5173',
    });

    expect(annotations.has('broken-annotation')).toBe(false);
    expect(persistenceStore.load()).toEqual([]);
    expect(onCommandError).toHaveBeenCalledWith(expect.any(Error));
    expect(parseBridgeMessage(bridgeWindow.postedMessages[1]?.message)).toEqual(
      expect.objectContaining({
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENTS_RESTORED,
        payload: { viewerInstanceId: 'viewer-session-1', measurements: [] },
      })
    );
  });
});

describe('ViewerBridgeController tool commands', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('activates EllipticalROI once for a correlated host command', () => {
    const { bridgeWindow, commandsManager, controller, makeReady } = createHarness();
    controller.enterMode();
    makeReady();
    const command = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
      {
        targetViewerInstanceId: 'viewer-session-1',
        rowId: 'row-1',
        activationId: 'activation-1',
        toolName: 'EllipticalROI',
      },
      'activate-1'
    );

    bridgeWindow.dispatchMessage({
      data: command,
      origin: 'http://localhost:5173',
    });
    bridgeWindow.dispatchMessage({
      data: command,
      origin: 'http://localhost:5173',
    });

    expect(commandsManager.runCommand).toHaveBeenCalledTimes(1);
    expect(commandsManager.runCommand).toHaveBeenCalledWith('setToolActive', {
      toolName: 'EllipticalROI',
    });
  });

  it('returns to Pan only for the matching active activation', () => {
    const { bridgeWindow, commandsManager, controller, makeReady } = createHarness();
    controller.enterMode();
    makeReady();
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          toolName: 'EllipticalROI',
        },
        'activate-1'
      ),
      origin: 'http://localhost:5173',
    });
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.DEACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'stale-activation',
          reason: 'user-cancelled',
        },
        'cancel-stale'
      ),
      origin: 'http://localhost:5173',
    });
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.DEACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          reason: 'user-cancelled',
        },
        'cancel-current'
      ),
      origin: 'http://localhost:5173',
    });

    expect(commandsManager.runCommand).toHaveBeenNthCalledWith(1, 'setToolActive', {
      toolName: 'EllipticalROI',
    });
    expect(commandsManager.runCommand).toHaveBeenNthCalledWith(2, 'setToolActive', {
      toolName: 'Pan',
    });
    expect(commandsManager.runCommand).toHaveBeenCalledTimes(2);
  });

  it('returns an armed tool to Pan during mode cleanup', () => {
    const { bridgeWindow, commandsManager, controller, makeReady } = createHarness();
    controller.enterMode();
    makeReady();
    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          toolName: 'EllipticalROI',
        },
        'activate-1'
      ),
      origin: 'http://localhost:5173',
    });

    controller.exitMode();

    expect(commandsManager.runCommand).toHaveBeenLastCalledWith('setToolActive', {
      toolName: 'Pan',
    });
  });

  it('reports command failures without arming a measurement operation', () => {
    const {
      bridgeWindow,
      commandsManager,
      controller,
      makeReady,
      measurementService,
      onCommandError,
    } = createHarness();
    controller.enterMode();
    makeReady();
    commandsManager.runCommand.mockImplementationOnce(() => {
      throw new Error('EllipticalROI activation failed.');
    });

    bridgeWindow.dispatchMessage({
      data: createBridgeMessage(
        BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        {
          targetViewerInstanceId: 'viewer-session-1',
          rowId: 'row-1',
          activationId: 'activation-1',
          toolName: 'EllipticalROI',
        },
        'activate-1'
      ),
      origin: 'http://localhost:5173',
    });
    measurementService.emit(measurementService.EVENTS.MEASUREMENT_ADDED!, {
      measurement: {
        uid: 'annotation-1',
        toolName: 'EllipticalROI',
        data: { target: { area: 42.75, areaUnit: 'mm²' } },
      },
    });

    expect(onCommandError).toHaveBeenCalledWith(expect.any(Error));
    expect(
      bridgeWindow.postedMessages
        .map(({ message }) => parseBridgeMessage(message))
        .filter(message => message?.type === BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED)
    ).toHaveLength(0);
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
    const { bridgeWindow, controller, measurementService, toolGroupService, viewportGridService } =
      createHarness();

    controller.enterMode();
    expect(bridgeWindow.getListenerCount()).toBe(1);
    expect(viewportGridService.getListenerCount()).toBe(2);
    expect(toolGroupService.getListenerCount()).toBe(2);
    expect(measurementService.getListenerCount()).toBe(3);

    controller.exitMode();

    expect(bridgeWindow.getListenerCount()).toBe(0);
    expect(viewportGridService.getListenerCount()).toBe(0);
    expect(toolGroupService.getListenerCount()).toBe(0);
    expect(measurementService.getListenerCount()).toBe(0);
  });
});
