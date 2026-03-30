# Constitution Check Template

Use this file to verify a story against project-level constraints before implementation.

## Story Context
- Story ID:
- Story Title:
- Owner:
- Date:

## Architecture Constraints
- [ ] Clean architecture boundaries preserved (domain not coupled to infra/UI frameworks)
- [ ] New modules respect SRP and dependency direction
- [ ] No net-new boundary violations introduced

## Technology Constraints
- [ ] Uses existing approved stack unless exception documented
- [ ] New dependency justified and risk-assessed
- [ ] Provider integrations use existing adapters/contracts where possible

## Quality Constraints
- [ ] TDD-first execution planned
- [ ] Coverage target preserved (>90%)
- [ ] File/function size limits respected (<250/<30)
- [ ] Type hints and linting gates preserved

## Security Constraints
- [ ] No hardcoded secrets
- [ ] Input validation plan included
- [ ] Error handling avoids secret/path leakage
- [ ] External calls include timeout/retry policy

## Performance Constraints
- [ ] I/O paths are async where applicable
- [ ] Connection reuse/pooling considered
- [ ] Expected latency/cost impact documented

## UI-Specific Constraints (Only if UI scope exists)
- [ ] Behavior layer separated from visual fiddling layer
- [ ] Accessibility requirements defined (roles/labels/keyboard behavior)
- [ ] Design tokens used instead of hardcoded visual values
- [ ] Visual regression states listed for baseline capture

## Exceptions
- Exception:
- Rationale:
- Approval:

## Result
- [ ] Constitution check passed
- [ ] Blocking issues identified (list below)

Blocking issues:
- ...
