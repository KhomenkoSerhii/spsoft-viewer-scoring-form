import type { Measurement, SupportedToolName } from './types';

export function measurementMatchesTool(
  measurement: Measurement,
  toolName: SupportedToolName
): boolean {
  return (
    (toolName === 'EllipticalROI' && measurement.kind === 'area') ||
    (toolName === 'Length' && measurement.kind === 'length')
  );
}
