import {
  BRIDGE_MESSAGE_TYPES,
  createBridgeMessage,
  isViewerToHostMessage,
  parseBridgeMessage,
  type MeasurementAddedPayload,
  type MeasurementRemovedPayload,
  type MeasurementUpdatedPayload,
  type SupportedToolName,
  type ViewerReadyPayload,
} from '@spsoft/viewer-protocol';

export interface HostMessageWindow {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

export interface ViewerMessageWindow {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface ActivationRequest {
  rowId: string;
  activationId: string;
  toolName: SupportedToolName;
}

export type ActivationResult = 'queued' | 'sent' | 'busy' | 'unsupported' | 'error';

export interface RemovalRequest {
  annotationId: string;
  rowId: string;
}

export type RemovalResult = 'sent' | 'unsupported' | 'error';

export interface HostBridgeCallbacks {
  onActivationRejected(request: ActivationRequest, reason: 'unsupported' | 'error'): void;
  onActivationReset(request: ActivationRequest): void;
  onActivationSent(request: ActivationRequest): void;
  onMeasurementAdded(payload: MeasurementAddedPayload): void;
  onMeasurementRemoved(payload: MeasurementRemovedPayload): void;
  onMeasurementUpdated(payload: MeasurementUpdatedPayload): void;
  onViewerLoading(): void;
  onViewerReady(payload: ViewerReadyPayload): void;
}

export interface HostBridgeControllerOptions {
  callbacks: HostBridgeCallbacks;
  createId: () => string;
  getViewerWindow: () => ViewerMessageWindow | null;
  hostWindow: HostMessageWindow;
  viewerOrigin: string;
}

export class HostBridgeController {
  private readonly callbacks: HostBridgeCallbacks;
  private readonly createId: () => string;
  private readonly getViewerWindow: () => ViewerMessageWindow | null;
  private readonly hostWindow: HostMessageWindow;
  private readonly viewerOrigin: string;
  private activeRequest: ActivationRequest | null = null;
  private readonly rowIdsByAnnotationId = new Map<string, string>();
  private readonly acceptedMessageIds = new Set<string>();
  private readonly pendingRemovalAnnotationIds = new Set<string>();
  private installed = false;
  private pendingRequest: ActivationRequest | null = null;
  private viewerSession: ViewerReadyPayload | null = null;

  constructor(options: HostBridgeControllerOptions) {
    this.callbacks = options.callbacks;
    this.createId = options.createId;
    this.getViewerWindow = options.getViewerWindow;
    this.hostWindow = options.hostWindow;
    this.viewerOrigin = options.viewerOrigin;
  }

  install(): void {
    if (this.installed) {
      return;
    }

    this.hostWindow.addEventListener('message', this.handleMessage);
    this.installed = true;
  }

  activate(request: ActivationRequest): ActivationResult {
    if (this.pendingRequest || this.activeRequest) {
      return 'busy';
    }

    if (!this.viewerSession) {
      this.pendingRequest = request;
      return 'queued';
    }

    if (!this.viewerSession.supportedTools.includes(request.toolName)) {
      return 'unsupported';
    }

    if (!this.postActivation(request)) {
      return 'error';
    }

    this.activeRequest = request;
    return 'sent';
  }

  cancel(request: ActivationRequest): void {
    if (this.matchesRequest(this.pendingRequest, request)) {
      this.pendingRequest = null;
      return;
    }

    if (!this.matchesRequest(this.activeRequest, request)) {
      return;
    }

    this.postDeactivation(request, 'user-cancelled');
    this.activeRequest = null;
  }

  removeMeasurement(request: RemovalRequest): RemovalResult {
    const viewerInstanceId = this.viewerSession?.viewerInstanceId;
    const viewerWindow = this.getViewerWindow();

    if (!viewerInstanceId || !viewerWindow) {
      return 'error';
    }

    if (!this.viewerSession?.capabilities.measurementDeletion) {
      return 'unsupported';
    }

    if (
      this.rowIdsByAnnotationId.get(request.annotationId) !== request.rowId ||
      this.pendingRemovalAnnotationIds.has(request.annotationId)
    ) {
      return 'error';
    }

    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT,
      {
        targetViewerInstanceId: viewerInstanceId,
        rowId: request.rowId,
        annotationId: request.annotationId,
      },
      this.createId()
    );

    try {
      viewerWindow.postMessage(message, this.viewerOrigin);
      this.pendingRemovalAnnotationIds.add(request.annotationId);
      return 'sent';
    } catch {
      return 'error';
    }
  }

  notifyViewerLoading(): void {
    if (this.activeRequest) {
      const staleRequest = this.activeRequest;
      this.activeRequest = null;
      this.callbacks.onActivationReset(staleRequest);
    }

    this.viewerSession = null;
    this.rowIdsByAnnotationId.clear();
    this.acceptedMessageIds.clear();
    this.pendingRemovalAnnotationIds.clear();
    this.callbacks.onViewerLoading();
  }

  dispose(): void {
    if (this.activeRequest) {
      this.postDeactivation(this.activeRequest, 'host-unmounted');
    }

    this.activeRequest = null;
    this.pendingRequest = null;
    this.viewerSession = null;
    this.rowIdsByAnnotationId.clear();
    this.acceptedMessageIds.clear();
    this.pendingRemovalAnnotationIds.clear();

    if (!this.installed) {
      return;
    }

    this.hostWindow.removeEventListener('message', this.handleMessage);
    this.installed = false;
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    const viewerWindow = this.getViewerWindow();

    if (!viewerWindow || event.origin !== this.viewerOrigin || event.source !== viewerWindow) {
      return;
    }

    const message = parseBridgeMessage(event.data);

    if (!message || !isViewerToHostMessage(message)) {
      return;
    }

    if (message.type === BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED) {
      this.acceptMeasurement(message.messageId, message.payload);
      return;
    }

    if (message.type === BRIDGE_MESSAGE_TYPES.MEASUREMENT_UPDATED) {
      this.acceptMeasurementUpdate(message.messageId, message.payload);
      return;
    }

    if (message.type === BRIDGE_MESSAGE_TYPES.MEASUREMENT_REMOVED) {
      this.acceptMeasurementRemoval(message.messageId, message.payload);
      return;
    }

    if (message.type !== BRIDGE_MESSAGE_TYPES.VIEWER_READY) {
      return;
    }

    const previousViewerInstanceId = this.viewerSession?.viewerInstanceId;

    if (previousViewerInstanceId && previousViewerInstanceId !== message.payload.viewerInstanceId) {
      this.rowIdsByAnnotationId.clear();
      this.acceptedMessageIds.clear();
      this.pendingRemovalAnnotationIds.clear();
    }

    if (
      previousViewerInstanceId &&
      previousViewerInstanceId !== message.payload.viewerInstanceId &&
      this.activeRequest
    ) {
      const staleRequest = this.activeRequest;
      this.activeRequest = null;
      this.callbacks.onActivationReset(staleRequest);
    }

    this.viewerSession = message.payload;
    this.callbacks.onViewerReady(message.payload);
    this.flushPendingActivation();
  };

  private acceptMeasurement(messageId: string, payload: MeasurementAddedPayload): void {
    const activeRequest = this.activeRequest;

    if (
      !activeRequest ||
      this.acceptedMessageIds.has(messageId) ||
      this.rowIdsByAnnotationId.has(payload.annotationId) ||
      payload.viewerInstanceId !== this.viewerSession?.viewerInstanceId ||
      payload.rowId !== activeRequest.rowId ||
      payload.activationId !== activeRequest.activationId
    ) {
      return;
    }

    this.acceptedMessageIds.add(messageId);
    this.rowIdsByAnnotationId.set(payload.annotationId, payload.rowId);
    this.activeRequest = null;
    this.callbacks.onMeasurementAdded(payload);
  }

  private acceptMeasurementUpdate(messageId: string, payload: MeasurementUpdatedPayload): void {
    if (
      this.acceptedMessageIds.has(messageId) ||
      payload.viewerInstanceId !== this.viewerSession?.viewerInstanceId ||
      this.rowIdsByAnnotationId.get(payload.annotationId) !== payload.rowId
    ) {
      return;
    }

    this.acceptedMessageIds.add(messageId);
    this.callbacks.onMeasurementUpdated(payload);
  }

  private acceptMeasurementRemoval(messageId: string, payload: MeasurementRemovedPayload): void {
    if (
      this.acceptedMessageIds.has(messageId) ||
      payload.viewerInstanceId !== this.viewerSession?.viewerInstanceId ||
      this.rowIdsByAnnotationId.get(payload.annotationId) !== payload.rowId
    ) {
      return;
    }

    this.acceptedMessageIds.add(messageId);
    this.rowIdsByAnnotationId.delete(payload.annotationId);
    this.pendingRemovalAnnotationIds.delete(payload.annotationId);
    this.callbacks.onMeasurementRemoved(payload);
  }

  private flushPendingActivation(): void {
    const request = this.pendingRequest;

    if (!request || !this.viewerSession) {
      return;
    }

    this.pendingRequest = null;

    if (!this.viewerSession.supportedTools.includes(request.toolName)) {
      this.callbacks.onActivationRejected(request, 'unsupported');
      return;
    }

    if (!this.postActivation(request)) {
      this.callbacks.onActivationRejected(request, 'error');
      return;
    }

    this.activeRequest = request;
    this.callbacks.onActivationSent(request);
  }

  private postActivation(request: ActivationRequest): boolean {
    const viewerInstanceId = this.viewerSession?.viewerInstanceId;
    const viewerWindow = this.getViewerWindow();

    if (!viewerInstanceId || !viewerWindow) {
      return false;
    }

    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
      {
        targetViewerInstanceId: viewerInstanceId,
        rowId: request.rowId,
        activationId: request.activationId,
        toolName: request.toolName,
      },
      this.createId()
    );

    try {
      viewerWindow.postMessage(message, this.viewerOrigin);
      return true;
    } catch {
      return false;
    }
  }

  private postDeactivation(
    request: ActivationRequest,
    reason: 'user-cancelled' | 'host-unmounted'
  ): void {
    const viewerInstanceId = this.viewerSession?.viewerInstanceId;
    const viewerWindow = this.getViewerWindow();

    if (!viewerInstanceId || !viewerWindow) {
      return;
    }

    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.DEACTIVATE_TOOL,
      {
        targetViewerInstanceId: viewerInstanceId,
        rowId: request.rowId,
        activationId: request.activationId,
        reason,
      },
      this.createId()
    );

    try {
      viewerWindow.postMessage(message, this.viewerOrigin);
    } catch {
      // The iframe may disappear during React cleanup; local state is cleared regardless.
    }
  }

  private matchesRequest(
    currentRequest: ActivationRequest | null,
    request: ActivationRequest
  ): boolean {
    return (
      currentRequest?.rowId === request.rowId &&
      currentRequest.activationId === request.activationId
    );
  }
}
