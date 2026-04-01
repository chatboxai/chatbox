# ChatBridge Integration Harness

This folder is the Pack 0 starter home for ChatBridge integration tests.

It is intentionally lightweight at this stage. The goal is to give later packs
an agreed place for host/app/provider fixtures and lifecycle scenarios before
full ChatBridge runtime code lands.

Use this folder for:

- host lifecycle integration tests
- bridge payload fixtures
- reviewed app manifest fixtures
- completion and recovery scenarios
- mock registry, policy, auth-broker, and partner-runtime helpers

Every `validated` ChatBridge story should point back here with:

- at least one happy-path scenario proof
- at least one degraded or failure-path proof when the story changes lifecycle,
  routing, auth, or recovery behavior
- a stable link from the relevant `cb-*/status.md` file

Reference:

- [chatbridge/INTEGRATION_HARNESS.md](/Users/youss/Development/gauntlet/chatbox/chatbridge/INTEGRATION_HARNESS.md)
- [chatbridge/EVALS_AND_OBSERVABILITY.md](/Users/youss/Development/gauntlet/chatbox/chatbridge/EVALS_AND_OBSERVABILITY.md)
