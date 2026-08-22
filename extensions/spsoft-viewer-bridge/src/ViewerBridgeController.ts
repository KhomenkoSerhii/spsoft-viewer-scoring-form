import {
  BRIDGE_MESSAGE_TYPES,
  createBridgeMessage,
  isHostToViewerMessage,
  parseBridgeMessage,
  type SupportedToolName,
} from '@spsoft/viewer-protocol';

import type {
  BridgeSubscription,
  BridgeWindow,
  HostMessageHandler,
  ToolGroup,
  ViewerBridgeServices,
  ViewportGridState,
} from './types';

const ELLIPTICAL_ROI: SupportedToolName = 'EllipticalROI';
const READY_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000] as const;

export interface ViewerBridgeControllerOptions {
  bridgeWindow: BridgeWindow;
  hostOrigin: string;
  services: ViewerBridgeServices;
  createId: () => string;
  onHostMessage?: HostMessageHandler;
}

export class ViewerBridgeController {
  private readonly bridgeWindow: BridgeWindow;
  private readonly hostOrigin: string;
  private readonly services: ViewerBridgeServices;
  private readonly createId: () => string;
  private readonly onHostMessage: HostMessageHandler | undefined;
  private readonly subscriptions: BridgeSubscription[] = [];
  private installed = false;
  private modeActive = false;
  private readyAnnounced = false;
  private viewerInstanceId: string | null = null;
  private readyRetryIndex = 0;
  private readyRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ViewerBridgeControllerOptions) {
    this.bridgeWindow = options.bridgeWindow;
    this.hostOrigin = options.hostOrigin;
    this.services = options.services;
    this.createId = options.createId;
    this.onHostMessage = options.onHostMessage;
  }

  install(): void {
    if (this.installed) {
      return;
    }

    this.bridgeWindow.addEventListener('message', this.handleMessage);

    const { viewportGridService, toolGroupService } = this.services;
    const viewportEvents = [
      viewportGridService.EVENTS.VIEWPORTS_READY,
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
    ].filter((eventName): eventName is string => typeof eventName === 'string');

    for (const eventName of viewportEvents) {
      this.subscriptions.push(viewportGridService.subscribe(eventName, this.tryAnnounceReady));
    }

    const toolGroupEvents = [
      toolGroupService.EVENTS.TOOLGROUP_CREATED,
      toolGroupService.EVENTS.VIEWPORT_ADDED,
    ].filter((eventName): eventName is string => typeof eventName === 'string');

    for (const eventName of toolGroupEvents) {
      this.subscriptions.push(toolGroupService.subscribe(eventName, this.tryAnnounceReady));
    }

    this.installed = true;
  }

  enterMode(): void {
    this.install();
    this.modeActive = true;
    this.readyAnnounced = false;
    this.viewerInstanceId = this.createId();
    this.cancelReadyRetry();
    this.readyRetryIndex = 0;
    this.tryAnnounceReady();
  }

  exitMode(): void {
    this.modeActive = false;
    this.readyAnnounced = false;
    this.viewerInstanceId = null;
    this.cancelReadyRetry();
    this.readyRetryIndex = 0;

    if (!this.installed) {
      return;
    }

    this.bridgeWindow.removeEventListener('message', this.handleMessage);
    this.subscriptions.splice(0).forEach(subscription => subscription.unsubscribe());
    this.installed = false;
  }

  dispose(): void {
    this.exitMode();
  }

  getViewerInstanceId(): string | null {
    return this.viewerInstanceId;
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (
      !this.modeActive ||
      !this.viewerInstanceId ||
      event.origin !== this.hostOrigin ||
      event.source !== this.bridgeWindow.parent
    ) {
      return;
    }

    const message = parseBridgeMessage(event.data);

    if (
      !message ||
      !isHostToViewerMessage(message) ||
      message.payload.targetViewerInstanceId !== this.viewerInstanceId
    ) {
      return;
    }

    this.onHostMessage?.(message);
  };

  private readonly tryAnnounceReady = (): void => {
    if (!this.modeActive || this.readyAnnounced || !this.viewerInstanceId) {
      return;
    }

    const { viewportGridService, toolGroupService } = this.services;
    let viewportState: ViewportGridState;
    let toolGroup: ToolGroup | undefined;

    try {
      viewportState = viewportGridService.getState();
      toolGroup = toolGroupService.getToolGroup();
    } catch {
      // OHIF can invoke extension onModeEnter before viewport service implementations are ready.
      // Readiness events and the bounded retry cover asynchronous service initialization.
      this.scheduleReadyRetry();
      return;
    }

    if (!viewportState.activeViewportId || viewportState.viewports.size === 0) {
      this.scheduleReadyRetry();
      return;
    }

    if (!toolGroup) {
      this.scheduleReadyRetry();
      return;
    }

    const supportedTools: SupportedToolName[] = toolGroup.hasTool(ELLIPTICAL_ROI)
      ? [ELLIPTICAL_ROI]
      : [];
    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.VIEWER_READY,
      {
        viewerInstanceId: this.viewerInstanceId,
        supportedTools,
        capabilities: { measurementUpdates: false },
      },
      this.createId()
    );

    this.bridgeWindow.parent.postMessage(message, this.hostOrigin);
    this.readyAnnounced = true;
    this.cancelReadyRetry();
  };

  private scheduleReadyRetry(): void {
    if (
      this.readyRetryTimer !== null ||
      this.readyRetryIndex >= READY_RETRY_DELAYS_MS.length ||
      !this.modeActive ||
      this.readyAnnounced
    ) {
      return;
    }

    const delay = READY_RETRY_DELAYS_MS[this.readyRetryIndex];
    this.readyRetryIndex += 1;
    this.readyRetryTimer = setTimeout(() => {
      this.readyRetryTimer = null;
      this.tryAnnounceReady();
    }, delay);
  }

  private cancelReadyRetry(): void {
    if (this.readyRetryTimer === null) {
      return;
    }

    clearTimeout(this.readyRetryTimer);
    this.readyRetryTimer = null;
  }
}
