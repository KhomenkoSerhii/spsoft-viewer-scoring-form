export const DEFAULT_VIEWER_ORIGIN = 'http://localhost:3000';

export interface ViewerOriginConfiguration {
  origin: string;
  warning?: string;
}

export function resolveViewerOrigin(configuredOrigin?: string): ViewerOriginConfiguration {
  const candidate = configuredOrigin?.trim() || DEFAULT_VIEWER_ORIGIN;

  try {
    const url = new URL(candidate);
    const isHttpOrigin = url.protocol === 'http:' || url.protocol === 'https:';
    const isExactOrigin =
      !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;

    if (!isHttpOrigin || !isExactOrigin) {
      throw new Error('Viewer URL must be an exact HTTP(S) origin.');
    }

    return { origin: url.origin };
  } catch {
    return {
      origin: DEFAULT_VIEWER_ORIGIN,
      warning: `Invalid VITE_VIEWER_ORIGIN "${candidate}". Falling back to ${DEFAULT_VIEWER_ORIGIN}.`,
    };
  }
}
