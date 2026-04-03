# Anti-Patterns

Capture failures so they are not repeated.

## Seeded Anti-Patterns

- **Problem**: Treating `.ai/` as product code
- **Example**: Adding app runtime features under `.ai/` instead of `src/` or
  other real product directories
- **Why it failed**: It blurs the boundary between helper scaffolding and the
  actual application.
- **Prevention rule**: Product code lives in the real app directories; `.ai/`
  exists to help build and maintain them.

- **Problem**: Importing repo-specific history into the harness
- **Example**: Copying another project's backlog, deploy notes, or feature
  memory into `.ai/memory/`
- **Why it failed**: The helper harness starts giving the wrong instructions
  for this workspace.
- **Prevention rule**: Keep only generic workflows plus Chatbox-specific durable
  memory.

- **Problem**: Documenting commands that do not exist
- **Example**: Telling the harness to run validation or deploy commands not
  defined in `package.json`
- **Why it failed**: Guidance becomes misleading and wastes time.
- **Prevention rule**: Align the harness with the commands that actually exist
  in this repo.

- **Problem**: Letting current-task notes become a backlog archive
- **Example**: Accumulating long story histories under `.ai/memory/session/`
- **Why it failed**: Current context becomes noisy and harder to trust.
- **Prevention rule**: Move only durable truths into project memory and keep
  session notes concise.

- **Problem**: Implementing new UI directly in code before design approval
- **Example**: Using React/CSS as the first place to explore layout and visual
  direction for a new UI story
- **Why it failed**: Review happens too late, design churn spills into code, and
  the user cannot compare alternatives cleanly.
- **Prevention rule**: Write the design brief and design decision before code,
  generate 2 or 3 directions in text, and record the chosen direction before
  implementation.

- **Problem**: Treating each UI story as a fresh one-off design system
- **Example**: Inventing a new visual language in prompts without grounding the
  work in current Chatbox components, tokens, and adjacent screens
- **Why it failed**: Visual consistency drifts and implementation becomes harder
  to keep coherent.
- **Prevention rule**: Treat the existing codebase as the primary design-system
  foundation and extend it intentionally.

- **Problem**: Letting a vague prompt stand in for design thinking
- **Example**: Asking for "make it modern" without a design brief, explicit
  cues, or a scoring rubric
- **Why it failed**: The output becomes generic, unstable, and hard to defend.
- **Prevention rule**: Build a structured prompt packet from the design brief,
  research findings, constraints, and explicit success criteria.

- **Problem**: Skipping research on unfamiliar UI surfaces
- **Example**: Locking a design for a new interaction or audience without
  checking repo exemplars or external guidance first
- **Why it failed**: The chosen direction may look polished but solve the wrong
  problem or violate established patterns.
- **Prevention rule**: Use repo-first lookup and add external sources when the
  relevant pattern is not already well exemplified locally.

- **Problem**: Treating placeholder copy as design-ready
- **Example**: Declaring a direction final while headings and CTAs are still
  generic filler text
- **Why it failed**: Content posture is part of the design; placeholder copy can
  hide hierarchy and tone problems until late.
- **Prevention rule**: Record copy fidelity explicitly in the design decision
  and upgrade to draft copy when the story materially changes content.
