# CB-603 Pencil Review

## Metadata

- Story ID: CB-603
- Story Title: Story Builder with Google Drive connect/save/resume
- Author: Codex
- Date: 2026-04-01

## Spec References

- Feature spec:
  `docs/specs/CHATBRIDGE-000-program-roadmap/pack-06-authenticated-apps-and-story-builder/cb-603-story-builder-with-google-drive-connect-save-resume/feature-spec.md`
- Technical plan:
  `docs/specs/CHATBRIDGE-000-program-roadmap/pack-06-authenticated-apps-and-story-builder/cb-603-story-builder-with-google-drive-connect-save-resume/technical-plan.md`
- Design brief:
  `docs/specs/CHATBRIDGE-000-program-roadmap/pack-06-authenticated-apps-and-story-builder/cb-603-story-builder-with-google-drive-connect-save-resume/design-brief.md`

## Pencil Prerequisites

- Pencil docs sync attempted: yes
- Pencil docs sync outcome:
  blocked locally because `python3 .ai/scripts/sync_pencil_docs.py` currently
  fails with `ModuleNotFoundError: No module named 'bs4'`
- Working fallback:
  used the existing checked-in Pencil snapshots already present under
  `.ai/reference/pencil/`
- Synced docs pages reviewed:
  - `ESSENTIALS.md`
  - `getting-started/ai-integration`
  - `design-and-code/design-to-code`
  - `for-developers/the-pen-format`
  - `for-developers/pencil-cli`
  - `core-concepts/components`
  - `core-concepts/design-libraries`
  - `core-concepts/slots`
  - `core-concepts/variables`
- `.pen` schema/layout guardrails reviewed: yes
- Pencil visible in `/mcp`: yes
- Direct shell CLI used: no
- Design library file: `design/system/design-system.lib.pen`
- Story design file: `design/stories/CB-603.pen`
- Existing code imported first:
  no; this is a new app surface, so the shared design library and the existing
  ChatBridge renderer shell were used as the baseline instead

## Foundation Reuse

- Design-system maturity: working
- Variables reused:
  - `color.text.*`
  - `color.surface.*`
  - `color.border.*`
  - `space.*`
  - `radius.*`
- Components reused:
  - `ds_badge`
  - `ds_action_chip`
  - `ds_button_primary`
  - `ds_button_secondary`
  - `ds_notice_banner`
  - `ds_section_card`
  - `ds_textarea`
  - `ds_list_row`
- New foundation work added for this story: none
- Token sync back to code required: no

## Variations

### Variation A

- Name: Writing Desk Column
- Node: `wblLb`
- Fidelity level: design-grade
- Summary:
  - Keeps the current draft as the dominant region.
  - Shows Drive connection, save checkpoints, and completion handoff in one
    guided column beneath the writing surface.
  - Best fit when Story Builder should feel creative first and operationally
    trustworthy second.
- Strengths:
  - Strongest writing-first posture
  - Best balance between flagship-app identity and Pack 6 host authority
  - Easiest to map onto the current ChatBridge shell without feeling generic
- Risks:
  - Less explicit about checkpoint choice than Variation B
  - Less overtly system-guided than Variation C
- Screenshot reference:
  `docs/specs/CHATBRIDGE-000-program-roadmap/pack-06-authenticated-apps-and-story-builder/cb-603-story-builder-with-google-drive-connect-save-resume/artifacts/pencil/variation-a-writing-desk.png`

### Variation B

- Name: Resume-First Split Pane
- Node: `2IJVe`
- Fidelity level: design-grade
- Summary:
  - Gives the checkpoint rail structural priority before reopening the draft.
  - Makes save/resume feel like a deliberate selection step rather than an
    automatic continuation.
  - Best fit when the product wants the user to choose among resumable states
    before drafting.
- Strengths:
  - Strongest resume decision clarity
  - Makes checkpoint selection and fallback state explicit
  - Good fit if Story Builder will accumulate multiple meaningful saves
- Risks:
  - Narrow split makes the composition denser
  - Feels more utilitarian and less like a creative writing studio
- Screenshot reference:
  `docs/specs/CHATBRIDGE-000-program-roadmap/pack-06-authenticated-apps-and-story-builder/cb-603-story-builder-with-google-drive-connect-save-resume/artifacts/pencil/variation-b-resume-pane.png`

### Variation C

- Name: Host-Guided Timeline
- Node: `Y7YQr`
- Fidelity level: design-grade
- Summary:
  - Makes auth, save, and return-to-chat read like one explicit host-owned
    lifecycle.
  - Keeps the draft visible, but subordinates it slightly to the platform’s
    trust and continuity story.
  - Best fit when the product wants Pack 6 governance to be visible throughout
    the authenticated workflow.
- Strengths:
  - Strongest expression of host authority and lifecycle clarity
  - Cleanest operational story for auth, save, resume, and completion
  - Likely the easiest option to explain during Pack 6 review
- Risks:
  - Slightly less creative and immersive than Variation A
  - Can feel more system-led than writer-led
- Screenshot reference:
  `docs/specs/CHATBRIDGE-000-program-roadmap/pack-06-authenticated-apps-and-story-builder/cb-603-story-builder-with-google-drive-connect-save-resume/artifacts/pencil/variation-c-host-timeline.png`

## Recommendation

- Recommended option: A
- Why:
  - It keeps Story Builder feeling like a real flagship app instead of a
    disguised settings or recovery tool.
  - It still proves the Pack 6 requirements clearly: host-owned Drive connect,
    save checkpoints, resume continuity, and completion handoff all remain
    explicit.
  - It is the best visual bridge between the existing ChatBridge shell language
    and the more editorial posture this creative app needs.

## Approval Gate

- Approval status: approved
- Approved option: Variation A, Writing Desk Column
- Approval note:
  Continue-development instruction was treated as approval for the recommended
  option, and the implemented renderer surface now follows Variation A.
