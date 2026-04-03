# I001-02 Design Research

## Metadata

- Story ID: I001-02
- Story Title: ChatBridge tray renderable-surface gating
- Author: Codex
- Date: 2026-04-02

## Research Scope

- Surface under review:
  the ChatBridge floating tray, message anchor shell, and inline route-artifact
  presentation
- Question to answer:
  when should host-owned tray chrome appear, and how should non-surface app
  parts behave instead
- Why repo evidence alone is or is not enough:
  repo evidence is enough because the defect is caused by an internal contract
  drift between the tray selector and the current surface renderer

## Repo Findings

- Current surface inspected:
  `src/renderer/components/chatbridge/floating-runtime.ts` promotes any app part
  with `launching`, `ready`, or `active` lifecycle, while
  `src/renderer/components/chatbridge/apps/surface.tsx` renders only a smaller
  subset of parts as real surfaces
- Similar components or screens:
  `ChatBridgeMessagePart.tsx` already distinguishes inline route artifacts from
  app surfaces, and `FloatingChatBridgeRuntimeShell.tsx` assumes it only
  receives a real runtime
- Shared tokens or patterns to reuse:
  keep the existing ChatBridge shell tokens, status chips, and route-artifact
  inline shell instead of inventing a new visual language
- Implementation constraints discovered:
  tray target resolution needs a pure, non-React classification helper because
  the session route cannot depend on inspecting `ReactNode` output

## External Sources

- Source:
  none required
- URL:
  n/a
- Why it matters:
  this is a repo-internal presentation contract issue, not an unfamiliar UI
  pattern
- Takeaway:
  repo-first evidence is sufficient

## Design Implications

- Direction implication 1:
  the tray must be treated as a capability indicator, not merely a lifecycle
  indicator
- Direction implication 2:
  inline route receipts should remain the durable explanation surface when no
  runtime exists
- Direction implication 3:
  the cleanest UX comes from removing false shell states rather than adding a
  second empty-state tray presentation

## Risks / Unknowns

- Risk 1:
  some app parts may technically render a surface but still not deserve tray
  promotion; the shared classifier should stay explicit enough to evolve
- Risk 2:
  overly broad copy cleanup could turn a narrow bug fix into a visual redesign

## Recommendation

- Recommended stance before option generation:
  use one explicit tray-eligibility classifier, keep route artifacts inline,
  and prefer suppressing incorrect tray chrome over redesigning the shell
