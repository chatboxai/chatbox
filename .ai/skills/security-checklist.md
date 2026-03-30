# Security Checklist

Run this before any commit or deployment.

## Secrets and Credentials
- [ ] No hardcoded keys/secrets in repository
- [ ] `.env` excluded from git
- [ ] `.env.example` contains only placeholders
- [ ] Secrets masked in logs and errors

## Input and Output Safety
- [ ] All external input validated (type, size, shape)
- [ ] File paths validated against traversal
- [ ] No use of `eval`/`exec` on untrusted input
- [ ] Error messages avoid internal path/secret leakage

## External Calls
- [ ] Timeouts set for all network calls
- [ ] Retries bounded and jittered for transient errors
- [ ] Response schemas validated before use

## Dependencies
- [ ] Dependency audit run (`pip-audit` or equivalent)
- [ ] No known critical vulnerabilities
- [ ] Versions pinned

## Operational Security
- [ ] Rate limiting/back-pressure considered for external endpoints
- [ ] Least-privilege API keys where supported
- [ ] Sensitive data retention minimized

