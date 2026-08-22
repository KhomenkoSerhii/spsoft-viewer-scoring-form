import {
  AREA_UNITS,
  BRIDGE_CHANNEL,
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_VERSION,
  DEACTIVATION_REASONS,
  SUPPORTED_TOOLS,
} from './constants';

export type BridgeMessageType = (typeof BRIDGE_MESSAGE_TYPES)[keyof typeof BRIDGE_MESSAGE_TYPES];
export type SupportedToolName = (typeof SUPPORTED_TOOLS)[number];
export type AreaUnit = (typeof AREA_UNITS)[number];
export type DeactivationReason = (typeof DEACTIVATION_REASONS)[number];

export interface AreaMeasurement {
  kind: 'area';
  value: number;
  unit: AreaUnit;
  rawUnit: string;
  calibrationType?: string;
}

export interface ViewerReadyPayload {
  viewerInstanceId: string;
  supportedTools: SupportedToolName[];
  capabilities: {
    measurementUpdates: boolean;
  };
}

export interface ActivateToolPayload {
  targetViewerInstanceId: string;
  rowId: string;
  activationId: string;
  toolName: SupportedToolName;
}

export interface DeactivateToolPayload {
  targetViewerInstanceId: string;
  rowId: string;
  activationId: string;
  reason: DeactivationReason;
}

export interface MeasurementAddedPayload {
  viewerInstanceId: string;
  rowId: string;
  activationId: string;
  annotationId: string;
  measurement: AreaMeasurement;
}

export interface MeasurementUpdatedPayload {
  viewerInstanceId: string;
  rowId: string;
  annotationId: string;
  measurement: AreaMeasurement;
}

export interface BridgePayloadByType {
  VIEWER_READY: ViewerReadyPayload;
  ACTIVATE_TOOL: ActivateToolPayload;
  DEACTIVATE_TOOL: DeactivateToolPayload;
  MEASUREMENT_ADDED: MeasurementAddedPayload;
  MEASUREMENT_UPDATED: MeasurementUpdatedPayload;
}

export interface BridgeMessageFor<TType extends BridgeMessageType> {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_VERSION;
  type: TType;
  messageId: string;
  payload: BridgePayloadByType[TType];
}

export type BridgeMessage = {
  [TType in BridgeMessageType]: BridgeMessageFor<TType>;
}[BridgeMessageType];

export type HostToViewerMessage =
  | BridgeMessageFor<typeof BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL>
  | BridgeMessageFor<typeof BRIDGE_MESSAGE_TYPES.DEACTIVATE_TOOL>;

export type ViewerToHostMessage = Exclude<BridgeMessage, HostToViewerMessage>;
