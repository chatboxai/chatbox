---
title: Tree Shaking
impact: HIGH
tags: bundle, tree-shaking, dead-code, metro, repack
---

# Skill: Tree Shaking

Enable dead code elimination to remove unused exports from your JavaScript bundle.

## Quick Config

```bash
# .env (Expo SDK 52+)
EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH=1
EXPO_UNSTABLE_TREE_SHAKING=1
```

```javascript
// metro.config.js
config.transformer.getTransformOptions = async () => ({
  transform: { experimentalImportSupport: true },
});
```

```javascript
// babel.config.js (non-Expo projects must set `disableImportExportTransform`)
module.exports = {
  presets: [
    [
      'module:@react-native/babel-preset',
      { disableImportExportTransform: true },
    ],
  ],
};
```

## When to Use

- Bundle includes unused library code
- Want automatic barrel export optimization
- Using Expo SDK 52+ (recommended approach)
- Project already uses Re.Pack (`@callstack/repack`)

## Platform Support

| Bundler        | Tree Shaking    | Notes                        |
| -------------- | --------------- | ---------------------------- |
| Metro          | ❌ No           | Use metro-serializer-esbuild |
| Expo (SDK 52+) | ✅ Experimental | Requires config              |
| Re.Pack        | ✅ Yes          | Built-in via Webpack/Rspack  |

## Setup: Expo SDK 52+

### 1. Enable Import Support

```javascript
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: true,
  },
});

module.exports = config;
```

### 2. Enable Tree Shaking

Create/edit `.env`:

```bash
EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH=1
EXPO_UNSTABLE_TREE_SHAKING=1
```

**Note**: Only applies in production builds.

## Setup: Metro with ESBuild

```bash
npm install @rnx-kit/metro-serializer-esbuild
```

Configure in metro.config.js.

## Setup: Re.Pack (Only If Already Installed)

> **Important**: Re.Pack (`@callstack/repack`) is a custom bundler using Rspack/Webpack. Only apply these instructions if the project already has Re.Pack configured. Do not suggest migrating a codebase to Re.Pack—it's rarely necessary and requires significant setup.

**If project has `@callstack/repack` in dependencies:**

Tree shaking is enabled by default with Rspack. Verify in config:

```javascript
// rspack.config.js or webpack.config.js
module.exports = {
  optimization: {
    usedExports: true, // Mark unused exports
    minimize: true, // Remove during minification
  },
};
```

## Platform Shaking

Code inside `Platform.OS` and `Platform.select` checks is removed for other platforms:

```tsx
// IMPORTANT: import Platform directly from 'react-native'
import { Platform } from 'react-native';

if (Platform.OS === 'ios') {
  // Removed from Android bundle
}

if (Platform.select({ ios: true, android: false }) === 'ios') {
  // Removed from Android bundle
}
```

**Critical**: Must use direct import. This does NOT work:

```tsx
import * as RN from 'react-native';
if (RN.Platform.OS === 'ios') {
  // NOT removed - optimization fails
}
```

For non-Expo projects, requires both `experimentalImportSupport: true` in Metro config and `disableImportExportTransform: true` in Babel config.

Impact: Savings from enabling platform shaking on a bare React Native Community CLI project are:
- 5% smaller Hermes bytecode (2.79 MB → 2.64 MB)
- 15% smaller minified JS bundle (1 MB → 0.85 MB)

## Requirements for Tree Shaking

### ESM Imports Required

```tsx
// ✅ ESM - Tree shakeable
import { foo } from './module';

// ❌ CommonJS - Not tree shakeable
const { foo } = require('./module');
```

### Side Effects Declaration

Libraries must declare side-effect-free in `package.json`:

```json
{
  "sideEffects": false
}
```

Or specify files with side effects:

```json
{
  "sideEffects": ["*.css", "./src/polyfills.js"]
}
```

## Size Impact

| Bundle Type       | Metro (MB) | Re.Pack (MB) | Change   |
| ----------------- | ---------- | ------------ | -------- |
| Production        | 35.63      | 38.48        | +8%      |
| Prod Minified     | 15.54      | 13.36        | **-14%** |
| Prod HBC          | 21.79      | 19.35        | **-11%** |
| Prod Minified HBC | 21.62      | 19.05        | **-12%** |

**Expected improvement**: 10-15% bundle size reduction.

## Verification

1. Build production bundle (see [bundle-analyze-js.md](./bundle-analyze-js.md))
2. Analyze with source-map-explorer (see [bundle-analyze-js.md](./bundle-analyze-js.md))
3. Search for functions you know are unused
4. If found → tree shaking not working

### Test Example

```tsx
// test-treeshake.js
export const usedFunction = () => 'used';
export const unusedFunction = () => 'unused'; // Should be removed

// app.js
import { usedFunction } from './test-treeshake';
```

After building, search bundle for `unusedFunction`. Should not exist.

## Common Pitfalls

- **Not using production build**: Tree shaking only in prod
- **CommonJS modules**: Need ESM for full effectiveness
- **Side effects not declared**: Library may not be shakeable
- **Dynamic imports**: `require(variable)` prevents analysis
- **Babel/Metro config mismatch**: `disableImportExportTransform` must match `experimentalImportSupport`

## Related Skills

- [bundle-analyze-js.md](./bundle-analyze-js.md) - Verify tree shaking effect
- [bundle-barrel-exports.md](./bundle-barrel-exports.md) - Manual alternative
- [bundle-code-splitting.md](./bundle-code-splitting.md) - Re.Pack code splitting
