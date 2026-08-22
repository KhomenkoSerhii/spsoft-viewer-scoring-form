# SPSoft OHIF viewer bridge

OHIF extension that owns the Viewer side of the secure `postMessage` boundary.

The extension registers its message listener during `preRegistration`, creates a fresh
`viewerInstanceId` for every mode session, and waits for an active viewport and tool group before
sending `VIEWER_READY`. Messages use the shared `@spsoft/viewer-protocol` contract.

## Configuration

Register the extension with an exact host origin:

```js
extensions: [
  [
    '@spsoft/extension-viewer-bridge',
    {
      hostOrigin: 'http://localhost:5173',
    },
  ],
];
```

Wildcard origins and URLs containing paths, query strings, or fragments are rejected.

## Current scope

This package currently implements the secure boundary and `VIEWER_READY` handshake. Tool
activation and measurement correlation are added in the following focused PRs.
