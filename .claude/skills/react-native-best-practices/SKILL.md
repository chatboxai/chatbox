---
name: react-native-best-practices
description: Provides React Native performance optimization guidelines for FPS, TTI, bundle size, memory leaks, re-renders, and animations. Applies to tasks involving Hermes optimization, JS thread blocking, bridge overhead, FlashList, native modules, or debugging jank and frame drops.
license: MIT
metadata:
  author: Callstack
  tags: react-native, expo, performance, optimization, profiling
---

# React Native Best Practices

## Overview

Performance optimization guide for React Native applications, covering JavaScript/React, Native (iOS/Android), and bundling optimizations. Based on Callstack's "Ultimate Guide to React Native Optimization".

## Skill Format

Each reference file follows a hybrid format for fast lookup and deep understanding:

- **Quick Pattern**: Incorrect/Correct code snippets for immediate pattern matching
- **Quick Command**: Shell commands for process/measurement skills
- **Quick Config**: Configuration snippets for setup-focused skills
- **Quick Reference**: Summary tables for conceptual skills
- **Deep Dive**: Full context with When to Use, Prerequisites, Step-by-Step, Common Pitfalls

**Impact ratings**: CRITICAL (fix immediately), HIGH (significant improvement), MEDIUM (worthwhile optimization)

## When to Apply

Reference these guidelines when:
- Debugging slow/janky UI or animations
- Investigating memory leaks (JS or native)
- Optimizing app startup time (TTI)
- Reducing bundle or app size
- Writing native modules (Turbo Modules)
- Profiling React Native performance
- Reviewing React Native code for performance

## Security Notes

- Treat shell commands in these references as local developer operations. Review them before running, prefer version-pinned tooling, and avoid piping remote scripts directly to a shell.
- Treat third-party libraries and plugins as dependencies that still require normal supply-chain controls: pin versions, verify provenance, and update through your standard review process.
- Treat Re.Pack code splitting as first-party artifact delivery only. Remote chunks must come from trusted HTTPS origins you control and be pinned to the current app release.

## Priority-Ordered Guidelines

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | FPS & Re-renders | CRITICAL | `js-*` |
| 2 | Bundle Size | CRITICAL | `bundle-*` |
| 3 | TTI Optimization | HIGH | `native-*`, `bundle-*` |
| 4 | Native Performance | HIGH | `native-*` |
| 5 | Memory Management | MEDIUM-HIGH | `js-*`, `native-*` |
| 6 | Animations | MEDIUM | `js-*` |

## Quick Reference

### Optimization Workflow

Follow this cycle for any performance issue: **Measure → Optimize → Re-measure → Validate**

1. **Measure**: Capture baseline metrics (FPS, TTI, bundle size) before changes
2. **Optimize**: Apply the targeted fix from the relevant reference
3. **Re-measure**: Run the same measurement to get updated metrics
4. **Validate**: Confirm improvement (e.g., FPS 45→60, TTI 3.2s→1.8s, bundle 2.1MB→1.6MB)

If metrics did not improve, revert and try the next suggested fix.

### Critical: FPS & Re-renders

**Profile first:**
```bash
# Open React Native DevTools
# Press 'j' in Metro, or shake device → "Open DevTools"
```

**Common fixes:**
- Replace ScrollView with FlatList/FlashList for lists
- Use React Compiler for automatic memoization
- Use atomic state (Jotai/Zustand) to reduce re-renders
- Use `useDeferredValue` for expensive computations

### Critical: Bundle Size

**Analyze bundle:**
```bash
npx react-native bundle \
  --entry-file index.js \
  --bundle-output output.js \
  --platform ios \
  --sourcemap-output output.js.map \
  --dev false --minify true

npx source-map-explorer output.js --no-border-checks
```

**Verify improvement after optimization:**
```bash
# Record baseline size before changes
ls -lh output.js  # e.g., Before: 2.1 MB

# After applying fixes, re-bundle and compare
npx react-native bundle --entry-file index.js --bundle-output output.js \
  --platform ios --dev false --minify true
ls -lh output.js  # e.g., After: 1.6 MB  (24% reduction)
```

**Common fixes:**
- Avoid barrel imports (import directly from source)
- Remove unnecessary Intl polyfills only after checking Hermes API and method coverage
- Enable tree shaking (Expo SDK 52+ or Re.Pack)
- Enable R8 for Android native code shrinking

### High: TTI Optimization

**Measure TTI:**
- Use `react-native-performance` for markers
- Only measure cold starts (exclude warm/hot/prewarm)

**Common fixes:**
- Disable JS bundle compression on Android (enables Hermes mmap)
- Use native navigation (react-native-screens)
- Preload commonly-used expensive screens before navigating to them

### High: Native Performance

**Profile native:**
- iOS: Xcode Instruments → Time Profiler
- Android: Android Studio → CPU Profiler

**Common fixes:**
- Use background threads for heavy native work
- Prefer async over sync Turbo Module methods
- Use C++ for cross-platform performance-critical code

## References

Full documentation with code examples in [references/][references]:

### JavaScript/React (`js-*`)

| File | Impact | Description |
|------|--------|-------------|
| [js-lists-flatlist-flashlist.md][js-lists-flatlist-flashlist] | CRITICAL | Replace ScrollView with virtualized lists |
| [js-profile-react.md][js-profile-react] | MEDIUM | React DevTools profiling |
| [js-measure-fps.md][js-measure-fps] | HIGH | FPS monitoring and measurement |
| [js-memory-leaks.md][js-memory-leaks] | MEDIUM | JS memory leak hunting |
| [js-atomic-state.md][js-atomic-state] | HIGH | Jotai/Zustand patterns |
| [js-concurrent-react.md][js-concurrent-react] | HIGH | useDeferredValue, useTransition |
| [js-react-compiler.md][js-react-compiler] | HIGH | Automatic memoization |
| [js-animations-reanimated.md][js-animations-reanimated] | MEDIUM | Reanimated worklets |
| [js-bottomsheet.md][js-bottomsheet] | HIGH | Bottom sheet optimization |
| [js-uncontrolled-components.md][js-uncontrolled-components] | HIGH | TextInput optimization |

### Native (`native-*`)

| File | Impact | Description |
|------|--------|-------------|
| [native-turbo-modules.md][native-turbo-modules] | HIGH | Building fast native modules |
| [native-sdks-over-polyfills.md][native-sdks-over-polyfills] | HIGH | Native vs JS libraries |
| [native-measure-tti.md][native-measure-tti] | HIGH | TTI measurement setup |
| [native-threading-model.md][native-threading-model] | HIGH | Turbo Module threads |
| [native-profiling.md][native-profiling] | MEDIUM | Xcode/Android Studio profiling |
| [native-platform-setup.md][native-platform-setup] | MEDIUM | iOS/Android tooling guide |
| [native-view-flattening.md][native-view-flattening] | MEDIUM | View hierarchy debugging |
| [native-memory-patterns.md][native-memory-patterns] | MEDIUM | C++/Swift/Kotlin memory |
| [native-memory-leaks.md][native-memory-leaks] | MEDIUM | Native memory leak hunting |
| [native-android-16kb-alignment.md][native-android-16kb-alignment] | CRITICAL | Third-party library alignment for Google Play |

### Bundling (`bundle-*`)

| File | Impact | Description |
|------|--------|-------------|
| [bundle-barrel-exports.md][bundle-barrel-exports] | CRITICAL | Avoid barrel imports |
| [bundle-analyze-js.md][bundle-analyze-js] | CRITICAL | JS bundle visualization |
| [bundle-tree-shaking.md][bundle-tree-shaking] | HIGH | Dead code elimination |
| [bundle-analyze-app.md][bundle-analyze-app] | HIGH | App size analysis |
| [bundle-r8-android.md][bundle-r8-android] | HIGH | Android code shrinking |
| [bundle-hermes-mmap.md][bundle-hermes-mmap] | HIGH | Disable bundle compression |
| [bundle-native-assets.md][bundle-native-assets] | HIGH | Asset catalog setup |
| [bundle-library-size.md][bundle-library-size] | MEDIUM | Evaluate dependencies |
| [bundle-code-splitting.md][bundle-code-splitting] | MEDIUM | Re.Pack code splitting |


## Searching References

```bash
# Find patterns by keyword
grep -l "reanimated" references/
grep -l "flatlist" references/
grep -l "memory" references/
grep -l "profil" references/
grep -l "tti" references/
grep -l "bundle" references/
```

## Problem → Skill Mapping

| Problem | Start With |
|---------|------------|
| App feels slow/janky | [js-measure-fps.md][js-measure-fps] → [js-profile-react.md][js-profile-react] |
| Too many re-renders | [js-profile-react.md][js-profile-react] → [js-react-compiler.md][js-react-compiler] |
| Slow startup (TTI) | [native-measure-tti.md][native-measure-tti] → [bundle-analyze-js.md][bundle-analyze-js] |
| Large app size | [bundle-analyze-app.md][bundle-analyze-app] → [bundle-r8-android.md][bundle-r8-android] |
| Memory growing | [js-memory-leaks.md][js-memory-leaks] or [native-memory-leaks.md][native-memory-leaks] |
| Animation drops frames | [js-animations-reanimated.md][js-animations-reanimated] |
| Bottom sheet jank/re-renders | [js-bottomsheet.md][js-bottomsheet] → [js-animations-reanimated.md][js-animations-reanimated] |
| List scroll jank | [js-lists-flatlist-flashlist.md][js-lists-flatlist-flashlist] |
| TextInput lag | [js-uncontrolled-components.md][js-uncontrolled-components] |
| Native module slow | [native-turbo-modules.md][native-turbo-modules] → [native-threading-model.md][native-threading-model] |
| Native library alignment issue | [native-android-16kb-alignment.md][native-android-16kb-alignment] |

[references]: references/
[js-lists-flatlist-flashlist]: references/js-lists-flatlist-flashlist.md
[js-profile-react]: references/js-profile-react.md
[js-measure-fps]: references/js-measure-fps.md
[js-memory-leaks]: references/js-memory-leaks.md
[js-atomic-state]: references/js-atomic-state.md
[js-concurrent-react]: references/js-concurrent-react.md
[js-react-compiler]: references/js-react-compiler.md
[js-animations-reanimated]: references/js-animations-reanimated.md
[js-bottomsheet]: references/js-bottomsheet.md
[js-uncontrolled-components]: references/js-uncontrolled-components.md
[native-turbo-modules]: references/native-turbo-modules.md
[native-sdks-over-polyfills]: references/native-sdks-over-polyfills.md
[native-measure-tti]: references/native-measure-tti.md
[native-threading-model]: references/native-threading-model.md
[native-profiling]: references/native-profiling.md
[native-platform-setup]: references/native-platform-setup.md
[native-view-flattening]: references/native-view-flattening.md
[native-memory-patterns]: references/native-memory-patterns.md
[native-memory-leaks]: references/native-memory-leaks.md
[native-android-16kb-alignment]: references/native-android-16kb-alignment.md
[bundle-barrel-exports]: references/bundle-barrel-exports.md
[bundle-analyze-js]: references/bundle-analyze-js.md
[bundle-tree-shaking]: references/bundle-tree-shaking.md
[bundle-analyze-app]: references/bundle-analyze-app.md
[bundle-r8-android]: references/bundle-r8-android.md
[bundle-hermes-mmap]: references/bundle-hermes-mmap.md
[bundle-native-assets]: references/bundle-native-assets.md
[bundle-library-size]: references/bundle-library-size.md
[bundle-code-splitting]: references/bundle-code-splitting.md

## Attribution

Based on "The Ultimate Guide to React Native Optimization" by Callstack.
