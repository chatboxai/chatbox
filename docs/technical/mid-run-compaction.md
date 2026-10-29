# Mid-run context compaction: ownership and invariants

## Modules

| Responsibility | Owner |
| --- | --- |
| Protocol-aware size estimates; complete-round tail boundaries; stable tool-call lookup | `generation/mid-run-compaction.ts` |
| Reuse, measure, choose retained tool rounds, verify receipts, and advance a run's summary | `generation/MidRunCompactionController.ts` |
| Resolve the target path, select the summary window, and validate commit ownership | `application/context/compaction-plan.ts` |
| Join an in-flight structural write before cancellation or an old checkpoint is published | `generation/GenerationSegmentTransitions.ts` |
| Snapshot the two messages and atomically persist their row and path changes | `application/session/generation-segment-split.ts` |
| Model, streaming processor, steering, and runtime target handoff | `generation/GenerationService.ts` |
| Supply the existing SessionService and StreamingWriteCoordinator instances | Desktop `stores/session/messages.ts`; RN `createMobileGeneration.ts` |

The controller does not import UI state, settings stores, model factories, or platform storage. The writer does not know about token thresholds or compaction summaries. Neither adds a new session-wide lock.

## Every provider step

```
base/steering projection
  -> resolve previous retained tool-call ID in the current projection
  -> reconstruct the last valid [system, summary, retained tail]
  -> estimate that effective request (even after earlier successful compactions)
  -> if over threshold, choose a newer complete tool-round boundary
  -> atomically seal a prefix when current generating calls would be removed
  -> resolve the target path and summary window from the retained tool-call identity
  -> validate the plan inside the coordinated commit
  -> verify the receipt belongs to this generation and retained round
  -> replace the rewrite's summary and retained tool-call ID
```

A cached rewrite is an optimization, not a terminal state. A long run can compact repeatedly. A later failure retains the last valid rewrite rather than restoring the entire SDK transcript. A failed summarizer is not retried at every remaining step of the same run.

Cuts are resolved by tool-call identity, never by a cached array offset. Synthetic `view_image` follow-ups stay with their producing round. The stored tail also keeps the text/reasoning immediately preceding its first call; this matches the retained assistant block used on the wire.

## Summary ownership

A generation request carries the current target message ID and the first retained tool-call ID. The context planner resolves the same target path used for sending, including inactive forks and archived threads, and applies the host's context selection and message-count limit using that thread's compaction points. It owns the summary boundary; steering owns only its insertion anchor.

Before planning, generation awaits a coordinated checkpoint so the retained round is visible to repository reads, including when no split is needed. The retained tool call must be the first call in the generating target. When older calls must be summarized, the atomic split supplies a continuation satisfying that contract. Inside the coordinated summary commit, the planner checks cancellation, target/retained-round identity, and the complete ordered ancestry. Changing the selected branch does not change summary ownership. Both split and unsplit requests receive a typed receipt containing their generation identity and the committed summary boundary.

Requests distinguish automatic threshold checks, manual compaction, and generation compaction. Outcomes distinguish a committed summary, a temporary skip, cancellation, and failure. A busy compactor or backup operation leaves the controller eligible to try at the next provider step; cancellation keeps the current context, while a stale path or summary failure stops further compaction for that run. A retained tool from inside an older, unsplit message cannot define a complete durable boundary, so that step keeps its current context.

## Atomic segment persistence

The `splitStreamingMessage` port snapshots the finalized prefix and populated continuation, then submits one `generation-segment-split` action through `SessionService.executeStructureCommand`. The row planner reads the two message identities and bounded pages of the required path metadata. It commits both message bodies and the changed parent/selected-child edges under one revision/CAS. `StreamingWriteCoordinator.persistTerminal` drains old checkpoints and invalidates their cache updates before the structural command. The committed delta updates loaded rows and point queries while retaining unrelated live generating overlays.

Cancellation is checked inside the row command. A target already finalized by Stop cannot be split. A missing or cross-path anchor fails closed instead of appending to another conversation. Repeating an already committed split requires the continuation to belong to the prefix’s thread, the prefix to carry the split finish reason, and both stored contentParts values to match the submitted messages.

A successful row commit remains successful when the subsequent record or session-list projection fails. `SessionService` publishes `session-command-committed` with the committed delta and schedules projection repair. The split writer records `SessionStructureResult.applied` through the structure command’s `onCommitted` callback and return value to decide whether the caller must adopt the continuation. A projection failure must not replay the structural write.

`GenerationSegmentTransitions` records the structural operation until its synchronous in-memory handoff is complete. The generation's abort cleanup waits for it, then finalizes the correct target. Old chunk checkpoints also join the operation before publishing; they cannot restore the unsplit assistant after a target handoff.

Hosts without the atomic port decline splitting. They never fall back to separate insert/prefix writes. Both production Desktop and RN adapters provide the port.

## Media estimates

`tool-result.output.type = content` is a protocol container. Its `image-data` and other media parts use the same fixed media allowance as top-level images; raw bytes are never JSON-stringified for text token estimation. Text accompanying the media is counted normally. Arbitrary `json` tool outputs remain text, even if business data happens to contain fields named `type: image-data`.

These are pressure heuristics, not provider billing counts or a guarantee that any single oversized tool batch will fit the model window.

## Regression coverage

The controller tests append 64 tool rounds, require multiple compactions, and bound the effective request after each step for the fixture. Other cases cover a second compaction failing, changed image projections, receipt mismatch, temporary busy outcomes, canceled/disabled runs, and declined splits.

The writer tests cover one-write durability, failure before commit, metadata failure after commit, abort before/while writing, old-checkpoint draining, concurrent terminal writes, root/thread/fork paths, idempotency, and missing anchors. Transition tests verify that cancellation waits for adoption. Media tests use the real `buildViewImageToolResultContent` shape rather than a synthetic top-level image alone.
