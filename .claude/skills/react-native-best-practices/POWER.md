---
name: react-native-best-practices
description: Provides React Native performance optimization guidelines for FPS, TTI, bundle size, memory leaks, re-renders, and animations. Applies to tasks involving Hermes optimization, JS thread blocking, bridge overhead, FlashList, native modules, or debugging jank and frame drops.
license: MIT
author: Callstack
keywords: ["react-native", "expo", "performance", "optimization", "profiling"]
---

# Onboarding

## Step 1: Validate React Native Setup

Before applying performance optimizations, ensure:
- **Expo CLI** or **React Native CLI** is installed
  - Verify with: `npx expo --version` and `npx react-native --version`
- Metro bundler is running (**apply only for** bundle analysis)
- React Native DevTools is available (**apply only for** profiling)
  - Press 'j' in Metro terminal or shake device → "Open DevTools"

## Security Guardrails

- Review shell commands before running them and prefer version-pinned tooling from trusted sources.
- Do not pipe remote install scripts directly into a shell.
- Treat third-party packages as normal supply-chain dependencies that require provenance and version review.
- If using Re.Pack code splitting, only load first-party chunks from trusted HTTPS origins tied to the current release.

# When to Load Reference Files

Load specific reference files from `references/` based on the task:

## JavaScript/React Performance (`js-*`)

- **Debugging slow/janky UI or animations** → `references/js-measure-fps.md`
- **Investigating re-render issues** → `references/js-profile-react.md` → `references/js-react-compiler.md`
- **Optimizing list scrolling** → `references/js-lists-flatlist-flashlist.md`
- **Reducing re-renders with state management** → `references/js-atomic-state.md`
- **Using Concurrent React features** → `references/js-concurrent-react.md`
- **Enabling automatic memoization** → `references/js-react-compiler.md`
- **Optimizing animations** → `references/js-animations-reanimated.md`
- **Fixing TextInput lag** → `references/js-uncontrolled-components.md`
- **Hunting JavaScript memory leaks** → `references/js-memory-leaks.md`

## Native Performance (`native-*`)

- **Measuring startup time (TTI)** → `references/native-measure-tti.md`
- **Building native modules** → `references/native-turbo-modules.md`
- **Understanding native threading** → `references/native-threading-model.md`
- **Profiling native code** → `references/native-profiling.md`
- **Setting up native tooling** → `references/native-platform-setup.md`
- **Debugging view hierarchy** → `references/native-view-flattening.md`
- **Native memory patterns** → `references/native-memory-patterns.md`
- **Hunting native memory leaks** → `references/native-memory-leaks.md`
- **Choosing native SDKs vs polyfills** → `references/native-sdks-over-polyfills.md`
- **Fixing Android 16KB alignment** → `references/native-android-16kb-alignment.md`

## Bundle & App Size (`bundle-*`)

- **Analyzing bundle size** → `references/bundle-analyze-js.md`
- **Analyzing app size** → `references/bundle-analyze-app.md`
- **Fixing barrel imports** → `references/bundle-barrel-exports.md`
- **Enabling tree shaking** → `references/bundle-tree-shaking.md`
- **Android code shrinking** → `references/bundle-r8-android.md`
- **Optimizing Hermes bundle loading** → `references/bundle-hermes-mmap.md`
- **Managing native assets** → `references/bundle-native-assets.md`
- **Evaluating library size** → `references/bundle-library-size.md`
- **Code splitting** → `references/bundle-code-splitting.md`

## Problem → Reference Mapping

Use this quick lookup when debugging specific issues:

| Problem | Start With |
|---------|-----------|
| App feels slow/janky | `references/js-measure-fps.md` → `references/js-profile-react.md` |
| Too many re-renders | `references/js-profile-react.md` → `references/js-react-compiler.md` |
| Slow startup (TTI) | `references/native-measure-tti.md` → `references/bundle-analyze-js.md` |
| Large app size | `references/bundle-analyze-app.md` → `references/bundle-r8-android.md` |
| Memory growing | `references/js-memory-leaks.md` or `references/native-memory-leaks.md` |
| Animation drops frames | `references/js-animations-reanimated.md` |
| List scroll jank | `references/js-lists-flatlist-flashlist.md` |
| TextInput lag | `references/js-uncontrolled-components.md` |
| Native module slow | `references/native-turbo-modules.md` → `references/native-threading-model.md` |
| Native library alignment issue | `references/native-android-16kb-alignment.md` |

## Quick Reference Commands

### FPS & Re-renders
```bash
# Open React Native DevTools
# Press 'j' in Metro, or shake device → "Open DevTools"
```

**Common fixes:**
- Replace ScrollView with FlatList/FlashList for lists
- Use React Compiler for automatic memoization
- Use atomic state (Jotai/Zustand) to reduce re-renders
- Use `useDeferredValue` for expensive computations

### Analyze Bundle Size
```bash
npx react-native bundle \
  --entry-file index.js \
  --bundle-output output.js \
  --platform ios \
  --sourcemap-output output.js.map \
  --dev false --minify true

npx source-map-explorer output.js --no-border-checks
```

**Common fixes:**
- Avoid barrel imports (import directly from source)
- Remove unnecessary Intl polyfills only after checking Hermes API and method coverage
- Enable tree shaking (Expo SDK 52+ or Re.Pack)
- Enable R8 for Android native code shrinking

### Measure TTI
- Use `react-native-performance` for markers
- Only measure cold starts (exclude warm/hot/prewarm)

**Common fixes:**
- Disable JS bundle compression on Android (enables Hermes mmap)
- Use native navigation (react-native-screens)
- Preload commonly-used expensive screens before navigating to them

### Native Performance

**Profile native:**
- iOS: Xcode Instruments → Time Profiler
- Android: Android Studio → CPU Profiler

**Common fixes:**
- Use background threads for heavy native work
- Prefer async over sync Turbo Module methods
- Use C++ for cross-platform performance-critical code

## Priority Guidelines

Apply optimizations in this order:

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | FPS & Re-renders | CRITICAL | `js-*` |
| 2 | Bundle Size | CRITICAL | `bundle-*` |
| 3 | TTI Optimization | HIGH | `native-*`, `bundle-*` |
| 4 | Native Performance | HIGH | `native-*` |
| 5 | Memory Management | MEDIUM-HIGH | `js-*`, `native-*` |
| 6 | Animations | MEDIUM | `js-*` |

## Attribution

Based on "The Ultimate Guide to React Native Optimization" by Callstack.
