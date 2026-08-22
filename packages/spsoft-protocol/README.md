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
| Viewer → host | `MEASUREMENT_ADDED` |
| Viewer → host | `MEASUREMENT_UPDATED` |

Every message uses channel `spsoft.viewer-bridge`, protocol version `1` and a caller-provided
`messageId`. Callers generate IDs with `crypto.randomUUID()` so tests can supply deterministic
values.

## Boundary validation

Use `parseBridgeMessage` before reading an incoming payload, then apply
`isHostToViewerMessage` or `isViewerToHostMessage` for the expected direction. Consumers must
also verify `MessageEvent.origin` and `MessageEvent.source`; those checks depend on the iframe
and therefore stay outside this transport-only package.

Area measurements keep both a canonical `unit` for grouping and the exact OHIF `rawUnit` for
diagnostics. `normalizeAreaUnit` supports `mm²`, `cm²`, `px²` and calibration suffixes such as
`ERMF` or `US Region`. Use `createAreaMeasurement` to keep those fields consistent. For totals,
use `getAreaAggregationKey`; unknown raw units receive separate aggregation buckets.

## Validation

From the repository root:

```bash
yarn typecheck:protocol
yarn test:protocol
```
