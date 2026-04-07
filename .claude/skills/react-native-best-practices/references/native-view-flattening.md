---
title: View Flattening
impact: MEDIUM
tags: views, flattening, collapsable, hierarchy
---

# Skill: View Flattening

Understand and debug React Native's view flattening optimization.

## Quick Pattern

**Problem (children get flattened unexpectedly):**

```jsx
<NativeTabBar>
  <Tab1 />  // May be flattened, breaking native component
  <Tab2 />
</NativeTabBar>
```

**Solution (prevent flattening):**

```jsx
<NativeTabBar>
  <Tab1 collapsable={false} />
  <Tab2 collapsable={false} />
</NativeTabBar>
```

## When to Use

- Native component receives unexpected number of children
- Layout debugging with native components
- Building native components that accept children
- Understanding React Native rendering

> **Note**: This skill involves interpreting visual view hierarchy tools (Xcode Debug View Hierarchy, Android Layout Inspector). AI agents cannot yet process screenshots autonomously. Use this as a guide while reviewing the hierarchy manually, or await MCP-based visual feedback integration (see roadmap).

## What is View Flattening?

React Native's renderer automatically removes "layout-only" views that:
- Only affect layout (no visual rendering)
- Don't need to exist in native view hierarchy

**Benefits**: Reduced memory, faster rendering, shallower view tree.

## The Problem with Native Components

```tsx
// You expect 3 children
<MyNativeComponent>
  <Child1 />
  <Child2 />
  <Child3 />
</MyNativeComponent>
```

If `Child1` is flattened, its internal views become direct children:

```tsx
// Native side receives 5 views instead of 3!
<MyNativeComponent>
  <View />   // Was inside Child1
  <View />   // Was inside Child1  
  <View />   // Was inside Child1
  <Child2 />
  <Child3 />
</MyNativeComponent>
```

## Preventing Flattening with `collapsable`

```tsx
<MyNativeComponent>
  <Child1 collapsable={false} />
  <Child2 collapsable={false} />
  <Child3 collapsable={false} />
</MyNativeComponent>
```

Now native side always receives exactly 3 children.

## Debugging View Hierarchy

![View Hierarchy Flattening](images/view-hierarchy-flattening.png)

Use native debugging tools to see the actual view hierarchy:

### Xcode (iOS)

1. Run app via Xcode
2. Click **"Debug View Hierarchy"** in debug toolbar (shown in image)
3. Inspect 3D view of native hierarchy

**React Native components map to:**
- `<View />` → `RCTViewComponentView`
- `<Text />` → `RCTTextView`

### Android Studio

1. Run app via Android Studio
2. **View → Tool Windows → Layout Inspector**
3. Select running process

**React Native components map to:**
- `<View />` → `ReactViewGroup`
- `<Text />` → `ReactTextView`

## Code Examples

### When Flattening Breaks Your Component

```tsx
// Your native component expects exactly 2 tabs
const NativeTabBar = requireNativeComponent('RCTTabBar');

// BAD: TabContent might get flattened
const MyTabs = () => (
  <NativeTabBar>
    <TabContent title="Home">
      <View><Text>Home content</Text></View>
    </TabContent>
    <TabContent title="Profile">
      <View><Text>Profile content</Text></View>
    </TabContent>
  </NativeTabBar>
);

// GOOD: Prevent flattening
const MyTabs = () => (
  <NativeTabBar>
    <TabContent title="Home" collapsable={false}>
      <View><Text>Home content</Text></View>
    </TabContent>
    <TabContent title="Profile" collapsable={false}>
      <View><Text>Profile content</Text></View>
    </TabContent>
  </NativeTabBar>
);
```

### Wrapper Component with collapsable

```tsx
// Wrapper that prevents flattening
const NativeChildWrapper = ({ children, ...props }) => (
  <View collapsable={false} {...props}>
    {children}
  </View>
);

// Usage
<NativeComponent>
  <NativeChildWrapper>
    <ComplexChild />
  </NativeChildWrapper>
</NativeComponent>
```

## When Views Get Flattened

Views are considered "layout-only" when they:
- Have no `backgroundColor`
- Have no `borderWidth`, `borderColor`
- Have no `shadowColor`, `elevation`
- Don't handle events (no `onPress`, etc.)
- Don't use `opacity` < 1
- Don't have `overflow: 'hidden'`

## Forcing a View to Stay

Besides `collapsable={false}`, these also prevent flattening:

```tsx
// Any of these prevent flattening
<View style={{ backgroundColor: 'transparent' }} />
<View style={{ borderWidth: 0.01 }} />
<View style={{ opacity: 0.99 }} />
<View onLayout={() => {}} />
```

But `collapsable={false}` is the cleanest solution.

## Debugging Checklist

1. **Check native child count**: Log received children in native code
2. **Use Layout Inspector**: Visual hierarchy debugging
3. **Add collapsable={false}**: Test if flattening is the issue
4. **Check wrapper components**: Intermediate views may be flattened

## Common Pitfalls

- **Assuming JS children = native children**: Flattening changes this
- **Not documenting native component requirements**: If your native component expects specific child count, document it
- **Over-using collapsable={false}**: Only use when necessary (loses optimization benefits)

## Related Skills

- [native-platform-setup.md](./native-platform-setup.md) - IDE setup for debugging
- [native-profiling.md](./native-profiling.md) - Performance impact analysis
