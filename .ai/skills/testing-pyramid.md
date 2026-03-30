# Testing Pyramid

## Goal
Balance speed and confidence using layered tests.

## Layer 1: Unit Tests (Most)
- Fast, isolated, deterministic
- Cover domain logic and edge conditions
- No network, disk, or external services

## Layer 2: Integration Tests (Some)
- Validate provider contracts and adapters
- Use real APIs/services when feasible
- Include timeout/retry/failure scenarios

## Layer 3: E2E Tests (Few)
- Validate full user workflow across ingestion/retrieval/generation
- Assert citations and traceability
- Keep scope focused and representative

## Coverage Strategy
- Unit tests drive line and branch coverage
- Integration tests drive contract confidence
- E2E tests drive workflow confidence

## Anti-Patterns
- Over-mocking integration boundaries
- E2E-only strategy for basic logic
- Flaky tests without deterministic fixtures

