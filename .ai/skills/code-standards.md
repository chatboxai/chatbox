# Code Standards

## Scope
These standards apply to all code and tests in this workspace.

## Structure Limits
- File max: 250 lines (target 150)
- Function max: 30 lines (target 15)
- Class complexity: keep public API minimal and explicit

## Type and Documentation
- Type hints required for all public functions
- Docstrings required for all public APIs (Google style)
- Keep docstrings behavioral, not implementation-heavy

## Error Handling
- Use explicit custom exceptions for domain/application/infrastructure failures
- Never use `except: pass`
- Return safe error messages to users; log detailed diagnostics internally

## Logging
- Use structured logging with context fields (request id, file id, query id)
- Never log secrets or raw credential values
- Prefer levels intentionally: `debug` for diagnosis, `info` for state transitions, `warning/error` for failures

## Dependency and Config
- Load config from environment only
- Pin dependency versions
- Keep third-party dependencies minimal and justified

## Review Gate
A change is ready only if:
- The project test command passes
- Type checking passes (if applicable)
- Linting/format checks pass
- Coverage gate passes (if applicable)
- Security checks pass (if applicable)
