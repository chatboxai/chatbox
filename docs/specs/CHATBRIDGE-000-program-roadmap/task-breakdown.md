# ChatBridge Program Task Breakdown

## Story

- Story ID: CHATBRIDGE-000
- Story Title: ChatBridge phased roadmap and story-pack plan

## Execution Notes

- Treat each phase pack as a planning gate, not an implementation batch.
- Treat the nested story folders inside each pack as the canonical four-artifact
  planning packets for that phase.
- Promote a nested packet to a standalone `docs/specs/<story-id>/` folder only
  if the story needs to graduate out of the roadmap and become an active
  implementation track.
- Establish Pack 0 foundation work before moving into the product-facing packs.
- Keep security, completion, and state authority ahead of partner breadth.
- Route any visible UI story through Pencil after per-story spec and technical
  planning.

## Story Pack Alignment

- Higher-level pack objectives:
  continuous chat UX, host-owned lifecycle and memory, reviewed-partner trust,
  authenticated app support, partner-ready operations.
- Planned stories in this pack:
  packs 01 through 07 listed below.
- Why this story set is cohesive:
  it translates the existing presearch ordering directly into implementation
  gates and gives each gate a bounded story set.
- Coverage check: which objective each story advances:
  pack 00 establishes the execution foundation,
  packs 01-04 establish O1 and O2,
  packs 02 and 07 enforce O3,
  pack 06 proves O4,
  pack 07 completes O5.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| P000 | Pack 00: foundation and instrumentation | must-have | partial | bootstrap, env, hosted web deployment, mainline Vercel sync, post-merge verification, release entrypoints, trace, eval, and observability readiness |
| P001 | Pack 01: reliable chat and history | blocked-by:P000 | no | `pnpm test`, `pnpm check` |
| P002 | Pack 02: platform contract and bridge security | blocked-by:P001 | no | contract and integration tests for host/app bridge |
| P003 | Pack 03: single-app invocation and first Chess vertical steps | blocked-by:P002 | no | single-app invocation and initial app embed smoke |
| P004 | Pack 04: completion and app memory | blocked-by:P003 | no | completion normalization and follow-up context tests |
| P005 | Pack 05: multi-app routing and Debate Arena | blocked-by:P004 | partial | routing, refusal, and second-app lifecycle tests |
| P006 | Pack 06: authenticated apps and Story Builder | blocked-by:P004 | partial | auth broker, handle, and Drive proxy tests |
| P007 | Pack 07: error handling, safety, and partner DX | blocked-by:P005,P006 | partial | policy, audit, error recovery, observability, and validator coverage |

Dependency values:

- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:

- `yes`
- `no`
- `partial`

## TDD Mapping

- P000 tests:
  env/bootstrap checks, integration readiness fixtures, trace capture, eval
  fixtures, and baseline observability events
- P001 tests:
  session persistence, message-part extension, embedded host container shell
- P002 tests:
  manifest validation, bridge handshake, replay rejection, tool execution rules
- P003 tests:
  single-app invocation, Chess launch, board updates, and move validation
- P004 tests:
  completion payload validation, summary normalization, resume and degraded
  completion recovery
- P005 tests:
  app eligibility, clarify/refuse routing, multi-app context switching, Debate
  Arena flow
- P006 tests:
  platform auth separation, credential handles, proxy calls, Story Builder save
  and resume
- P007 tests:
  policy precedence, audit minimization, kill switches, partner manifest and
  bridge tooling

## Completion Criteria

- [ ] Every phase pack has a clear entry gate, story set, and exit gate.
- [ ] Every story inside each pack has its own four-artifact packet.
- [ ] Phase ordering matches the requested priority order and still respects the
      presearch architecture.
- [ ] Pack docs reference real repo seams for implementation.
- [ ] The roadmap is detailed enough to derive the first implementation story
      without further structural planning.
