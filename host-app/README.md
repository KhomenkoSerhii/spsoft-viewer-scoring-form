# SPSoft host app

React + TypeScript shell for the Viewer + Scoring Form test task.

## Prerequisites

- Use the Node.js version from the repository's `.node-version` file.
- Yarn `1.22.22`.
- Install dependencies once from the repository root with `yarn install --frozen-lockfile`.

The host app intentionally uses Vite 3 because OHIF `v3.12.10` pins Rollup 2 at the monorepo
level. This keeps the host app inside the same reproducible Yarn workspace without overriding or
breaking the upstream OHIF dependency policy.

## Local development

Run OHIF Viewer from the repository root:

```bash
yarn dev:viewer
```

The Viewer is available at <http://localhost:3000>.

In a second terminal, run the host app:

```bash
yarn dev:host
```

Open <http://localhost:5173>. The host app embeds a concrete public study from the local Viewer.

## Configuration

The default iframe URL points to the public measurement demo study documented by OHIF. To use
another Viewer origin or study, copy `.env.example` to `.env.local` and change
`VITE_VIEWER_ORIGIN` or `VITE_VIEWER_STUDY_UID`. Keep `VITE_VIEWER_ORIGIN` limited to the origin
itself (for example, `http://localhost:3000`); the host app builds the Viewer URL from it.
An invalid or unsafe value is reported in the browser console and falls back to the local Viewer.

## Viewer bridge

The host installs its `message` listener before mounting the iframe, accepts bridge messages only
from the configured Viewer origin and that iframe's `contentWindow`, and waits for `VIEWER_READY`.

Add a measurement row and choose **Activate Ellipse** to arm `EllipticalROI` in OHIF. Only one row
can be queued or drawing at a time. Activation requested before the Viewer is ready is queued and
sent after the handshake; **Cancel** drops a queued request or restores the Viewer to Pan.

Completing the ellipse stores the correlated annotation ID and displays its normalized area in the
matching row. Accepted message and annotation IDs are retained for the current Viewer session so a
duplicate cannot complete another row. Reloading the iframe invalidates completed bindings and
returns those rows to the waiting state because the new Viewer no longer contains their annotations.

Values are formatted for the Ukrainian locale only in the view; the reducer keeps the original
numeric value and exact OHIF unit. The footer derives totals from completed rows and displays a
separate total for every normalized unit. It never implicitly converts or combines `mm²`, `cm²`,
and `px²`; unknown units are grouped only when their normalized raw labels match.

## Checks

Run the complete SPSoft test suite from the repository root. This command runs the three focused
Jest projects, then starts both local applications for the Playwright browser smoke tests:

```bash
yarn test:spsoft
```

Typecheck and build checks remain available separately:

```bash
yarn typecheck:host
yarn build:host
```

For a faster package-level check, run `yarn test:protocol`, `yarn test:viewer-bridge`, or
`yarn test:host` individually.
