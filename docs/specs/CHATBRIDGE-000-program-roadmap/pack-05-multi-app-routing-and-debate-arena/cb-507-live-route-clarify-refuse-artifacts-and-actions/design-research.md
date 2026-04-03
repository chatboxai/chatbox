# CB-507 Design Research

## Repo Evidence

### Existing Shell Language

- `src/renderer/components/chatbridge/ChatBridgeShell.tsx` already defines the
  visual grammar for inline host-owned app surfaces: status badge, summary
  block, child surface, fallback, and action footer.
- `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx` is the live
  renderer seam for app parts and already handles inline, anchor, and tray
  presentation without introducing a separate artifact system.

### Existing Action Acknowledgement Pattern

- `src/shared/chatbridge/degraded-completion.ts` stores replay-safe action
  acknowledgements in `values`, then the renderer reads that acknowledgement to
  disable or relabel actions after a click.
- This is the right precedent for CB-507 because it keeps the action state
  durable across reloads and avoids presentational-only button logic.

### Existing Reviewed Launch Adoption Pattern

- `src/renderer/packages/chatbridge/reviewed-app-launch.ts` converts host-owned
  tool execution records into durable ChatBridge app parts.
- That path already handles special promotion for Chess and generic reviewed
  launches for Drawing Kit and Weather Dashboard, so route actions should reuse
  it instead of inventing a parallel launch representation.

### Existing Route Contract

- `src/shared/chatbridge/routing.ts` already owns the reviewed route decision,
  candidate ranking, and the baseline route artifact part shape.
- `src/renderer/packages/model-calls/stream-text.ts` already records the route
  event in LangSmith, but it does not yet surface clarify or refuse outcomes in
  the live assistant message.

## Design Directions Considered

### Option A: Minimal Footer Buttons

- Reuse the generic shell and put one or two buttons in the existing footer.
- Strength: cheapest implementation.
- Risk: clarify can legitimately need more than two choices, and the candidate
  context disappears into button labels.

### Option B: Split Reason Rail

- Put explanation on the left and candidate controls on the right.
- Strength: strong status versus action separation.
- Risk: too dashboard-like for a normal chat message and visually heavier than
  the surrounding ChatBridge surfaces.

### Option C: Conversation Receipt With Option Cards

- Keep the normal shell header, then render stacked candidate cards or refusal
- details inside the child surface.
- Strength: works for 1-3 options, keeps the artifact readable in-thread, and
  adapts cleanly to pending, resolved, and failed states.
- Risk: slightly more implementation work because the actions live inside the
  child surface instead of the generic shell footer.

## Decision Inputs

- Need to preserve the existing ChatBridge shell language.
- Need more than two action affordances for clarify.
- Need room for durable acknowledgement copy after a choice.
- Need a surface that still makes sense for refusal and runtime-unsupported
  states.

## External Research

- Not required. The repo already contains the needed shell, persistence, and
  host-action exemplars for this interaction.
