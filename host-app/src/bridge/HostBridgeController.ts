import {
  BRIDGE_MESSAGE_TYPES,
  createBridgeMessage,
  isViewerToHostMessage,
  parseBridgeMessage,
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

export interface HostBridgeCallbacks {
  onActivationRejected(request: ActivationRequest, reason: 'unsupported' | 'error'): void;
  onActivationReset(request: ActivationRequest): void;
  onActivationSent(request: ActivationRequest): void;
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

  dispose(): void {
    if (this.activeRequest) {
      this.postDeactivation(this.activeRequest, 'host-unmounted');
    }

    this.activeRequest = null;
    this.pendingRequest = null;
    this.viewerSession = null;

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

    if (
      !message ||
      !isViewerToHostMessage(message) ||
      message.type !== BRIDGE_MESSAGE_TYPES.VIEWER_READY
    ) {
      return;
    }

    const previousViewerInstanceId = this.viewerSession?.viewerInstanceId;

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
