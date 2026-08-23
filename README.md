# Viewer + Scoring Form

This repository contains the SPSoft frontend test assignment. It is an OHIF Viewer fork with a
separate React scoring form. The applications run on different origins and communicate through a
typed `window.postMessage` protocol.

- OHIF Viewer: <http://localhost:3000>
- Host app: <http://localhost:5173>

The host app embeds the Viewer in an iframe. A user can add an area or length row, activate
`EllipticalROI` or `Length`, draw an annotation, and receive the value in the matching row. Later
edits and deletions stay synchronized in both directions. Clicking a completed form row selects its
annotation and navigates the Viewer to it. Area and length totals are calculated independently.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the message contract and implementation decisions.

## Implemented scope

- `VIEWER_READY` handshake with one queued early activation
- strict origin, source, protocol version, session, and payload checks
- correlated activation, cancellation, creation, focus navigation, live updates, and deletion
- automatic return to Pan after drawing or cancellation
- separate area totals for `mm²`, `cm²`, `px²` and length totals for `mm`, `cm`, `px`
- cleanup on iframe reload, mode exit, and React unmount
- focused unit tests and two Playwright integration scenarios

Optional tasks 5.1 (live updates), 5.2 (bidirectional deletion), 5.3 (focus navigation), and 5.4
(Length measurements) are included. Viewport version labels and persistence after a full page
reload are outside the current scope.

## Prerequisites

- Node.js `20.19.0` or a compatible newer version
- Yarn Classic `1.22.22`
- a modern browser
- internet access on first start to install packages and load the public DICOM study
- free local ports `3000` and `5173`

The required Node version is also recorded in [`.node-version`](./.node-version).

## Start from a clean clone

```bash
git clone --branch spsoft/main --single-branch \
  https://github.com/KhomenkoSerhii/spsoft-viewer-scoring-form.git
cd spsoft-viewer-scoring-form
yarn dev:spsoft
```

Open <http://localhost:5173>. The first start can take several minutes while OHIF compiles and the
public study loads.

`yarn dev:spsoft` checks whether the required packages are present. If they are missing, it runs
`yarn install --frozen-lockfile` before starting both applications. If dependencies are already
installed, it starts them immediately. Press `Ctrl+C` once to stop both processes.

To install dependencies separately:

```bash
yarn install --frozen-lockfile
yarn dev:spsoft
```

## Run the applications separately

Use two terminals from the repository root:

```bash
yarn dev:viewer
```

```bash
yarn dev:host
```

Open the host app at <http://localhost:5173>. Opening port `3000` directly shows only OHIF, without
the scoring form.

## Configuration

The default setup loads the public OHIF measurement study and expects the Viewer at
`http://localhost:3000`.

```bash
cp host-app/.env.example host-app/.env.local
```

Available values:

```dotenv
VITE_VIEWER_ORIGIN=http://localhost:3000
VITE_VIEWER_STUDY_UID=1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5
```

`VITE_VIEWER_ORIGIN` must be an exact HTTP(S) origin without a path, query, credentials, or hash.
The Viewer has a matching `spsoftViewerBridge.hostOrigin` entry in
[`platform/app/public/config/default.js`](./platform/app/public/config/default.js).

## Use the form

1. Wait until the form shows that the Viewer is connected.
2. Select **Додати площу** or **Додати довжину**.
3. Select **Активувати Ellipse** or **Активувати Length** in the new row.
4. Draw the corresponding annotation in the Viewer.
5. Select a completed form row to highlight its annotation and navigate to it in the Viewer.
6. Drag an annotation handle to see its value and corresponding total update.
7. Delete from the form to remove the annotation, or delete in OHIF to clear the linked row.

The displayed DICOM data comes from the public data source in the default OHIF configuration. No
backend or local DICOM server is required.

## Checks

The SPSoft test command covers only the code added for this assignment. It does not run the full
upstream OHIF test suite.

```bash
yarn test:spsoft
```

This runs the protocol, Viewer bridge, and host Jest projects, followed by the Playwright smoke
tests. The browser tests start both development servers themselves.

Type checks and the host production build are available separately:

```bash
yarn typecheck:protocol
yarn typecheck:viewer-bridge
yarn typecheck:host
yarn build:host
```

Package-level tests:

```bash
yarn test:protocol
yarn test:viewer-bridge
yarn test:host
yarn test:smoke:spsoft
```

## Project layout

```text
host-app/                              React scoring form
extensions/spsoft-viewer-bridge/       OHIF-side bridge extension
packages/spsoft-protocol/              shared types, parser, and unit normalization
tests-spsoft/                           focused Playwright scenarios
.scripts/dev-spsoft.mjs                 combined development launcher
platform/app/public/config/default.js   local origin and DICOM data-source configuration
```

The rest of the monorepo is the upstream [OHIF Viewer](https://github.com/OHIF/Viewers) source.
OHIF licensing files and package-level documentation remain in their original locations.
