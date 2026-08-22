import { DEFAULT_VIEWER_ORIGIN, resolveViewerOrigin } from './viewerConfiguration';

describe('resolveViewerOrigin', () => {
  it('uses the default Viewer origin when no override is configured', () => {
    expect(resolveViewerOrigin()).toEqual({ origin: DEFAULT_VIEWER_ORIGIN });
  });

  it.each([
    ['http://localhost:3000/', 'http://localhost:3000'],
    ['https://viewer.example:8443', 'https://viewer.example:8443'],
  ])('normalizes the exact HTTP(S) origin %s', (configuredOrigin, expectedOrigin) => {
    expect(resolveViewerOrigin(configuredOrigin)).toEqual({ origin: expectedOrigin });
  });

  it.each([
    'not a URL',
    'file:///tmp/viewer',
    'https://viewer.example/viewer',
    'https://viewer.example?tenant=one',
    'https://user:secret@viewer.example',
  ])('falls back safely for invalid origin %s', configuredOrigin => {
    expect(resolveViewerOrigin(configuredOrigin)).toEqual({
      origin: DEFAULT_VIEWER_ORIGIN,
      warning: expect.stringContaining('Invalid VITE_VIEWER_ORIGIN'),
    });
  });
});
