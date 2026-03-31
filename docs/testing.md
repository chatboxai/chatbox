# Testing Strategy and Implementation

## Current Testing Infrastructure

### Test Framework
- **Vitest** - Modern, ESM-first test runner with excellent TypeScript support
- **@ai-sdk/provider-utils/test** - Mock server utilities for AI provider testing
- **Testing Library** - Component testing utilities

### Test Configuration
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      ...loadEnv(mode, process.cwd(), ''),
      NODE_ENV: 'test',
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/integration/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'release', '.erb'],
  }
})
```

### Test Commands
- `pnpm test` - Run all tests once
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:ui` - Launch Vitest UI for interactive testing
- `pnpm test:coverage` - Run tests with coverage report
- `pnpm test:integration` - Run the integration suite
- `pnpm test:file-conversation` - Run the file-conversation integration suite
- `pnpm test:model-provider` - Run live provider integration coverage when env keys are set

### Live Provider Key Contract
- Keep provider secrets in untracked `.env.local`, `.env`, or shell env only.
- `OPENAI_API_KEY` is the canonical local fallback for OpenAI-backed live tests.
- `TEST_OPENAI_API_KEY` overrides `OPENAI_API_KEY` for classic OpenAI tests.
- `TEST_OPENAI_RESPONSES_API_KEY` overrides both `TEST_OPENAI_API_KEY` and
  `OPENAI_API_KEY` for Responses API tests.
- `TEST_GEMINI_API_KEY` remains provider-specific because there is no shared
  fallback for Gemini.

## Existing Test Coverage

### ✅ Completed Tests

1. **AI Provider Adapters** (`src/shared/models/`)
   - OpenAI streaming and tool calls
   - Error handling (rate limits, network errors)
   - Message format conversion
   - Stream parsing and response handling

2. **Utility Functions** (`src/shared/utils/`)
   - API URL normalization (`llm_utils.test.ts`)
   - Message sequencing and merging
   - ContentParts array handling

3. **Content Processing** (`src/renderer/`)
   - Base64 image parsing (`base64.test.ts`)
   - LaTeX rendering (`latex.test.ts`)
   - Provider configuration parsing (`provider-config.test.ts`)

4. **Message Handling** (`src/renderer/utils/`)
   - Message role sequencing
   - Empty message filtering
   - Multi-part content merging
   - Image content handling

## ChatBridge Live Seed Lab

For inspectable ChatBridge shell, history, or preview changes, use the live
seed lab in addition to automated tests:

- Route: `/dev/chatbridge`
- Shared seed catalog: `src/shared/chatbridge/live-seeds.ts`
- Dev seed helper: `src/renderer/dev/chatbridgeSeeds.ts`

### How to use it

1. Open `/dev/chatbridge`.
2. Click `Seed All Sessions` after pulling the latest relevant change.
3. Open the seeded sessions from the normal session list or from the lab page.
4. Follow the audit steps shown on each scenario card.

### Current seeded scenarios

- `Lifecycle tour`
  - Covers host-owned loading, ready, active, complete, stale, and error
    states in the real message timeline.
- `History + preview`
  - Covers thread history continuity, a persisted Story Builder checkpoint, and
    the live HTML preview shell with `Preview` and `Refresh`.

### Maintenance rule

If a ChatBridge story changes inspectable shell, lifecycle, history, or
preview behavior, update the seed catalog and the `/dev/chatbridge` audit copy
in the same diff so the live inspection path stays current.

## Testing Patterns and Best Practices

### Mock Server Pattern
For AI provider testing, use `createTestServer` from `@ai-sdk/provider-utils/test`:

```typescript
import { createTestServer } from '@ai-sdk/provider-utils/test'

const server = createTestServer({
  'https://api.openai.com/v1/chat/completions': {
    headers: { 'Content-Type': 'text/event-stream' },
    chunks: [
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: [DONE]\n\n',
    ]
  }
})
```

### Handling Dynamic Responses
Use `callNumber` parameter for different responses per call:

```typescript
const server = createTestServer({
  'https://api.openai.com/v1/chat/completions': ({ callNumber }) => ({
    chunks: callNumber === 0 
      ? ['data: {"choices":[{"delta":{"tool_calls":[...]}}]}\n\n']
      : ['data: {"choices":[{"delta":{"content":"Result"}}]}\n\n']
  })
})
```

### Environment-Aware Code
Suppress console output in tests:

```typescript
if (process.env.NODE_ENV !== 'test') {
  console.error('Error message')
}
```

## Test Coverage Goals

### High Priority (Core Functionality)
- [x] AI provider adapters - Basic streaming and error handling
- [x] Message processing core logic
- [ ] Data storage layer (BaseStorage)
- [ ] Session management
- [ ] Settings management

### Medium Priority (Features)
- [x] Content rendering (LaTeX, Markdown basics)
- [x] Provider configuration
- [ ] File processing and uploads
- [ ] Knowledge base integration
- [ ] MCP server communication

### Low Priority (Extensions)
- [ ] UI component testing
- [ ] Electron main process testing
- [ ] Platform-specific features
- [ ] Performance benchmarks

## Implementation Guidelines

### 1. Test Structure
- Place test files alongside source files with `.test.ts` extension
- Use descriptive test names that explain the expected behavior
- Group related tests using `describe` blocks

### 2. Mock Strategy
- Use real fetch with mock servers for API testing
- Avoid mocking internal modules unless necessary
- Create reusable test fixtures for common data

### 3. Async Testing
- Always await async operations
- Use proper cleanup in afterEach hooks
- Handle streaming responses correctly

### 4. Type Safety
- Never use `any` type in tests
- Ensure all mocks match actual type signatures
- Use type assertions sparingly and correctly

## Migration from Jest

The project has been successfully migrated from Jest to Vitest for better ESM support and modern tooling:

1. **Key Changes**
   - Replaced Jest configuration with Vitest config
   - Updated test scripts in package.json
   - Fixed import issues with `@ai-sdk/provider-utils/test`
   - Updated test expectations for new data structures

2. **Benefits**
   - Native ESM support
   - Faster test execution
   - Better TypeScript integration
   - Interactive UI for test debugging

## Next Steps

1. **Immediate Actions**
   - Add tests for data storage layer
   - Test session lifecycle management
   - Verify settings persistence

2. **Short-term Goals**
   - Achieve 70% code coverage for core modules
   - Add integration tests for critical user flows
   - Set up automated test runs in CI/CD

3. **Long-term Vision**
   - Comprehensive E2E testing with Playwright
   - Performance regression testing
   - Cross-platform compatibility testing

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [AI SDK Testing Guide](https://sdk.vercel.ai/docs/testing)
- [Testing Library](https://testing-library.com/)
