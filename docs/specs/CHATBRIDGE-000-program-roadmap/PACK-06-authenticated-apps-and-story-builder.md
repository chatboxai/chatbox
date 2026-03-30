# Pack 06 - Authenticated Apps and Story Builder

> Summary mirror only. Use the canonical folder:
> `pack-06-authenticated-apps-and-story-builder/`

## Phase Fit

- Phase: 6 of 7
- Primary objectives: O2, O4
- Unlocks: host-owned app auth, credential handles, protected resource proxying,
  authenticated flagship partner workflow

## Pack Goal

Prove that ChatBridge can support authenticated partner experiences without
giving app runtimes long-lived raw credentials, using Story Builder with Google
Drive as the flagship flow.

## Entry Gates

- The platform already supports unauthenticated apps and completion continuity.
- Routing and multi-app semantics are stable enough that auth complexity is the
  next major risk.

## Stories

### CB-601 Platform auth versus app auth separation

- Goal:
  define the boundary between Chatbox platform auth, per-user partner grants,
  and app runtime access decisions.
- Acceptance focus:
  the host owns credentials and app auth becomes an explicit lifecycle concern.
- Likely surfaces:
  `src/renderer/packages/remote.ts`,
  `src/shared/request/request.ts`,
  new auth-grant domain modules.

### CB-602 Auth broker and credential-handle lifecycle

- Goal:
  mint, store, refresh, revoke, and scope credential handles for app sessions.
- Acceptance focus:
  the app receives a scoped handle or approved resource path, not a raw refresh
  token.
- Likely surfaces:
  new host auth broker modules,
  token storage adapters,
  service boundary contracts.

### CB-603 Story Builder with Google Drive connect/save/resume

- Goal:
  deliver the authenticated flagship app with Drive connection, project save,
  resume, and app completion semantics.
- Acceptance focus:
  authenticated partner UX still feels like part of the conversation.
- Likely surfaces:
  new `src/renderer/components/chatbridge/apps/story-builder/`,
  auth prompts,
  completion normalization,
  persisted app instances.
- UI note:
  visible UI story; route through Pencil before code.

### CB-604 Host-mediated resource proxy

- Goal:
  route Story Builder's Drive operations through a host-approved resource layer
  or backend proxy.
- Acceptance focus:
  protected resource access is observable, governable, and revocable.
- Likely surfaces:
  auth/resource service adapters,
  request utilities,
  audit event emission.

## Exit Criteria

- Platform auth and app auth are clearly separated.
- Story Builder proves an authenticated partner workflow end to end.
- Protected third-party resource access stays host-mediated.

## Risks

- Letting the iframe or app runtime hold raw refresh tokens
- Treating OAuth as a settings concern instead of an app lifecycle concern
- Shipping Story Builder before credential-handle and proxy rules are explicit
