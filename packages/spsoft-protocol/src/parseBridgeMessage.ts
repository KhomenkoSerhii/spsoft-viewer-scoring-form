import {
  AREA_UNITS,
  BRIDGE_CHANNEL,
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_VERSION,
  DEACTIVATION_REASONS,
  LENGTH_UNITS,
  SUPPORTED_TOOLS,
} from './constants';
import type {
  ActivateToolPayload,
  AreaMeasurement,
  BridgeMessage,
  DeactivateToolPayload,
  FocusMeasurementPayload,
  HostToViewerMessage,
  LengthMeasurement,
  Measurement,
  MeasurementBinding,
  MeasurementAddedPayload,
  MeasurementRemovedPayload,
  MeasurementsRestoredPayload,
  MeasurementUpdatedPayload,
  RemoveMeasurementPayload,
  RestoreMeasurementsPayload,
  RestoredMeasurement,
  SupportedToolName,
  ViewerReadyPayload,
  ViewerToHostMessage,
} from './types';
import { normalizeAreaUnit, normalizeLengthUnit } from './units';
import { measurementMatchesTool } from './measurements';

type UnknownRecord = Record<string, unknown>;
const MAX_RESTORED_MEASUREMENTS = 100;

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

function parseLengthMeasurement(value: unknown): LengthMeasurement | null {
  if (!isRecord(value)) {
    return null;
  }

  const hasValidCalibrationType =
    value.calibrationType === undefined || isNonEmptyString(value.calibrationType);
  const normalizedUnit = isNonEmptyString(value.rawUnit)
    ? normalizeLengthUnit(value.rawUnit)
    : null;

  if (
    value.kind !== 'length' ||
    typeof value.value !== 'number' ||
    !Number.isFinite(value.value) ||
    value.value < 0 ||
    !isOneOf(value.unit, LENGTH_UNITS) ||
    normalizedUnit === null ||
    value.unit !== normalizedUnit.unit ||
    value.calibrationType !== normalizedUnit.calibrationType ||
    !hasValidCalibrationType
  ) {
    return null;
  }

  return {
    kind: 'length',
    value: value.value,
    ...normalizedUnit,
  };
}

export function parseMeasurement(value: unknown): Measurement | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind === 'area') {
    return parseAreaMeasurement(value);
  }

  if (value.kind === 'length') {
    return parseLengthMeasurement(value);
  }

  return null;
}

function parseViewerReadyPayload(value: unknown): ViewerReadyPayload | null {
  if (!isRecord(value) || !isRecord(value.capabilities)) {
    return null;
  }

  const measurementFocus = value.capabilities.measurementFocus;
  const statePersistence = value.capabilities.statePersistence;

  if (
    !isNonEmptyString(value.viewerInstanceId) ||
    !Array.isArray(value.supportedTools) ||
    typeof value.capabilities.measurementDeletion !== 'boolean' ||
    (measurementFocus !== undefined && typeof measurementFocus !== 'boolean') ||
    typeof value.capabilities.measurementUpdates !== 'boolean' ||
    (statePersistence !== undefined && typeof statePersistence !== 'boolean')
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
      measurementFocus: measurementFocus ?? false,
      measurementUpdates: value.capabilities.measurementUpdates,
      statePersistence: statePersistence ?? false,
    },
  };
}

function parseMeasurementBinding(value: unknown): MeasurementBinding | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.annotationId) ||
    !isNonEmptyString(value.rowId) ||
    !isOneOf(value.toolName, SUPPORTED_TOOLS)
  ) {
    return null;
  }

  return {
    annotationId: value.annotationId,
    rowId: value.rowId,
    toolName: value.toolName,
  };
}

function parseMeasurementBindings(value: unknown): MeasurementBinding[] | null {
  if (!Array.isArray(value) || value.length > MAX_RESTORED_MEASUREMENTS) {
    return null;
  }

  const measurements: MeasurementBinding[] = [];
  const annotationIds = new Set<string>();
  const rowIds = new Set<string>();

  for (const candidate of value) {
    const measurement = parseMeasurementBinding(candidate);

    if (
      !measurement ||
      annotationIds.has(measurement.annotationId) ||
      rowIds.has(measurement.rowId)
    ) {
      return null;
    }

    annotationIds.add(measurement.annotationId);
    rowIds.add(measurement.rowId);
    measurements.push(measurement);
  }

  return measurements;
}

function parseRestoreMeasurementsPayload(value: unknown): RestoreMeasurementsPayload | null {
  if (!isRecord(value) || !isNonEmptyString(value.targetViewerInstanceId)) {
    return null;
  }

  const measurements = parseMeasurementBindings(value.measurements);

  return measurements
    ? { targetViewerInstanceId: value.targetViewerInstanceId, measurements }
    : null;
}

function parseMeasurementsRestoredPayload(value: unknown): MeasurementsRestoredPayload | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.viewerInstanceId) ||
    !Array.isArray(value.measurements) ||
    value.measurements.length > MAX_RESTORED_MEASUREMENTS
  ) {
    return null;
  }

  const measurements: RestoredMeasurement[] = [];
  const annotationIds = new Set<string>();
  const rowIds = new Set<string>();

  for (const candidate of value.measurements) {
    const binding = parseMeasurementBinding(candidate);
    const measurement = isRecord(candidate) ? parseMeasurement(candidate.measurement) : null;

    if (
      !binding ||
      !measurement ||
      !measurementMatchesTool(measurement, binding.toolName) ||
      annotationIds.has(binding.annotationId) ||
      rowIds.has(binding.rowId)
    ) {
      return null;
    }

    annotationIds.add(binding.annotationId);
    rowIds.add(binding.rowId);
    measurements.push({ ...binding, measurement });
  }

  return { viewerInstanceId: value.viewerInstanceId, measurements };
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

function parseFocusMeasurementPayload(value: unknown): FocusMeasurementPayload | null {
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

  const measurement = parseMeasurement(value.measurement);

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

  const measurement = parseMeasurement(value.measurement);

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
    case BRIDGE_MESSAGE_TYPES.FOCUS_MEASUREMENT: {
      const payload = parseFocusMeasurementPayload(value.payload);

      if (!payload) {
        return null;
      }

      return {
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.FOCUS_MEASUREMENT,
        messageId: value.messageId,
        payload,
      };
    }
    case BRIDGE_MESSAGE_TYPES.RESTORE_MEASUREMENTS: {
      const payload = parseRestoreMeasurementsPayload(value.payload);

      if (!payload) {
        return null;
      }

      return {
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.RESTORE_MEASUREMENTS,
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
    case BRIDGE_MESSAGE_TYPES.MEASUREMENTS_RESTORED: {
      const payload = parseMeasurementsRestoredPayload(value.payload);

      if (!payload) {
        return null;
      }

      return {
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.MEASUREMENTS_RESTORED,
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
    message.type === BRIDGE_MESSAGE_TYPES.FOCUS_MEASUREMENT ||
    message.type === BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT ||
    message.type === BRIDGE_MESSAGE_TYPES.RESTORE_MEASUREMENTS
  );
}

export function isViewerToHostMessage(message: BridgeMessage): message is ViewerToHostMessage {
  return !isHostToViewerMessage(message);
}
