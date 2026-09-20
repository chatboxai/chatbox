# Mid-run context compaction: ownership and invariants

## Modules

| Responsibility | Owner |
| --- | --- |
| Protocol-aware size estimates; complete-round tail boundaries; stable tool-call lookup | `generation/mid-run-compaction.ts` |
| Reuse, measure, plan, compact, verify coverage, and advance a run's summary | `generation/MidRunCompactionController.ts` |
| Join an in-flight structural write before cancellation or an old checkpoint is published | `generation/GenerationSegmentTransitions.ts` |
| Snapshot and atomically persist the prefix and continuation in the right root/thread/fork | `application/session/generation-segment-split.ts` |
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
  -> summarize the target message path through the explicit durable boundary
  -> verify the returned boundary matches, including when no split is needed
  -> replace the rewrite's summary and retained tool-call ID
```

A cached rewrite is an optimization, not a terminal state. A long run can compact repeatedly. A later failure retains the last valid rewrite rather than restoring the entire SDK transcript. A failed summarizer is not retried at every remaining step of the same run.

Cuts are resolved by tool-call identity, never by a cached array offset. Synthetic `view_image` follow-ups stay with their producing round. The stored tail also keeps the text/reasoning immediately preceding its first call; this matches the retained assistant block used on the wire.

## Summary ownership

Each request carries the current generation target ID and expected boundary ID. `CompactionService` reconstructs that target's path, including inactive forks and archived threads, and uses its owning thread's compaction points. It rejects a mismatched summary boundary before calling the summarizer. Inside the coordinated commit, it checks cancellation and verifies that the target still has the same ordered history. Changing the selected branch does not change summary ownership.

When every current tool call remains in the tail, the expected boundary is the generation target's predecessor. Both split and unsplit requests verify the returned boundary before replacing model context. A retained tool from inside an older, unsplit message cannot define a complete durable boundary, so that step keeps its current context.

## Atomic segment persistence

The `splitStreamingMessage` port commits the finalized prefix and the populated continuation together, using one `SessionService.updateSessionWithMessages` call. The existing `StreamingWriteCoordinator.persistTerminal` drains old checkpoints and invalidates their cache updates before that structural write. Full-session projection preserves other live generating messages.

Cancellation is checked again inside the coordinated updater. A target already finalized by Stop cannot be split. A missing/cross-path anchor fails closed instead of appending to another conversation.

A durable session write followed by metadata failure is still a committed split. The writer uses `onFullSessionPersisted`, not a guess based on a rejected promise, to decide whether the caller must adopt the continuation. SessionService retains responsibility for metadata projection/repair.

`GenerationSegmentTransitions` records the structural operation until its synchronous in-memory handoff is complete. The generation's abort cleanup waits for it, then finalizes the correct target. Old chunk checkpoints also join the operation before publishing; they cannot restore the unsplit assistant after a target handoff.

Hosts without the atomic port decline splitting. They never fall back to separate insert/prefix writes. Both production Desktop and RN adapters provide the port.

## Media estimates

`tool-result.output.type = content` is a protocol container. Its `image-data` and other media parts use the same fixed media allowance as top-level images; raw bytes are never JSON-stringified for text token estimation. Text accompanying the media is counted normally. Arbitrary `json` tool outputs remain text, even if business data happens to contain fields named `type: image-data`.

These are pressure heuristics, not provider billing counts or a guarantee that any single oversized tool batch will fit the model window.

## Regression coverage

The controller tests append 64 tool rounds, require multiple compactions, and bound the effective request after each step for the fixture. Other cases cover a second compaction failing, changed image projections, boundary mismatch, canceled/disabled runs, and declined splits.

The writer tests cover one-write durability, failure before commit, metadata failure after commit, abort before/while writing, old-checkpoint draining, concurrent terminal writes, root/thread/fork paths, idempotency, and missing anchors. Transition tests verify that cancellation waits for adoption. Media tests use the real `buildViewImageToolResultContent` shape rather than a synthetic top-level image alone.
