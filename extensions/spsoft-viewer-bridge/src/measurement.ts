import { createAreaMeasurement, type AreaMeasurement } from '@spsoft/viewer-protocol';

interface ExtractedAreaMeasurement {
  annotationId: string;
  measurement: AreaMeasurement;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractEllipticalRoiMeasurement(event: unknown): ExtractedAreaMeasurement | null {
  if (!isRecord(event) || !isRecord(event.measurement)) {
    return null;
  }

  const { measurement } = event;

  if (
    measurement.toolName !== 'EllipticalROI' ||
    typeof measurement.uid !== 'string' ||
    !measurement.uid.trim() ||
    !isRecord(measurement.data)
  ) {
    return null;
  }

  for (const value of Object.values(measurement.data)) {
    if (!isRecord(value) || typeof value.area !== 'number' || typeof value.areaUnit !== 'string') {
      continue;
    }

    try {
      return {
        annotationId: measurement.uid,
        measurement: createAreaMeasurement(value.area, value.areaUnit),
      };
    } catch {
      // Ignore incomplete or invalid stats and keep waiting for a valid completed annotation.
    }
  }

  return null;
}
