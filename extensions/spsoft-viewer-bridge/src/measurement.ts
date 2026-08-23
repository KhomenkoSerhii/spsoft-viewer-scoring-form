import {
  createAreaMeasurement,
  createLengthMeasurement,
  SUPPORTED_TOOLS,
  type Measurement,
  type SupportedToolName,
} from '@spsoft/viewer-protocol';

interface ExtractedMeasurement {
  annotationId: string;
  measurement: Measurement;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSupportedToolName(value: unknown): value is SupportedToolName {
  return typeof value === 'string' && SUPPORTED_TOOLS.includes(value as SupportedToolName);
}

function getSupportedMeasurement(
  event: unknown,
  expectedToolName?: SupportedToolName
): UnknownRecord | null {
  if (!isRecord(event) || !isRecord(event.measurement)) {
    return null;
  }

  const { measurement } = event;

  if (
    !isSupportedToolName(measurement.toolName) ||
    (expectedToolName !== undefined && measurement.toolName !== expectedToolName) ||
    typeof measurement.uid !== 'string' ||
    !measurement.uid.trim()
  ) {
    return null;
  }

  return measurement;
}

export function extractSupportedMeasurementAnnotationId(
  event: unknown,
  expectedToolName?: SupportedToolName
): string | null {
  const measurement = getSupportedMeasurement(event, expectedToolName);
  return measurement ? (measurement.uid as string) : null;
}

export function extractRemovedAnnotationId(event: unknown): string | null {
  if (!isRecord(event) || typeof event.measurement !== 'string' || !event.measurement.trim()) {
    return null;
  }

  return event.measurement;
}

export function extractSupportedMeasurement(
  event: unknown,
  expectedToolName?: SupportedToolName
): ExtractedMeasurement | null {
  const measurement = getSupportedMeasurement(event, expectedToolName);

  if (!measurement || !isRecord(measurement.data)) {
    return null;
  }

  for (const value of Object.values(measurement.data)) {
    if (!isRecord(value)) {
      continue;
    }

    try {
      const normalizedMeasurement =
        measurement.toolName === 'EllipticalROI' &&
        typeof value.area === 'number' &&
        typeof value.areaUnit === 'string'
          ? createAreaMeasurement(value.area, value.areaUnit)
          : measurement.toolName === 'Length' &&
              typeof value.length === 'number' &&
              typeof value.unit === 'string'
            ? createLengthMeasurement(value.length, value.unit)
            : null;

      if (!normalizedMeasurement) {
        continue;
      }

      return {
        annotationId: measurement.uid as string,
        measurement: normalizedMeasurement,
      };
    } catch {
      // Ignore incomplete or invalid stats and keep waiting for a valid completed annotation.
    }
  }

  return null;
}
