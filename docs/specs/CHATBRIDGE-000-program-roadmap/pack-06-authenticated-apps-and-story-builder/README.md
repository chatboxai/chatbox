# Pack 06 - Authenticated Apps and Story Builder

## Phase Fit

- Phase: 6 of 7
- Primary objectives: O2, O4
- Unlocks: platform-owned app auth, credential handles, resource proxying, and the authenticated flagship partner flow

## Pack Goal

Prove that ChatBridge can support authenticated partner apps without giving runtimes long-lived raw credentials, using Story Builder with Google Drive as the flagship flow.

## Entry Gates

- Unauthenticated flagship app flows and completion continuity already work.
- The platform has explicit lifecycle, routing, and normalization contracts.

## Stories

- [CB-601 - Platform auth versus app auth separation](./cb-601-platform-auth-versus-app-auth-separation/feature-spec.md)
- [CB-602 - Auth broker and credential-handle lifecycle](./cb-602-auth-broker-and-credential-handle-lifecycle/feature-spec.md)
- [CB-603 - Story Builder with Google Drive connect/save/resume](./cb-603-story-builder-with-google-drive-connect-save-resume/feature-spec.md)
- [CB-604 - Host-mediated resource proxy](./cb-604-host-mediated-resource-proxy/feature-spec.md)

## Exit Criteria

- Platform auth and app auth are clearly separated.
- Story Builder proves an authenticated workflow end to end.
- Protected resource access stays host-mediated and auditable.

## Risks

- Letting the app runtime hold raw refresh tokens.
- Treating OAuth as a detached settings concern instead of app lifecycle behavior.
- Shipping authenticated flows before credential handles and resource proxy rules are explicit.
