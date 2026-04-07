---
title: Bottom Sheet
impact: HIGH
tags: bottom-sheet, gorhom, re-renders, shared-values, gestures, context, scrollable, modal, keyboard
---

# Skill: Bottom Sheet Best Practices

Optimize `@gorhom/bottom-sheet` for smooth 60 FPS by keeping gesture/scroll-driven state on the UI thread.

## Quick Pattern

**Incorrect (can re-enter JS repeatedly during interaction — full subtree re-render):**

```jsx
const handleAnimate = useCallback((fromIndex, toIndex) => {
  setIsExpanded(toIndex > 0); // re-renders entire tree
}, []);

<BottomSheet onAnimate={handleAnimate}>
  <ExpensiveContent isExpanded={isExpanded} />
</BottomSheet>
```

**Correct (stays on UI thread — zero re-renders):**

```jsx
const animatedIndex = useSharedValue(0);

const overlayStyle = useAnimatedStyle(() => ({
  opacity: withTiming(animatedIndex.value > 0 ? 0.5 : 0),
}));

<BottomSheet animatedIndex={animatedIndex}>
  <ExpensiveContent />
</BottomSheet>
<Animated.View style={[styles.overlay, overlayStyle]} />
```

## When to Use

- Implementing or optimizing a bottom sheet with `@gorhom/bottom-sheet`
- Bottom sheet gestures cause jank or dropped frames
- Scroll inside bottom sheet triggers excessive re-renders
- Context provider wrapping bottom sheet re-renders the entire subtree
- Visual-only state (shadow, opacity, footer visibility) managed with `useState`
- Need to choose between `BottomSheet` and `BottomSheetModal`
- Scrollable content inside bottom sheet doesn't coordinate with gestures
- Keyboard doesn't interact properly with the sheet

## Prerequisites

- Check the official [`@gorhom/bottom-sheet` versioning / compatibility table](https://github.com/gorhom/react-native-bottom-sheet#versioning) first.
- If your app is on `@gorhom/bottom-sheet` below v5, upgrade to v5 before applying the patterns in this skill.
- `@gorhom/bottom-sheet` v5 is the current maintained line and is built for `react-native-reanimated` v3.
- `react-native-reanimated` v4 may work in some apps, but the bottom-sheet docs do not officially guarantee it. Decide explicitly whether to stay on v3 or try v4 and validate thoroughly on device.
- `react-native-gesture-handler` v2+

```bash
npm install @gorhom/bottom-sheet@^5 react-native-reanimated@^3 react-native-gesture-handler
```

> **Note**: In v5, `enableDynamicSizing` defaults to `true`. If you need fixed snap-point indexing or do not want the library to insert a dynamic snap point based on content height, set `enableDynamicSizing={false}` explicitly.

## Problem Description

Bottom-sheet gesture, animation, and scroll callbacks that update React state can re-render the sheet subtree during interaction. In practice, callbacks like `onAnimate` may run repeatedly as the sheet retargets animations, which can cause visible jank if they drive expensive React updates.

## Step-by-Step Instructions

### 1. Convert Gesture-Driven State to SharedValue

Avoid React state for gesture-driven visual state. Update a shared value and consume it via `useAnimatedStyle`.

**Before:**

```jsx
const [shadowOpacity, setShadowOpacity] = useState(0);

const handleAnimate = useCallback((fromIndex, toIndex) => {
  setShadowOpacity(toIndex > 0 ? 0.3 : 0);
}, []);

<BottomSheet onAnimate={handleAnimate}>
  <View style={{ shadowOpacity }}>
    <HeavyContent />
  </View>
</BottomSheet>
```

**After:**

```jsx
const animatedIndex = useSharedValue(0);

const shadowStyle = useAnimatedStyle(() => ({
  shadowOpacity: withTiming(animatedIndex.value > 0 ? 0.3 : 0),
}));

<BottomSheet animatedIndex={animatedIndex}>
  <Animated.View style={shadowStyle}>
    <HeavyContent />
  </Animated.View>
</BottomSheet>
```

### 2. Drive Sheet-Index Visibility via `useAnimatedReaction`

Toggling content based on sheet index via `{showFooter && <Footer/>}` causes mount/unmount cycles on every snap. Instead, always mount, animate visibility from `animatedIndex`, and bridge only the minimal boolean needed for `pointerEvents`/accessibility — scoped to a wrapper so the full tree doesn't re-render.

**Before:**

```jsx
const [showFooter, setShowFooter] = useState(false);

// re-mounts footer on every toggle
{showFooter && <Footer />}
```

**After:**

```jsx
const SheetVisibilityWrapper = ({ animatedIndex, threshold = 1, children }) => {
  const [isInteractive, setIsInteractive] = useState(false);

  const style = useAnimatedStyle(() => ({
    opacity: withTiming(animatedIndex.value >= threshold ? 1 : 0),
    transform: [{ translateY: withTiming(animatedIndex.value >= threshold ? 0 : 50) }],
  }));

  useAnimatedReaction(
    () => animatedIndex.value >= threshold,
    (visible, prev) => {
      if (visible !== prev) runOnJS(setIsInteractive)(visible);
    }
  );

  return (
    <Animated.View
      style={style}
      pointerEvents={isInteractive ? 'auto' : 'none'}
      accessibilityElementsHidden={!isInteractive}
      importantForAccessibility={isInteractive ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </Animated.View>
  );
};

// Usage:
<SheetVisibilityWrapper animatedIndex={animatedIndex}>
  <Footer />
</SheetVisibilityWrapper>
```

### 3. Keep Scroll-Driven Logic off the JS Thread

`BottomSheetScrollView` ignores `scrollEventThrottle`, so setting it is not an optimization. Keep JS `onScroll` work minimal, or move scroll-driven logic to `useAnimatedScrollHandler` (see [js-animations-reanimated.md](./js-animations-reanimated.md)) so it stays on the UI thread:

```jsx
const scrollHandler = useAnimatedScrollHandler((event) => {
  scrollY.value = event.contentOffset.y;
});

<BottomSheetScrollView onScroll={scrollHandler}>
  <Content />
</BottomSheetScrollView>
```

### 4. Use Library-Provided Components and Props

**Scrollables** — always use these instead of React Native built-ins inside a bottom sheet:

```jsx
import {
  BottomSheetScrollView,
  BottomSheetFlatList,
  BottomSheetSectionList,
} from '@gorhom/bottom-sheet';

// FlashList v2: BottomSheetFlashList is deprecated.
// Create the scroll component, then pass it to FlashList.
import { useBottomSheetScrollableCreator } from '@gorhom/bottom-sheet';
import { FlashList } from '@shopify/flash-list';

const BottomSheetFlashListScrollComponent = useBottomSheetScrollableCreator();

<BottomSheet snapPoints={snapPoints} enableDynamicSizing={false}>
  <FlashList
    data={data}
    keyExtractor={(item) => item.id}
    renderItem={renderItem}
    renderScrollComponent={BottomSheetFlashListScrollComponent}
  />
</BottomSheet>
```

**Key props:**

| Prop | Purpose |
|------|---------|
| `containerHeight` | Provide to skip extra measurement re-render on mount |
| `enableDynamicSizing={false}` | Use when you want fixed snap-point indexing and do not want a dynamic content-height snap point inserted |
| `animatedIndex` | SharedValue for continuous index tracking on UI thread |
| `animatedPosition` | SharedValue for continuous position tracking on UI thread |
| `onChange` | Fires on snap **completion** only (discrete) — use for analytics/side effects |
| `onAnimate` | Fires before each animation start/retarget — use sparingly, because it can run repeatedly during interaction |

### 5. BottomSheetModal Setup

```jsx
import {
  BottomSheetModal,
  BottomSheetModalProvider,
} from '@gorhom/bottom-sheet';

const App = () => (
  <BottomSheetModalProvider>
    <BottomSheetModal
      ref={modalRef}
      snapPoints={snapPoints}
      enableDismissOnClose={true}
    >
      <Content />
    </BottomSheetModal>
  </BottomSheetModalProvider>
);
```

**iOS layering fix** — use `FullWindowOverlay` to render above native navigation:

```jsx
import { FullWindowOverlay } from 'react-native-screens';

<BottomSheetModal
  containerComponent={(props) => <FullWindowOverlay>{props.children}</FullWindowOverlay>}
>
```

### 6. Keyboard Handling

```jsx
<BottomSheet
  snapPoints={snapPoints}
  enableDynamicSizing={false}
  keyboardBehavior="interactive"    // 'extend' | 'fillParent' | 'interactive'
  keyboardBlurBehavior="restore"    // reset sheet position when keyboard dismisses
  enableBlurKeyboardOnGesture={true} // dismiss keyboard on drag
>
  <BottomSheetTextInput
    placeholder="Type here..."
    style={styles.input}
  />
</BottomSheet>
```

| `keyboardBehavior` | Effect |
|--------------------|--------|
| `extend` | Sheet grows to accommodate keyboard |
| `fillParent` | Sheet fills parent when keyboard appears |
| `interactive` | Sheet follows keyboard position interactively |

> Prefer `BottomSheetTextInput` inside a bottom sheet. If you need a custom input, copy the focus/blur handlers from the library's `BottomSheetTextInput` implementation so keyboard handling still works correctly.

## Derived Animations with `animatedPosition`

Use the `animatedPosition` shared value for smooth derived UI that stays on the UI thread:

```jsx
const animatedPosition = useSharedValue(0);

const backdropStyle = useAnimatedStyle(() => ({
  opacity: interpolate(
    animatedPosition.value,
    [0, 300],
    [0.5, 0],
    Extrapolation.CLAMP
  ),
}));

<BottomSheet animatedPosition={animatedPosition} snapPoints={snapPoints}>
  <Content />
</BottomSheet>
<Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none" />
```

## Native Alternative: react-native-true-sheet

If your app already runs on **New Architecture (Fabric)**, consider `@lodev09/react-native-true-sheet` — a fully native bottom sheet that sidesteps JS re-render problems entirely.

| Scenario | Recommendation |
|----------|---------------|
| Need deep JS customization (custom gestures, animated derived UI) | `@gorhom/bottom-sheet` |
| Standard sheet with native feel + accessibility | `react-native-true-sheet` |
| Legacy Architecture (no Fabric) | `@gorhom/bottom-sheet` (true-sheet v3+ requires Fabric) |
| Web support needed | Either (true-sheet uses `@gorhom/bottom-sheet` on web internally) |

**Advantages**: zero JS overhead (sheet lives in native land — no SharedValue plumbing needed), built-in keyboard handling, native screen reader support, side sheet on tablets, iOS 26+ Liquid Glass support, React Navigation sheet navigator integration.

**Requirements**: New Architecture (Fabric) for v3+, use v2.x for Legacy Architecture.

```bash
npm install @lodev09/react-native-true-sheet
```

> If requirements are met and you don't need the fine-grained Reanimated-driven customization described in this skill, `react-native-true-sheet` is the simpler and more performant choice.

## Common Pitfalls

- **Using `onChange` for continuous position tracking** — it fires on snap completion only (discrete). Use `animatedPosition` or `animatedIndex` shared values instead.
- **Forgetting `pointerEvents='none'` on always-mounted hidden elements** — invisible elements still capture touches.
- **Missing accessibility attributes on hidden elements** — add `accessibilityElementsHidden` and `importantForAccessibility='no-hide-descendants'`.
- **Bundling independent state values in one context** — see [js-atomic-state.md](./js-atomic-state.md) for splitting patterns.
- **Assuming `enableDynamicSizing` must be disabled whenever you pass `snapPoints`** — it does not have to be, but leaving it enabled can insert an additional snap point and change indexing.
- **Using React Native `ScrollView`/`FlatList` inside bottom sheet** — gestures won't coordinate. Use `BottomSheetScrollView`, `BottomSheetFlatList`, etc.
- **Using React Native touchables on Android** — import `TouchableOpacity`, `TouchableHighlight`, or `TouchableWithoutFeedback` from `@gorhom/bottom-sheet`.
- **Not providing `containerHeight`** — causes an extra re-render on mount for measurement.
- **Using a custom `TextInput` without porting the library's focus/blur handlers** — keyboard handling will be incomplete. Prefer `BottomSheetTextInput` unless you need a custom input.

## Related Skills

- [js-animations-reanimated.md](./js-animations-reanimated.md) — SharedValue and useAnimatedStyle fundamentals
- [js-atomic-state.md](./js-atomic-state.md) — Context splitting and atomic state patterns
- [js-profile-react.md](./js-profile-react.md) — Profiling to measure re-render reduction
- [js-measure-fps.md](./js-measure-fps.md) — Verify FPS improvement after optimization
