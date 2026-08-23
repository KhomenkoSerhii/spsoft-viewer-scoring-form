# SPSoft viewer protocol

Shared TypeScript contract for communication between `host-app` and the OHIF bridge extension.
The package has no runtime dependencies and treats every incoming `MessageEvent.data` value as
untrusted.

## Messages

| Direction | Type |
| --- | --- |
| Viewer → host | `VIEWER_READY` |
| Host → viewer | `ACTIVATE_TOOL` |
| Host → viewer | `DEACTIVATE_TOOL` |
| Host → viewer | `FOCUS_MEASUREMENT` |
| Host → viewer | `REMOVE_MEASUREMENT` |
| Host → viewer | `RESTORE_MEASUREMENTS` |
| Viewer → host | `MEASUREMENT_ADDED` |
| Viewer → host | `MEASUREMENT_UPDATED` |
| Viewer → host | `MEASUREMENT_REMOVED` |
| Viewer → host | `MEASUREMENTS_RESTORED` |

Every message uses channel `spsoft.viewer-bridge`, protocol version `1` and a caller-provided
`messageId`. Callers generate IDs with `crypto.randomUUID()` so tests can supply deterministic
values.

`VIEWER_READY` advertises support for focus navigation, live updates, deletion, and persistence. Commands carry
the target Viewer session ID, while measurement events carry the session ID that produced them.
Creation also includes an activation ID; focus, updates, and removals use the established
row-to-annotation binding. For compatibility with Viewer builds that predate focus navigation, an
omitted `capabilities.measurementFocus` or `capabilities.statePersistence` is parsed as `false`; a
present value must be boolean.

Persistence uses a command/confirmation pair. `RESTORE_MEASUREMENTS` carries a bounded, unique list
of host-owned row/annotation/tool bindings. `MEASUREMENTS_RESTORED` returns only bindings that the
Viewer recreated, together with their validated normalized measurements.

## Boundary validation

Use `parseBridgeMessage` before reading an incoming payload, then apply
`isHostToViewerMessage` or `isViewerToHostMessage` for the expected direction. Consumers must
also verify `MessageEvent.origin` and `MessageEvent.source`; those checks depend on the iframe
and therefore stay outside this transport-only package.

Measurements form a discriminated `area | length` union and keep both a canonical `unit` for
grouping and the exact OHIF `rawUnit` for diagnostics. Area normalization supports `mm²`, `cm²`,
and `px²`; length normalization supports `mm`, `cm`, and `px`. Calibration suffixes such as `ERMF`
or `US Region` are retained. Use the matching creation and aggregation helpers; unknown raw units
receive separate aggregation buckets. `measurementMatchesTool` is the shared runtime rule that
binds `area` to `EllipticalROI` and `length` to `Length`.

The complete payload table and lifecycle are documented in the root
[`ARCHITECTURE.md`](../../ARCHITECTURE.md).

## Validation

From the repository root:

```bash
yarn typecheck:protocol
yarn test:protocol
```
