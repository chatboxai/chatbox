# Refactoring Guide

## Purpose
Safely improve code structure without changing behavior.

## Triggers to Refactor
- File >200 lines and growing
- Function >20 lines with mixed responsibilities
- Duplicated logic appears in 2+ places
- Tests are hard to write due to tight coupling

## Refactor Workflow
1. Lock behavior with tests first.
2. Apply one small structural change at a time.
3. Re-run targeted tests after each change.
4. Re-run full suite before concluding.

## Common Refactors
- Extract helper functions from long methods
- Introduce value objects for repeated data shape
- Move provider-specific logic into adapter modules
- Replace conditionals with strategy objects when branching grows

## Safety Rules
- Do not mix behavior changes with refactor-only commits unless necessary
- Keep public API stable during internal refactor
- Maintain or improve coverage

## Definition of Done
- Behavior unchanged and verified by tests
- Complexity reduced (readability, duplication, file size)
- Architectural boundaries clearer than before

