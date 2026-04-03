# CB-507 Design Brief

## Metadata

- Story ID: CB-507
- Story Title: Live route clarify refuse artifacts and actions
- Date: 2026-04-02
- Author: Codex

## Audience And Entry Context

- Primary audience: a user in a normal live chat thread who asked for a
  reviewed app-backed action.
- Entry context: the host already ran the reviewed route decision and landed on
  `clarify` or `refuse`, but the current runtime does not expose that decision
  as a dedicated timeline artifact.
- Success moment: the user can see why the host paused, what the credible app
  options are, and what happens next without losing the normal chat flow.

## Desired Feeling

- Clear, bounded, and conversational.
- Confident enough to feel host-owned, but not heavy enough to look like a
  separate dashboard.

## Feelings To Avoid

- Hidden routing magic.
- Error-console severity for normal ambiguity.
- Over-designed cards that distract from the actual next action.

## Design-Language Cues

- Reuse the current ChatBridge shell frame and badge system.
- Keep the copy close to the existing host shell voice: explicit, trustworthy,
  and action-oriented.
- Surface candidate apps as compact option cards with one obvious action each.

## Anti-Cues

- No raw JSON or low-level router terminology in the UI.
- No detached modal, tray-only, or inspector-only route surface.
- No generic warning banner that leaves the user guessing what to click.

## System Direction

- Color roles: reuse the existing shell state colors. Clarify should read as
  ready-to-decide, not as an error. Runtime-unsupported and post-choice launch
  failures should use the existing fallback/error posture.
- Typography posture: same shell hierarchy as current ChatBridge parts, with
  compact labels for candidate metadata.
- Surface character: a message-native shell with one stacked choice area rather
  than a split-pane control dashboard.

## Layout Metaphor

- "Conversation receipt with next-step cards."
- Top: host summary and status badge.
- Middle: one stacked rail of candidate or refusal details.
- Bottom: explicit buttons for the allowed next steps.

## Copy Direction

- The host speaks plainly about confidence and eligibility.
- Candidate labels should use reviewed app names, not tool names.
- Match details should stay short and legible, for example matched terms or
  runtime support notes.

## Constraints And No-Go Decisions

- Keep the artifact inline in the existing chat timeline.
- Keep actions host-owned and replay-safe.
- Do not expand the story into a general routing console or a new system.
- Preserve the natural Chess fallback path from CB-506.

## Prompt-Ready Inputs

- Current shell language comes from `ChatBridgeShell.tsx` and
  `ChatBridgeMessagePart.tsx`.
- Candidate data comes from `chatbridgeRouteDecision.matches`.
- Clarify needs up to three actionable reviewed app options plus a chat-only
  choice.
- Refuse needs an explicit host explanation with no app launch.
