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

## PR 1 scope

This bootstrap intentionally contains only the application shell, iframe and responsive scoring
layout. The measurement button stays disabled until the versioned viewer bridge is added in a
separate feature PR.
