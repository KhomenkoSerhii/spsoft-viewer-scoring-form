# SPSoft OHIF viewer bridge

OHIF extension that owns the Viewer side of the secure `postMessage` boundary.

The extension registers its message listener during `preRegistration`, creates a fresh
`viewerInstanceId` for every mode session, and waits for an active viewport and tool group before
sending `VIEWER_READY`. Messages use the shared `@spsoft/viewer-protocol` contract.

## Configuration

Add the extension as a mode dependency and configure an exact host origin at the top level of the
OHIF app config:

```js
window.config = {
  spsoftViewerBridge: {
    hostOrigin: 'http://localhost:5173',
  },
};
```

Wildcard origins and URLs containing paths, query strings, or fragments are rejected.

## Current scope

The bridge implements the secure boundary, `VIEWER_READY` handshake, and correlated
`ACTIVATE_TOOL`/`DEACTIVATE_TOOL` commands for `EllipticalROI`. A valid activation arms the OHIF
tool through `commandsManager`; cancellation, replacement and mode cleanup restore Pan.

Measurement-created and measurement-updated events are intentionally added in the following
focused PR.
