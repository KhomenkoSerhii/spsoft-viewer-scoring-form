import {
  AREA_UNITS,
  BRIDGE_CHANNEL,
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_VERSION,
  COMMAND_REJECTION_REASONS,
  DEACTIVATION_REASONS,
  LENGTH_UNITS,
  SUPPORTED_TOOLS,
} from './constants';

export type BridgeMessageType = (typeof BRIDGE_MESSAGE_TYPES)[keyof typeof BRIDGE_MESSAGE_TYPES];
export type SupportedToolName = (typeof SUPPORTED_TOOLS)[number];
export type AreaUnit = (typeof AREA_UNITS)[number];
export type LengthUnit = (typeof LENGTH_UNITS)[number];
export type DeactivationReason = (typeof DEACTIVATION_REASONS)[number];
export type CommandRejectionReason = (typeof COMMAND_REJECTION_REASONS)[number];

export interface AreaMeasurement {
  kind: 'area';
  value: number;
  unit: AreaUnit;
  rawUnit: string;
  calibrationType?: string;
}

export interface LengthMeasurement {
  kind: 'length';
  value: number;
  unit: LengthUnit;
  rawUnit: string;
  calibrationType?: string;
}

export type Measurement = AreaMeasurement | LengthMeasurement;

export interface ViewerReadyPayload {
  viewerInstanceId: string;
  supportedTools: SupportedToolName[];
  capabilities: {
    measurementDeletion: boolean;
    measurementFocus: boolean;
    measurementUpdates: boolean;
    statePersistence: boolean;
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

export interface RemoveMeasurementPayload {
  targetViewerInstanceId: string;
  rowId: string;
  annotationId: string;
}

export interface FocusMeasurementPayload {
  targetViewerInstanceId: string;
  rowId: string;
  annotationId: string;
}

export interface MeasurementBinding {
  annotationId: string;
  rowId: string;
  toolName: SupportedToolName;
}

export interface RestoreMeasurementsPayload {
  targetViewerInstanceId: string;
  measurements: MeasurementBinding[];
}

export interface RestoredMeasurement extends MeasurementBinding {
  measurement: Measurement;
}

export interface MeasurementsRestoredPayload {
  viewerInstanceId: string;
  measurements: RestoredMeasurement[];
}

export interface MeasurementAddedPayload {
  viewerInstanceId: string;
  rowId: string;
  activationId: string;
  annotationId: string;
  measurement: Measurement;
}

export interface MeasurementUpdatedPayload {
  viewerInstanceId: string;
  rowId: string;
  annotationId: string;
  measurement: Measurement;
}

export interface MeasurementRemovedPayload {
  viewerInstanceId: string;
  rowId: string;
  annotationId: string;
}

export interface ActivateToolCommandRejectedPayload {
  viewerInstanceId: string;
  command: typeof BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL;
  rowId: string;
  activationId: string;
  reason: CommandRejectionReason;
}

export interface RemoveMeasurementCommandRejectedPayload {
  viewerInstanceId: string;
  command: typeof BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT;
  rowId: string;
  annotationId: string;
  reason: CommandRejectionReason;
}

export type CommandRejectedPayload =
  | ActivateToolCommandRejectedPayload
  | RemoveMeasurementCommandRejectedPayload;

export interface BridgePayloadByType {
  VIEWER_READY: ViewerReadyPayload;
  ACTIVATE_TOOL: ActivateToolPayload;
  DEACTIVATE_TOOL: DeactivateToolPayload;
  FOCUS_MEASUREMENT: FocusMeasurementPayload;
  REMOVE_MEASUREMENT: RemoveMeasurementPayload;
  RESTORE_MEASUREMENTS: RestoreMeasurementsPayload;
  MEASUREMENT_ADDED: MeasurementAddedPayload;
  MEASUREMENT_UPDATED: MeasurementUpdatedPayload;
  MEASUREMENT_REMOVED: MeasurementRemovedPayload;
  MEASUREMENTS_RESTORED: MeasurementsRestoredPayload;
  COMMAND_REJECTED: CommandRejectedPayload;
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
  | BridgeMessageFor<typeof BRIDGE_MESSAGE_TYPES.DEACTIVATE_TOOL>
  | BridgeMessageFor<typeof BRIDGE_MESSAGE_TYPES.FOCUS_MEASUREMENT>
  | BridgeMessageFor<typeof BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT>
  | BridgeMessageFor<typeof BRIDGE_MESSAGE_TYPES.RESTORE_MEASUREMENTS>;

export type ViewerToHostMessage = Exclude<BridgeMessage, HostToViewerMessage>;
