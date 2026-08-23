# AI usage

I used AI assistants while working on this assignment. OpenAI Codex was the main implementation
assistant. Claude/Opus was used near the end as a second reviewer. The AI-assisted work covered
planning, code changes, tests, documentation, and review. I remained responsible for the final
decisions and for checking the result in the repository.

## Where AI helped

- Reading the Ukrainian task and turning it into an implementation plan and a sequence of feature
  pull requests.
- Finding the relevant OHIF extension points and drafting the shared protocol, Viewer bridge, and
  host-side state flow.
- Writing focused Jest tests for message parsing, correlation, bridge lifecycle, and totals, plus
  Playwright smoke tests for the two-origin runtime flow.
- Reviewing the implementation against the task, including handshake behavior, origin checks,
  cleanup, units, and prevention of an echo loop.
- Drafting and editing `README.md`, `ARCHITECTURE.md`, package documentation, and pull request
  descriptions.

## Output retained in the project

The final repository contains AI-authored code and documentation. The shared message envelope and
discriminated union, the controller-based bridge structure, the scoring reducer, unit-based totals,
test fakes, and the first documentation drafts all came from AI-assisted iterations. I kept these
parts where they matched the task and continued to pass type checks, automated tests, and manual
browser checks.

I also kept suggested defensive checks for `event.origin`, `event.source`, protocol version,
Viewer session identifiers, activation identifiers, and annotation identifiers. These checks were
verified against both valid and invalid messages instead of being accepted only from a code review.

## Output changed after review

Several drafts needed changes after running the applications or checking the actual OHIF runtime:

- Viewer readiness was moved behind the availability of a viewport and tool group. A bounded retry
  was added for startup events that arrive too early.
- Early activation was changed from an immediate post to a queued intent that can also be cancelled
  before `VIEWER_READY`.
- Measurement correlation was tightened to reject stale Viewer sessions, activation attempts, and
  unrelated OHIF annotations.
- Bridge registration was made safe when optional configuration is absent, instead of allowing
  `preRegistration` to fail.
- Reload and unmount behavior was revised to clear stale bindings, unsubscribe from OHIF services,
  remove message listeners, and restore Pan when necessary.
- Area totals were changed to keep `mm2`, `cm2`, `px2`, and unknown raw units in separate buckets.
- The development launcher was updated to install missing dependencies before starting both
  applications.
- Live update and bidirectional deletion behavior was revised after manual checks and independent
  review.

Claude/Opus review notes were treated as leads, not as facts. I checked each reported issue against
the source and runtime behavior before deciding whether it needed a code change or documentation.

## Verification

AI output was checked with the project scripts and with the running applications. The main commands
used were:

```bash
yarn test:spsoft
yarn typecheck:protocol
yarn typecheck:viewer-bridge
yarn typecheck:host
yarn build:host
```

The browser flow was also checked manually on the separate host and Viewer origins. This included
early activation, cancellation, multiple correlated measurements, live updates, deletion from both
sides, iframe reload, and invalid cross-origin messages.

AI made mistakes during the work, particularly around OHIF lifecycle timing and assumptions about
runtime event payloads. Those parts were corrected after inspecting the installed source, compiling
the TypeScript projects, and exercising the real Viewer. The submitted code and its remaining
tradeoffs are my responsibility.
