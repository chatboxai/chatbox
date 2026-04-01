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

- **Problem**: Shipping demo scaffolding as production behavior
- **Example**: Leaving mocks, stubs, placeholder implementations, or hardcoded
  sample data in runtime code where real integrations should exist
- **Why it failed**: The product appears complete in local happy paths while
  real user flows break or silently diverge from the actual contract.
- **Prevention rule**: Keep mocks in tests only; if the real behavior is not
  implemented, do not merge it.

- **Problem**: Treating TODOs as acceptable implementation debt in merged code
- **Example**: Closing a story with a TODO marker standing in for missing
  runtime behavior or production hardening
- **Why it failed**: The repository records unfinished behavior as if it were
  complete, and later stories inherit hidden gaps.
- **Prevention rule**: Missing implementation is a blocker, not a TODO-driven
  closeout path.

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
- **Prevention rule**: Use Pencil after spec/plan, generate 2 or 3 variations,
  and wait for explicit approval before implementation.

- **Problem**: Jumping from a generic UI ask straight to Pencil variations
- **Example**: Starting a story with "make a settings screen" and immediately
  generating layouts without defining audience, feeling, design language, or
  copy direction
- **Why it failed**: The resulting options look generic, variation differences
  become arbitrary, and the review lacks a stable decision rubric.
- **Prevention rule**: Write `design-brief.md` before variation work and anchor
  the options in explicit feeling, system, layout, and copy guidance.

- **Problem**: Treating each UI story as a fresh one-off design system
- **Example**: Building every new screen in Pencil from scratch with new tokens
  and components instead of extending a shared foundation
- **Why it failed**: Visual consistency drifts and implementation becomes harder
  to keep coherent.
- **Prevention rule**: Build UI variations on top of the shared Pencil design
  system and extend the foundation intentionally.

- **Problem**: Hand-authoring Pencil `frame` artboards without explicit layout
- **Example**: Creating free-positioned story canvases with `frame` nodes but
  forgetting that Pencil frames use layout behavior unless `layout: "none"` is
  set
- **Why it failed**: Children collapse into unexpected rows or stacks and the
  story file becomes visually broken.
- **Prevention rule**: Re-check the synced `.pen` format docs before editing
  `.pen` files, and set `layout: "none"` on any artboard-style or
  absolute-positioned composition frame.

- **Problem**: Calling a starter library a comprehensive design system
- **Example**: Treating tokens plus a few sample components as a finished
  shared system
- **Why it failed**: The process overestimates library readiness and future
  stories fall back to one-off shapes and ad hoc patterns.
- **Prevention rule**: Use `.ai/docs/PENCIL_DESIGN_SYSTEM_STANDARD.md` and
  label the library honestly as `starter`, `working`, or `comprehensive`.

- **Problem**: Treating direct shell `pencil` access as the default workflow
- **Example**: Probing the shell for a `pencil` binary before checking whether
  Pencil is already connected through MCP
- **Why it failed**: It confuses the real readiness signal and makes the
  workflow look broken even when Pencil MCP is available and fully usable.
- **Prevention rule**: In this repo, Pencil MCP is the default bridge. Verify
  Pencil through `/mcp` first and only treat direct shell CLI usage as an
  optional special case.

- **Problem**: Expecting direct `.pen` file patches to hot-reload in Pencil
- **Example**: Editing a `.pen` file on disk with a normal file patch and then
  expecting the open Pencil canvas to update immediately
- **Why it failed**: Pencil's documented immediate-feedback loop applies to
  MCP/editor-session changes, while external disk edits may leave the open file
  stale until it is reopened or reloaded.
- **Prevention rule**: When live feedback matters, mutate the active design
  through Pencil MCP. If a direct disk patch is unavoidable, assume a reopen or
  reload step is needed in Pencil.

- **Problem**: Calling Phase 0 deployment complete when only docs exist
- **Example**: Writing topology or bootstrap notes about deployment without
  adding a real host config, smoke path, or runnable release entrypoints
- **Why it failed**: Later stories assume infrastructure exists, but there is
  nothing actually deployable or verifiable.
- **Prevention rule**: Treat deployment as incomplete until there is a checked-in
  provider config, a smoke-check path, runnable commands, and explicit deploy
  evidence.

- **Problem**: Treating merge-to-`main` as the final operational gate for the
  hosted shell
- **Example**: Merging a deploy-surface story and stopping before the mainline
  Vercel sync or CLI verification phase runs
- **Why it failed**: The code is merged, but the hosted surface may still be
  broken or out of sync with `main`.
- **Prevention rule**: For hosted-shell and deploy-contract stories, watch the
  post-merge `Vercel Main Sync` workflow and record its verification result
  explicitly.

- **Problem**: Stopping at green tests for bundling or runtime-loading changes
- **Example**: Passing `pnpm test` and `pnpm build`, but never loading the
  compiled output that still fails on a missing runtime dependency or malformed
  production package metadata
- **Why it failed**: Build success hides deploy-time or render-time breakage,
  so users discover the failure first.
- **Prevention rule**: For higher-risk runtime changes, verify compiled output
  loads, runtime externals are correct, and production package metadata
  includes required dependencies before closing the story.

- **Problem**: Relying on terminal-only verification for user-facing deploy work
- **Example**: Reporting a deploy-surface story complete from logs alone
  without opening the deployed URL and checking the actual browser behavior
- **Why it failed**: The terminal may show a successful build or deploy while
  the real UX is still broken, redirected, blank, or missing assets.
- **Prevention rule**: Use exact URLs, click paths, and explicit browser
  pass/fail signals whenever user-facing verification is possible.

- **Problem**: Replaying an already-merged story onto a stale parallel branch
- **Example**: Seeing that the current dirty branch lacks a requested story,
  then re-implementing or cherry-picking it even though `main` or
  `origin/main` already contains the merged result
- **Why it failed**: It duplicates work, obscures the real completion state,
  and increases merge risk for unrelated parallel stories
- **Prevention rule**: Check the latest base branch and remote before replaying
  a story. If it is already merged there, treat it as baseline and open only a
  clean follow-up story for any new corrections.

- **Problem**: Injecting provider API keys into the renderer or browser bundle
- **Example**: Wiring `OPENAI_API_KEY` through renderer compile-time env
  injection so the hosted web shell can call OpenAI directly from client code
- **Why it failed**: It exposes a secret to every browser session and violates
  the secure secret-storage model expected by both the repo and OpenAI.
- **Prevention rule**: Keep provider secrets in untracked local env files,
  secret stores, or server-side runtime env only. Do not compile them into the
  client bundle.

- **Problem**: Approving design-grade UI with placeholder copy
- **Example**: Treating a variation with headings like "Welcome Here" and CTA
  labels like "Learn More" as final-quality review evidence for a content-heavy
  screen
- **Why it failed**: The hierarchy, tone, and action quality cannot actually be
  judged, so the design review gives false confidence.
- **Prevention rule**: When content changes materially, use real draft copy for
  design-grade reviews or mark the option as lower-fidelity.
