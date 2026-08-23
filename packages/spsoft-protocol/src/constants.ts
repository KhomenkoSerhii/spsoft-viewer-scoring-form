export const BRIDGE_CHANNEL = 'spsoft.viewer-bridge' as const;
export const BRIDGE_VERSION = 1 as const;

export const BRIDGE_MESSAGE_TYPES = {
  VIEWER_READY: 'VIEWER_READY',
  ACTIVATE_TOOL: 'ACTIVATE_TOOL',
  DEACTIVATE_TOOL: 'DEACTIVATE_TOOL',
  FOCUS_MEASUREMENT: 'FOCUS_MEASUREMENT',
  REMOVE_MEASUREMENT: 'REMOVE_MEASUREMENT',
  MEASUREMENT_ADDED: 'MEASUREMENT_ADDED',
  MEASUREMENT_UPDATED: 'MEASUREMENT_UPDATED',
  MEASUREMENT_REMOVED: 'MEASUREMENT_REMOVED',
} as const;

export const SUPPORTED_TOOLS = ['EllipticalROI', 'Length'] as const;

export const AREA_UNITS = ['mm2', 'cm2', 'px2', 'unknown'] as const;
export const LENGTH_UNITS = ['mm', 'cm', 'px', 'unknown'] as const;

export const DEACTIVATION_REASONS = ['user-cancelled', 'superseded', 'host-unmounted'] as const;
