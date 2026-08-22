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
  ViewerBridgeCommandsManager,
  ViewerBridgeServices,
  ViewportGridState,
} from './types';
import { extractEllipticalRoiAnnotationId, extractEllipticalRoiMeasurement } from './measurement';

const ELLIPTICAL_ROI: SupportedToolName = 'EllipticalROI';
const READY_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000] as const;

export interface ViewerBridgeControllerOptions {
  bridgeWindow: BridgeWindow;
  commandsManager: ViewerBridgeCommandsManager;
  hostOrigin: string;
  services: ViewerBridgeServices;
  createId: () => string;
  onHostMessage?: HostMessageHandler;
  onCommandError?: (error: unknown) => void;
}

interface ArmedActivation {
  activationId: string;
  pendingAnnotationId?: string;
  rowId: string;
  toolName: SupportedToolName;
}

export class ViewerBridgeController {
  private readonly bridgeWindow: BridgeWindow;
  private readonly commandsManager: ViewerBridgeCommandsManager;
  private readonly hostOrigin: string;
  private readonly services: ViewerBridgeServices;
  private readonly createId: () => string;
  private readonly onHostMessage: HostMessageHandler | undefined;
  private readonly onCommandError: ((error: unknown) => void) | undefined;
  private readonly subscriptions: BridgeSubscription[] = [];
  private readonly rowIdsByAnnotationId = new Map<string, string>();
  private installed = false;
  private modeActive = false;
  private readyAnnounced = false;
  private viewerInstanceId: string | null = null;
  private readyRetryIndex = 0;
  private readyRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private armedActivation: ArmedActivation | null = null;

  constructor(options: ViewerBridgeControllerOptions) {
    this.bridgeWindow = options.bridgeWindow;
    this.commandsManager = options.commandsManager;
    this.hostOrigin = options.hostOrigin;
    this.services = options.services;
    this.createId = options.createId;
    this.onHostMessage = options.onHostMessage;
    this.onCommandError = options.onCommandError;
  }

  install(): void {
    if (this.installed) {
      return;
    }

    this.bridgeWindow.addEventListener('message', this.handleMessage);

    const { measurementService, viewportGridService, toolGroupService } = this.services;
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

    const measurementAddedEvent = measurementService.EVENTS.MEASUREMENT_ADDED;
    const measurementUpdatedEvent = measurementService.EVENTS.MEASUREMENT_UPDATED;

    if (typeof measurementAddedEvent === 'string') {
      this.subscriptions.push(
        measurementService.subscribe(measurementAddedEvent, this.handleMeasurementAdded)
      );
    }

    if (typeof measurementUpdatedEvent === 'string') {
      this.subscriptions.push(
        measurementService.subscribe(measurementUpdatedEvent, this.handleMeasurementUpdated)
      );
    }

    this.installed = true;
  }

  enterMode(): void {
    this.install();
    this.modeActive = true;
    this.readyAnnounced = false;
    this.viewerInstanceId = this.createId();
    this.rowIdsByAnnotationId.clear();
    this.cancelReadyRetry();
    this.readyRetryIndex = 0;
    this.tryAnnounceReady();
  }

  exitMode(): void {
    this.deactivateArmedTool();
    this.modeActive = false;
    this.readyAnnounced = false;
    this.viewerInstanceId = null;
    this.rowIdsByAnnotationId.clear();
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

    try {
      this.executeHostCommand(message);
    } catch (error) {
      this.onCommandError?.(error);
    }
    this.onHostMessage?.(message);
  };

  private readonly handleMeasurementAdded = (event: unknown): void => {
    if (!this.modeActive || !this.viewerInstanceId || !this.armedActivation) {
      return;
    }

    const annotationId = extractEllipticalRoiAnnotationId(event);

    if (!annotationId) {
      return;
    }

    if (!this.armedActivation.pendingAnnotationId) {
      this.armedActivation.pendingAnnotationId = annotationId;
    }

    if (this.armedActivation.pendingAnnotationId !== annotationId) {
      return;
    }

    this.completeArmedMeasurement(event);
  };

  private readonly handleMeasurementUpdated = (event: unknown): void => {
    if (!this.modeActive || !this.viewerInstanceId) {
      return;
    }

    const annotationId = extractEllipticalRoiAnnotationId(event);

    if (!annotationId) {
      return;
    }

    if (this.armedActivation?.pendingAnnotationId) {
      if (annotationId === this.armedActivation.pendingAnnotationId) {
        this.completeArmedMeasurement(event);
        return;
      }
    }

    const rowId = this.rowIdsByAnnotationId.get(annotationId);
    const extractedMeasurement = extractEllipticalRoiMeasurement(event);

    if (!rowId || !extractedMeasurement) {
      return;
    }

    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENT_UPDATED,
      {
        viewerInstanceId: this.viewerInstanceId,
        rowId,
        annotationId,
        measurement: extractedMeasurement.measurement,
      },
      this.createId()
    );

    this.bridgeWindow.parent.postMessage(message, this.hostOrigin);
  };

  private completeArmedMeasurement(event: unknown): void {
    const extractedMeasurement = extractEllipticalRoiMeasurement(event);

    if (!extractedMeasurement || !this.viewerInstanceId || !this.armedActivation) {
      return;
    }

    const { activationId, rowId } = this.armedActivation;
    this.rowIdsByAnnotationId.set(extractedMeasurement.annotationId, rowId);
    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED,
      {
        viewerInstanceId: this.viewerInstanceId,
        rowId,
        activationId,
        annotationId: extractedMeasurement.annotationId,
        measurement: extractedMeasurement.measurement,
      },
      this.createId()
    );

    this.bridgeWindow.parent.postMessage(message, this.hostOrigin);
    this.deactivateArmedTool();
  }

  private executeHostCommand(message: Parameters<HostMessageHandler>[0]): void {
    if (message.type === BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL) {
      const { activationId, rowId, toolName } = message.payload;
      const toolGroup = this.services.toolGroupService.getToolGroup();

      if (!toolGroup?.hasTool(toolName)) {
        return;
      }

      if (
        this.armedActivation?.rowId === rowId &&
        this.armedActivation.activationId === activationId
      ) {
        return;
      }

      this.deactivateArmedTool();

      if (!this.setToolActive(toolName)) {
        return;
      }

      this.armedActivation = { rowId, activationId, toolName };
      return;
    }

    if (
      this.armedActivation?.rowId !== message.payload.rowId ||
      this.armedActivation.activationId !== message.payload.activationId
    ) {
      return;
    }

    this.deactivateArmedTool();
  }

  private deactivateArmedTool(): void {
    if (!this.armedActivation) {
      return;
    }

    this.armedActivation = null;
    this.setToolActive('Pan');
  }

  private setToolActive(toolName: string): boolean {
    try {
      this.commandsManager.runCommand('setToolActive', { toolName });
      return true;
    } catch (error) {
      this.onCommandError?.(error);
      return false;
    }
  }

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
        capabilities: { measurementUpdates: true },
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
