import {
  AREA_UNITS,
  BRIDGE_CHANNEL,
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_VERSION,
  DEACTIVATION_REASONS,
  SUPPORTED_TOOLS,
} from './constants';
import type {
  ActivateToolPayload,
  AreaMeasurement,
  BridgeMessage,
  DeactivateToolPayload,
  HostToViewerMessage,
  MeasurementAddedPayload,
  MeasurementRemovedPayload,
  MeasurementUpdatedPayload,
  RemoveMeasurementPayload,
  SupportedToolName,
  ViewerReadyPayload,
  ViewerToHostMessage,
} from './types';
import { normalizeAreaUnit } from './units';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf<TValue extends string>(
  value: unknown,
  allowedValues: readonly TValue[]
): value is TValue {
  return typeof value === 'string' && allowedValues.includes(value as TValue);
}

function parseAreaMeasurement(value: unknown): AreaMeasurement | null {
  if (!isRecord(value)) {
    return null;
  }

  const hasValidCalibrationType =
    value.calibrationType === undefined || isNonEmptyString(value.calibrationType);
  const normalizedUnit = isNonEmptyString(value.rawUnit) ? normalizeAreaUnit(value.rawUnit) : null;

  if (
    value.kind !== 'area' ||
    typeof value.value !== 'number' ||
    !Number.isFinite(value.value) ||
    value.value < 0 ||
    !isOneOf(value.unit, AREA_UNITS) ||
    normalizedUnit === null ||
    value.unit !== normalizedUnit.unit ||
    value.calibrationType !== normalizedUnit.calibrationType ||
    !hasValidCalibrationType
  ) {
    return null;
  }

  return {
    kind: 'area',
    value: value.value,
    ...normalizedUnit,
  };
}

function parseViewerReadyPayload(value: unknown): ViewerReadyPayload | null {
  if (!isRecord(value) || !isRecord(value.capabilities)) {
    return null;
  }

  if (
    !isNonEmptyString(value.viewerInstanceId) ||
    !Array.isArray(value.supportedTools) ||
    typeof value.capabilities.measurementDeletion !== 'boolean' ||
    typeof value.capabilities.measurementUpdates !== 'boolean'
  ) {
    return null;
  }

  const supportedTools: SupportedToolName[] = [];

  for (const toolName of value.supportedTools) {
    if (!isOneOf(toolName, SUPPORTED_TOOLS)) {
      return null;
    }

    supportedTools.push(toolName);
  }

  return {
    viewerInstanceId: value.viewerInstanceId,
    supportedTools,
    capabilities: {
      measurementDeletion: value.capabilities.measurementDeletion,
      measurementUpdates: value.capabilities.measurementUpdates,
    },
  };
}

function parseActivateToolPayload(value: unknown): ActivateToolPayload | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.targetViewerInstanceId) ||
    !isNonEmptyString(value.rowId) ||
    !isNonEmptyString(value.activationId) ||
    !isOneOf(value.toolName, SUPPORTED_TOOLS)
  ) {
    return null;
  }

  return {
    targetViewerInstanceId: value.targetViewerInstanceId,
    rowId: value.rowId,
    activationId: value.activationId,
    toolName: value.toolName,
  };
}

function parseDeactivateToolPayload(value: unknown): DeactivateToolPayload | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.targetViewerInstanceId) ||
    !isNonEmptyString(value.rowId) ||
    !isNonEmptyString(value.activationId) ||
    !isOneOf(value.reason, DEACTIVATION_REASONS)
  ) {
    return null;
  }

  return {
    targetViewerInstanceId: value.targetViewerInstanceId,
    rowId: value.rowId,
    activationId: value.activationId,
    reason: value.reason,
  };
}

function parseRemoveMeasurementPayload(value: unknown): RemoveMeasurementPayload | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.targetViewerInstanceId) ||
    !isNonEmptyString(value.rowId) ||
    !isNonEmptyString(value.annotationId)
  ) {
    return null;
  }

  return {
    targetViewerInstanceId: value.targetViewerInstanceId,
    rowId: value.rowId,
    annotationId: value.annotationId,
  };
}

function parseMeasurementAddedPayload(value: unknown): MeasurementAddedPayload | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.viewerInstanceId) ||
    !isNonEmptyString(value.rowId) ||
    !isNonEmptyString(value.activationId) ||
    !isNonEmptyString(value.annotationId)
  ) {
    return null;
  }

  const measurement = parseAreaMeasurement(value.measurement);

  if (!measurement) {
    return null;
  }

  return {
    viewerInstanceId: value.viewerInstanceId,
    rowId: value.rowId,
    activationId: value.activationId,
    annotationId: value.annotationId,
    measurement,
  };
}

function parseMeasurementUpdatedPayload(value: unknown): MeasurementUpdatedPayload | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.viewerInstanceId) ||
    !isNonEmptyString(value.rowId) ||
    !isNonEmptyString(value.annotationId)
  ) {
    return null;
  }

  const measurement = parseAreaMeasurement(value.measurement);

  if (!measurement) {
    return null;
  }

  return {
    viewerInstanceId: value.viewerInstanceId,
    rowId: value.rowId,
    annotationId: value.annotationId,
    measurement,
  };
}

function parseMeasurementRemovedPayload(value: unknown): MeasurementRemovedPayload | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.viewerInstanceId) ||
    !isNonEmptyString(value.rowId) ||
    !isNonEmptyString(value.annotationId)
  ) {
    return null;
  }

  return {
    viewerInstanceId: value.viewerInstanceId,
    rowId: value.rowId,
    annotationId: value.annotationId,
  };
}

export function parseBridgeMessage(value: unknown): BridgeMessage | null {
  if (
    !isRecord(value) ||
    value.channel !== BRIDGE_CHANNEL ||
    value.version !== BRIDGE_VERSION ||
    !isNonEmptyString(value.messageId)
  ) {
    return null;
  }

  switch (value.type) {
    case BRIDGE_MESSAGE_TYPES.VIEWER_READY: {
      const payload = parseViewerReadyPayload(value.payload);

      if (!payload) {
        return null;
      }

      return {
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.VIEWER_READY,
        messageId: value.messageId,
        payload,
      };
    }
    case BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL: {
      const payload = parseActivateToolPayload(value.payload);

      if (!payload) {
        return null;
      }

      return {
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
        messageId: value.messageId,
        payload,
      };
    }
    case BRIDGE_MESSAGE_TYPES.DEACTIVATE_TOOL: {
      const payload = parseDeactivateToolPayload(value.payload);

      if (!payload) {
        return null;
      }

      return {
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.DEACTIVATE_TOOL,
        messageId: value.messageId,
        payload,
      };
    }
    case BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT: {
      const payload = parseRemoveMeasurementPayload(value.payload);

      if (!payload) {
        return null;
      }

      return {
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT,
        messageId: value.messageId,
        payload,
      };
    }
    case BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED: {
      const payload = parseMeasurementAddedPayload(value.payload);

      if (!payload) {
        return null;
      }

      return {
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED,
        messageId: value.messageId,
        payload,
      };
    }
    case BRIDGE_MESSAGE_TYPES.MEASUREMENT_UPDATED: {
      const payload = parseMeasurementUpdatedPayload(value.payload);

      if (!payload) {
        return null;
      }

      return {
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_UPDATED,
        messageId: value.messageId,
        payload,
      };
    }
    case BRIDGE_MESSAGE_TYPES.MEASUREMENT_REMOVED: {
      const payload = parseMeasurementRemovedPayload(value.payload);

      if (!payload) {
        return null;
      }

      return {
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENT_REMOVED,
        messageId: value.messageId,
        payload,
      };
    }
    default:
      return null;
  }
}

export function isHostToViewerMessage(message: BridgeMessage): message is HostToViewerMessage {
  return (
    message.type === BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL ||
    message.type === BRIDGE_MESSAGE_TYPES.DEACTIVATE_TOOL ||
    message.type === BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT
  );
}

export function isViewerToHostMessage(message: BridgeMessage): message is ViewerToHostMessage {
  return !isHostToViewerMessage(message);
}
