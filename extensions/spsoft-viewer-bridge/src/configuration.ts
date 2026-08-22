export interface ViewerBridgeConfiguration {
  hostOrigin: string;
}

export function parseViewerBridgeConfiguration(value: unknown): ViewerBridgeConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Viewer bridge configuration must be an object.');
  }

  const hostOrigin = (value as Record<string, unknown>).hostOrigin;

  if (typeof hostOrigin !== 'string' || !hostOrigin.trim()) {
    throw new TypeError('Viewer bridge hostOrigin must be a non-empty string.');
  }

  const configuredOrigin = hostOrigin.trim().replace(/\/$/, '');
  let url: URL;

  try {
    url = new URL(configuredOrigin);
  } catch {
    throw new TypeError('Viewer bridge hostOrigin must be an exact HTTP(S) origin.');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== configuredOrigin) {
    throw new TypeError('Viewer bridge hostOrigin must be an exact HTTP(S) origin.');
  }

  return { hostOrigin: url.origin };
}
