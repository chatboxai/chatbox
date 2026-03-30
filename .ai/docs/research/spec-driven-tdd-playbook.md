# Spec-Driven TDD Playbook

Use this playbook for feature work that needs both explicit requirements and test-first delivery.

## Flow

1. Define the problem and acceptance criteria.
2. Write the spec artifacts:
   - constitution check
   - feature spec
   - technical plan
   - task breakdown
   - UI component spec when the work includes UI
3. Turn acceptance criteria into focused failing tests.
4. Implement the smallest change that makes those tests pass.
5. Refactor while keeping tests green.
6. Run the repo validation commands before handoff.
7. Record tradeoffs, evidence, and follow-up risks in the handoff.

## What good looks like

- Specs are concrete enough to reject the wrong implementation.
- Tests prove behavior, not just function calls.
- The first implementation pass is intentionally small.
- The refactor pass removes duplication without changing behavior.
- Handoff includes verification steps the next person can run quickly.
