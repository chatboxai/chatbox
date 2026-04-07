---
title: Remote Code Loading
impact: MEDIUM
tags: code-splitting, repack, lazy-loading, chunks
---

# Skill: Remote Code Loading

Set up code splitting with Re.Pack for on-demand bundle loading from trusted, first-party assets.

## Quick Pattern

**Before (static import):**

```jsx
import SettingsScreen from './screens/SettingsScreen';
```

**After (lazy loaded chunk):**

```jsx
const SettingsScreen = React.lazy(() =>
  import(/* webpackChunkName: "settings" */ './screens/SettingsScreen')
);

<Suspense fallback={<Loading />}>
  <SettingsScreen />
</Suspense>
```

## When to Use

Consider code splitting when:
- **Not using Hermes** (JSC/V8 benefits more)
- App size exceeds 200 MB (Play Store limit)
- Building micro-frontend architecture
- Loading features based on user permissions
- Other optimizations exhausted

**Note**: Hermes already uses memory mapping for efficient bundle reading. Benefits of code splitting are minimal with Hermes or even counterproductive in some cases.

## Security Model

Remote chunks are executable application code. Only load chunks that you build and publish yourself.

Keep these guardrails in place:
- Serve chunks only from a first-party, HTTPS-only origin you control
- Resolve `scriptId` through a fixed allowlist or release manifest
- Fail closed if a chunk is missing or unexpected
- Do not load chunks from user-controlled input, query params, or third-party domains

## Prerequisites

- Re.Pack installed (replaces Metro)

```bash
npx @callstack/repack-init
```

## Step-by-Step Instructions

### 1. Initialize Re.Pack

```bash
npx @callstack/repack-init
```

Follow prompts to migrate from Metro. Check [migration guide](https://re-pack.dev/docs/getting-started/quick-start).

### 2. Create Split Point with React.lazy

```tsx
// BEFORE: Static import
import SettingsScreen from './screens/SettingsScreen';

// AFTER: Dynamic import (creates split point)
const SettingsScreen = React.lazy(() =>
  import(/* webpackChunkName: "settings" */ './screens/SettingsScreen')
);
```

### 3. Wrap with Suspense

```tsx
import React, { Suspense } from 'react';

const App = () => {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <SettingsScreen />
    </Suspense>
  );
};
```

### 4. Configure Chunk Loading

```jsx
// index.js (before AppRegistry)
import { ScriptManager, Script } from '@callstack/repack/client';

const CHUNK_URLS = {
  settings: 'https://assets.example.com/app/v42/settings.chunk.bundle',
};

ScriptManager.shared.addResolver((scriptId) => ({
  url: __DEV__ ? Script.getDevServerURL(scriptId) : getChunkUrl(scriptId),
}));

function getChunkUrl(scriptId) {
  const url = CHUNK_URLS[scriptId];

  if (!url) {
    throw new Error(`Unknown chunk: ${scriptId}`);
  }

  return url;
}

AppRegistry.registerComponent(appName, () => App);
```

### 5. Build and Deploy Chunks

Build generates:
- `index.bundle` - Main bundle
- `settings.chunk.bundle` - Lazy-loaded chunk

Deploy chunks to a first-party CDN with versioned paths, and keep the allowlist or manifest in sync with the app release.

## Complete Example

```tsx
// App.tsx
import React, { Suspense, useState } from 'react';
import { Button, View, ActivityIndicator } from 'react-native';

// Lazy load heavy feature
const HeavyFeature = React.lazy(() =>
  import(/* webpackChunkName: "heavy-feature" */ './HeavyFeature')
);

const App = () => {
  const [showFeature, setShowFeature] = useState(false);
  
  return (
    <View>
      <Button 
        title="Load Feature" 
        onPress={() => setShowFeature(true)} 
      />
      
      {showFeature && (
        <Suspense fallback={<ActivityIndicator />}>
          <HeavyFeature />
        </Suspense>
      )}
    </View>
  );
};
```

## Module Federation (Advanced)

For micro-frontend architecture:

```tsx
// Host app loads remote module
const RemoteModule = React.lazy(() =>
  import('remote-app/Module')
);
```

Enables:
- Independent team deployments
- Shared dependencies
- Runtime composition

**Complexity warning**: Only use when organizational benefits outweigh overhead. Federation increases the trust boundary, so keep the same first-party origin and allowlist rules as above.

### Version Management

Consider [Zephyr Cloud](https://zephyr-cloud.io/) for:
- Sub-second deployments
- Version management
- Re.Pack integration

## Caching Strategy

```tsx
ScriptManager.shared.addResolver((scriptId) => ({
  url: getChunkUrl(scriptId),
  cache: {
    // Enable caching
    enabled: true,
    // Cache location
    path: `${FileSystem.cacheDirectory}/chunks/`,
  },
}));
```

## When NOT to Use

| Scenario | Why Not |
|----------|---------|
| Using Hermes | mmap already efficient |
| Small app | Overhead not worth it |
| Simple navigation | Native navigation better |
| Quick iteration needed | Added complexity |

## Hermes Memory Mapping

Hermes reads bytecode lazily via mmap:
- Only loads executed code into memory
- No parse step needed
- Code splitting provides marginal benefit

## Verification

```tsx
// Check if chunk loaded correctly
ScriptManager.shared.on('loading', (scriptId) => {
  console.log(`Loading: ${scriptId}`);
});

ScriptManager.shared.on('loaded', (scriptId) => {
  console.log(`Loaded: ${scriptId}`);
});

ScriptManager.shared.on('error', (scriptId, error) => {
  console.error(`Failed: ${scriptId}`, error);
});
```

## Common Pitfalls

- **Forgetting Suspense**: Lazy components need fallback
- **Wrong CDN path**: Chunks 404 in production
- **No caching**: Re-downloads on every load
- **Too many chunks**: Network overhead exceeds savings
- **Untrusted chunk source**: Remote JS from third-party or user-controlled origins is equivalent to remote code execution

## Related Skills

- [bundle-tree-shaking.md](./bundle-tree-shaking.md) - Re.Pack tree shaking
- [bundle-analyze-js.md](./bundle-analyze-js.md) - Measure chunk sizes
- [native-measure-tti.md](./native-measure-tti.md) - Verify TTI impact
