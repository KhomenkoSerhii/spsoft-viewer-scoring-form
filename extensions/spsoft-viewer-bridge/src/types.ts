import type { HostToViewerMessage } from '@spsoft/viewer-protocol';

export interface BridgeSubscription {
  unsubscribe(): void;
}

export interface BridgeEventService {
  readonly EVENTS: Record<string, string>;
  subscribe(eventName: string, callback: () => void): BridgeSubscription;
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

export interface ViewerBridgeServices {
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
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

export type HostMessageHandler = (message: HostToViewerMessage) => void;
