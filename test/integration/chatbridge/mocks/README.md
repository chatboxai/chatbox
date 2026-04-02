# ChatBridge Mock Space

Use this folder for mock host-adjacent integrations such as:

- mock reviewed app registry responses
- mock policy decisions
- mock auth-broker responses
- mock partner runtime bridges
- mock audit or observability sinks

Current Pack 07 partner-DX helper:

- `partner-harness.ts`
  wraps the real ChatBridge host controller with deterministic mock ports so
  partner runtimes can verify bootstrap, render delivery, replay rejection,
  and recovery signals locally.

Mocks should stay close to the host-side contract and avoid inventing
unrealistic behavior that would hide real boundary mistakes.
