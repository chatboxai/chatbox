---
title: High-Performance Animations
impact: MEDIUM
tags: reanimated, animations, worklets, ui-thread
---

# Skill: High-Performance Animations

Use React Native Reanimated for smooth 60+ FPS animations.

## Quick Pattern

**Incorrect (JS thread - blocks on heavy work):**

```jsx
const opacity = useRef(new Animated.Value(0)).current;
Animated.timing(opacity, { toValue: 1 }).start();
```

**Correct (UI thread - smooth even during JS work):**

```jsx
const opacity = useSharedValue(0);
const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
opacity.value = withTiming(1);
```

## When to Use

- Animations drop frames or feel janky
- UI freezes during animations
- Need gesture-driven animations
- Want animations to run during heavy JS work

## Prerequisites

- `react-native-reanimated` (v4+) and `react-native-worklets` installed

```bash
npm install react-native-reanimated react-native-worklets
```

Add to `babel.config.js`:

```javascript
module.exports = {
  plugins: ['react-native-worklets/plugin'],  // Must be last
};
```

> **Note**: Reanimated 4 requires React Native's **New Architecture** (Fabric + TurboModules). The Legacy Architecture is no longer supported. If upgrading from v3, see the migration notes at the end of this document.

## Key Concepts

### Main Thread vs JS Thread

- **Main/UI Thread**: Handles native rendering (60+ FPS target)
- **JS Thread**: Runs React and your JavaScript

**Problem**: Heavy JS work blocks animations running on JS thread.

**Solution**: Run animations on UI thread with Reanimated worklets.

## Step-by-Step Instructions

### 1. Basic Animated Style (UI Thread)

```jsx
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming
} from 'react-native-reanimated';

const FadeInView = () => {
  const opacity = useSharedValue(0);

  // This runs on UI thread - won't be blocked by JS
  const animatedStyle = useAnimatedStyle(() => {
    return { opacity: opacity.value };
  });

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 500 });
  }, []);

  return <Animated.View style={[styles.box, animatedStyle]} />;
};
```

### 2. Run Code on UI Thread with `scheduleOnUI`

```jsx
import { scheduleOnUI } from 'react-native-worklets';

const triggerAnimation = () => {
  scheduleOnUI(() => {
    'worklet';
    console.log('Running on UI thread');
    // Direct UI manipulations here
  });
};
```

### 3. Call JS from UI Thread with `scheduleOnRN`

```jsx
import { scheduleOnRN } from 'react-native-worklets';

// Regular JS function
const trackAnalytics = (value) => {
  analytics.track('animation_complete', { value });
};

const AnimatedComponent = () => {
  const progress = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => {
    // When animation completes, call JS function
    if (progress.value === 1) {
      scheduleOnRN(trackAnalytics, progress.value);
    }
    return { opacity: progress.value };
  });

  return <Animated.View style={animatedStyle} />;
};
```

### 4. Animation with Callback

```jsx
import { scheduleOnRN } from 'react-native-worklets';

const AnimatedButton = () => {
  const scale = useSharedValue(1);

  const onComplete = () => {
    console.log('Animation finished!');
  };

  const handlePress = () => {
    scale.value = withTiming(
      1.2,
      { duration: 200 },
      (finished) => {
        if (finished) {
          scheduleOnRN(onComplete);
        }
      }
    );
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable onPress={handlePress}>
      <Animated.View style={[styles.button, animatedStyle]}>
        <Text>Press Me</Text>
      </Animated.View>
    </Pressable>
  );
};
```

## When to Use What

| Thread | Best For |
|--------|----------|
| **UI Thread** (worklets) | Visual animations, transforms, gestures |
| **JS Thread** | State updates, data processing, API calls |

| Hook/API | Use Case |
|----------|----------|
| `useAnimatedStyle` | Animated styles (auto UI thread) |
| `scheduleOnUI` | Manual UI thread execution (from `react-native-worklets`) |
| `scheduleOnRN` | Call JS functions from worklets (from `react-native-worklets`) |
| `useTransition` | Alternative for React state-driven delays |

## Common Pitfalls

- **Accessing React state in worklets**: Use `useSharedValue` instead of `useState` for animated values
- **Not using Animated components**: Must use `Animated.View`, `Animated.Text`, etc.
- **Heavy computation in useAnimatedStyle**: Keep worklets fast
- **Forgetting 'worklet' directive**: Required for inline worklet functions

```jsx
// BAD: Regular function in useAnimatedStyle
const style = useAnimatedStyle(() => {
  heavyComputation();  // Blocks UI thread!
  return { opacity: 1 };
});

// GOOD: Keep worklets fast
const style = useAnimatedStyle(() => {
  return { opacity: opacity.value };  // Just read value
});
```

## Migrating from Reanimated 3.x to 4.x

If you're upgrading from Reanimated 3.x, here are the key changes.

> **Can't upgrade to v4?** If your project is blocked from migrating to New Architecture (e.g., incompatible native libraries, complex native code, or timeline constraints), keep using existing APIs and leverage native drivers where applicable. Avoid introducing legacy Reanimated 3.x or older to reduce future migration complexity.

### Breaking Changes

| Old API (v3) | New API (v4) | Package |
|--------------|--------------|---------|
| `runOnUI(() => {...})()` | `scheduleOnUI(() => {...})` | `react-native-worklets` |
| `runOnJS(fn)(args)` | `scheduleOnRN(fn, args)` | `react-native-worklets` |
| `executeOnUIRuntimeSync` | `runOnUISync` | `react-native-worklets` |
| `runOnRuntime` | `scheduleOnRuntime` | `react-native-worklets` |
| `useScrollViewOffset` | `useScrollOffset` | `react-native-reanimated` |
| `useWorkletCallback` | Use `useCallback` with `'worklet';` directive | React |

### Removed APIs

- `useAnimatedGestureHandler` - Migrate to the Gesture API from `react-native-gesture-handler` v2+
- `addWhitelistedNativeProps` / `addWhitelistedUIProps` - No longer needed
- `combineTransition` - Use `EntryExitTransition.entering(...).exiting(...)` instead

### withSpring Changes

```jsx
// Before (v3)
withSpring(value, {
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.01,
  duration: 300,
});

// After (v4)
withSpring(value, {
  energyThreshold: 0.01,  // Replaces both threshold parameters
  duration: 200,          // Duration is now "perceptual" (~1.5x actual time)
});
```

### Migration Checklist

1. **Enable New Architecture** - Reanimated 4 only supports Fabric + TurboModules
2. **Install `react-native-worklets`** - Required new dependency
3. **Update Babel plugin** - Change `'react-native-reanimated/plugin'` to `'react-native-worklets/plugin'`
4. **Update imports** - Move worklet functions to `react-native-worklets`
5. **Update API calls** - New functions take callback + args directly (not curried)
6. **Rebuild native apps** - Required after adding `react-native-worklets`

## Related Skills

- [js-measure-fps.md](./js-measure-fps.md) - Verify animation frame rate
- [js-bottomsheet.md](./js-bottomsheet.md) - Keep bottom sheet visual state on the UI thread
- [js-concurrent-react.md](./js-concurrent-react.md) - React-level deferral with useTransition
