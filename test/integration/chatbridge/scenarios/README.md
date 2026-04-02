# ChatBridge Scenario Space

Use this folder for scenario-oriented integration coverage such as:

- happy-path lifecycle
- malformed payload rejection
- timeout or crash recovery
- completion and follow-up continuity
- auth request and denial

Each scenario should map back to a story packet or Pack roadmap item so the
coverage stays intentional.

For the post-Pack-4 single-agent rollout, scenario folders or files should be
named and organized so the owning story can link them directly from
`docs/specs/CHATBRIDGE-000-program-roadmap/**/status.md`.

Current Pack 07 recovery proof lives in:

- `bridge-session-security.test.ts`
  for malformed bridge traffic, replay rejection, launch timeout, and explicit
  runtime-crash recovery signals
- `operator-controls-rollout.test.ts`
  for lifecycle observability records, version kill-switch launch blocking, and
  explicit active-session rollback posture
