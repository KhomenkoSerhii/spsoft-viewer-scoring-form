import type { HostToViewerMessage } from '@spsoft/viewer-protocol';

export interface BridgeSubscription {
  unsubscribe(): void;
}

export interface BridgeEventService {
  readonly EVENTS: Record<string, string>;
  subscribe(eventName: string, callback: (event: unknown) => void): BridgeSubscription;
}

export interface ViewportGridState {
  activeViewportId?: string;
  viewports: { size: number };
}

export interface ViewportGridService extends BridgeEventService {
  getState(): ViewportGridState;
}

export interface ToolGroup {
  hasTool(toolName: string): boolean;
}

export interface ToolGroupService extends BridgeEventService {
  getToolGroup(): ToolGroup | undefined;
}

export interface MeasurementService extends BridgeEventService {
  getMeasurement(measurementId: string): unknown;
  remove(measurementId: string): void;
}

export interface DisplaySetService {
  getDisplaySetsForSeries(seriesInstanceUid: string): Array<{
    displaySetInstanceUID?: string;
    uid?: string;
  }>;
}

export interface AnnotationRepository {
  add(annotation: Record<string, unknown>): string;
  get(annotationId: string): Record<string, unknown> | undefined;
  remove(annotationId: string): void;
}

export interface CornerstoneViewportService {
  getRenderingEngine():
    | {
        getViewport(viewportId: string): { element?: HTMLDivElement } | undefined;
      }
    | undefined;
}

export interface ViewerBridgeServices {
  cornerstoneViewportService?: CornerstoneViewportService;
  displaySetService?: DisplaySetService;
  measurementService: MeasurementService;
  viewportGridService: ViewportGridService;
  toolGroupService: ToolGroupService;
}

export interface ViewerBridgeCommandsManager {
  runCommand(commandName: string, options: Record<string, unknown>): unknown;
}

export interface MessageTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface BridgeWindow {
  readonly parent: MessageTarget;
  addEventListener(
    type: 'message' | 'pagehide',
    listener: ((event: MessageEvent<unknown>) => void) | (() => void)
  ): void;
  removeEventListener(
    type: 'message' | 'pagehide',
    listener: ((event: MessageEvent<unknown>) => void) | (() => void)
  ): void;
}

export type HostMessageHandler = (message: HostToViewerMessage) => void;
