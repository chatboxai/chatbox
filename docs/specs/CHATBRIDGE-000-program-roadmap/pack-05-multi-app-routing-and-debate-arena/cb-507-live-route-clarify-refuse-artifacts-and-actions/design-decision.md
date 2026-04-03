# CB-507 Design Decision

## Inputs Used

- `feature-spec.md`
- `technical-plan.md`
- `design-brief.md`
- `design-research.md`
- Existing runtime exemplars in:
  - `src/renderer/components/chatbridge/ChatBridgeShell.tsx`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/shared/chatbridge/degraded-completion.ts`
  - `src/renderer/packages/chatbridge/reviewed-app-launch.ts`

## Options Considered

### A. Minimal Footer Buttons

- Thesis: keep the generic shell and let the footer carry the action model.
- Strengths: smallest code diff, maximum reuse of existing shell chrome.
- Risks: poor fit for 3-way clarify, weak candidate context, and cramped
  accessibility labels.

### B. Split Reason Rail

- Thesis: separate explanation and controls into a two-column card.
- Strengths: clear distinction between status and action.
- Risks: too heavy for a message bubble, weak mobile fit, and visually unlike
  the rest of ChatBridge.

### C. Conversation Receipt With Option Cards

- Thesis: keep the shell header, then use the inner surface as a stack of
  candidate or refusal cards with inline actions and acknowledgement states.
- Strengths: message-native, scales to multiple options, leaves room for
  replay-safe acknowledgements and degraded launch results.
- Risks: requires a dedicated inner-surface component and a small amount of
  route-specific action state.

## Scoring Rubric

| Criterion | A | B | C |
|---|---:|---:|---:|
| Task clarity and host status | 3 | 4 | 5 |
| Match to user goals | 3 | 3 | 5 |
| Control and error prevention | 3 | 4 | 5 |
| Consistency with current ChatBridge patterns | 4 | 2 | 5 |
| Information hierarchy and restraint | 3 | 2 | 5 |
| Accessibility and responsive feasibility | 3 | 2 | 5 |
| Implementation fit and testability | 4 | 2 | 4 |
| Total | 23 | 19 | 34 |

## Chosen Direction

- Choose **C. Conversation receipt with option cards**.

## Why It Won

- It preserves the existing shell framing while giving clarify enough room for
  multiple explicit reviewed app choices.
- It supports three important states with the same structure:
  pending clarify, resolved chat-only, and post-choice launch failure.
- It aligns with the repo's host-owned acknowledgement pattern by leaving a
  durable receipt in the message rather than disappearing into transient button
  state.

## Discarded Options

- A lost because two shell-footer buttons are not enough for realistic clarify
  cases and do not leave enough room for candidate context.
- B lost because it looks like a control panel instead of a normal chat
  artifact and would silently broaden the visual language of Pack 05.

## Copy Fidelity

- Use real reviewed app names.
- Keep route reasons short and conversational.
- Avoid raw router terms except where the user already understands the host is
  choosing whether to launch an app or continue in chat.

## Implementation Implications

- Add a dedicated route-artifact inner surface component under
  `src/renderer/components/chatbridge/`.
- Add durable route-action acknowledgement state to the route values contract.
- Inject clarify/refuse route artifacts in the live `streamText` result when no
  reviewed launch tool is selected.
- Reuse the reviewed launch adoption path for successful clarify choices so
  Chess, Drawing Kit, and Weather Dashboard all keep their current launch
  behavior.
