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

The first valid `MEASUREMENT_ADDED` event for the armed ellipse is normalized to the shared area
contract, correlated with its `rowId` and `activationId`, sent to the host, and followed by a return
to Pan. If OHIF has not populated `cachedStats` yet, the bridge remembers that annotation and
finishes it from the matching `MEASUREMENT_UPDATED` event. Unrelated, malformed, unarmed and
duplicate measurement events are ignored.

After creation, later `MEASUREMENT_UPDATED` events keep the correlated form row synchronized while
the user edits the ellipse. `FOCUS_MEASUREMENT` verifies the established binding and uses OHIF's
`jumpToMeasurementViewport` command to select the annotation and navigate a compatible viewport. A
correlated `REMOVE_MEASUREMENT` command removes the OHIF measurement; the resulting service event
is returned as `MEASUREMENT_REMOVED`. Deletion initiated directly in OHIF uses the same event path.
Events and commands for annotations that were not created through the bridge are ignored.

Mode exit restores Pan, removes the window listener, unsubscribes from OHIF services, cancels
readiness retries, and clears session bindings.
