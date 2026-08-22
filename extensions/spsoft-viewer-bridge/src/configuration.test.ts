import { parseViewerBridgeConfiguration } from './configuration';

describe('parseViewerBridgeConfiguration', () => {
  it('accepts an exact HTTP(S) origin and removes one trailing slash', () => {
    expect(parseViewerBridgeConfiguration({ hostOrigin: 'https://host.example/' })).toEqual({
      hostOrigin: 'https://host.example',
    });
  });

  it.each([
    undefined,
    {},
    { hostOrigin: '' },
    { hostOrigin: '*' },
    { hostOrigin: 'file:///tmp/host.html' },
    { hostOrigin: 'https://host.example/path' },
    { hostOrigin: 'https://host.example?query=1' },
    { hostOrigin: 'https://host.example/#fragment' },
  ])('rejects unsafe or malformed configuration %#', configuration => {
    expect(() => parseViewerBridgeConfiguration(configuration)).toThrow(TypeError);
  });
});
