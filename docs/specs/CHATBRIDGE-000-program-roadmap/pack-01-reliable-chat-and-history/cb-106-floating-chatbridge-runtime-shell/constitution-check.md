# CB-106 Constitution Check

## Scope Discipline

- This story changes the Pack 01 host-owned app shell from inline-only to a
  floating session-level runtime host.
- It does not implement new flagship apps or change the reviewed-app routing
  queue beyond establishing the new shared shell contract.

## Contract Boundaries

- Durable app/session message records remain under the existing shared/session
  contracts.
- New shell state should stay in renderer/session UI state unless a durable
  contract change is proven necessary.
- Pack 05 flagship runtimes should consume this shell rather than redefining it.

## Safety Rules

- The floating shell must only present host-owned app parts or host-owned bridge
  runtimes.
- Invalid, stale, or degraded app state must fail closed to the compact message
  anchor and recovery artifact.
- The implementation must not create a second uncontrolled app runtime outside
  the governed session shell.

## Testing Rules

- Include at least one happy path where chat continues while the app stays
  visible.
- Include a minimize/restore path.
- Include at least one degraded or stale fallback path.
- Include accessibility coverage for focus handoff and keyboard reachability.

## UI Rules

- Pencil approval is required before implementation.
- Desktop and small-screen behavior must both be designed explicitly.
- The message-thread anchor should stay compact and conversation-friendly.

## Merge Gate

- Story docs updated
- Approved Pencil variation recorded
- Focused tests green
- Full repo validation green
- Story merged to `main`
