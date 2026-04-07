---
title: Profile React Performance
impact: MEDIUM
tags: profiling, devtools, re-renders, flamegraph
---

# Skill: Profile React Performance

Identify unnecessary re-renders and performance bottlenecks in React Native apps using React Native DevTools.

## Quick Command

```bash
# Open React Native DevTools (press 'j' in Metro terminal)
# Or shake device → "Open DevTools"
# Go to Profiler tab → Start profiling → Perform actions → Stop
```

## When to Use

- App feels sluggish or janky during interactions
- Need to identify which components re-render unnecessarily
- Investigating slow list scrolling or form inputs
- Before applying memoization or state management changes

## Prerequisites

- React Native DevTools accessible (press `j` in Metro or use Dev Menu)
- App running in development mode
- React DevTools version 6.0.1+ for React Compiler support

> **Note**: This skill involves interpreting visual profiler output (flame graphs, component highlighting). AI agents cannot yet process screenshots autonomously. Use this as a guide while reviewing the profiler UI manually, or await MCP-based visual feedback integration (see roadmap).

## Step-by-Step Instructions

### 1. Open React Native DevTools

```bash
# Option A: Press 'j' in Metro terminal (works with both RN CLI and Expo)
# Option B: Shake device / Cmd+D (iOS) / Cmd+M (Android) → "Open DevTools"
# Expo: Also accessible via Expo DevTools in browser
```

### 2. Configure Profiler Settings

1. Go to **Profiler** tab
2. Click gear icon (⚙️) for settings
3. Enable:
   - "Highlight updates when components render"
   - "Record why each component rendered while profiling"

### 3. Record a Profiling Session

```
1. Click "Start profiling" (blue circle) or "Reload and start profiling"
2. Perform the interaction you want to analyze
3. Click "Stop profiling"
```

**Use "Reload and start profiling"** for startup performance analysis.

### 4. Analyze the Flame Graph

![React DevTools Flamegraph](images/devtools-flamegraph.png)

The flame graph shows component render hierarchy with timing:

**Color indicators:**
- **Yellow components**: Most time spent rendering (focus here)
- **Green components**: Fast/memoized
- **Gray components**: Did not render

**Right panel shows "Why did this render?":**
- Props changed (shows which prop, e.g., `children`, `onPress`)
- Rendered at timestamps with duration (e.g., "3.7s for 0.9ms")

**Click on a component to see:**
- Why it rendered (hook change, props change, parent re-render)
- Render duration
- Child components affected

### 5. Use Ranked View for Bottom-Up Analysis

Click "Ranked" tab to see components sorted by render time (slowest first).

### 6. Profile JavaScript CPU

For non-React performance issues:

1. Go to **JavaScript Profiler** tab (enable in settings if hidden)
2. Click "Start" to record
3. Perform actions
4. Click "Stop"
5. Use **Heavy (Bottom Up)** view to find slowest functions

## Code Examples

### Before: Unnecessary Re-renders

```jsx
const App = () => {
  const [count, setCount] = useState(0);
  
  return (
    <View>
      <Text>{count}</Text>
      {/* Button re-renders on every count change */}
      <Button onPress={() => setCount(count + 1)} title="Press" />
    </View>
  );
};

const Button = ({onPress, title}) => (
  <Pressable onPress={onPress}>
    <Text>{title}</Text>
  </Pressable>
);
```

### After: Memoized

```jsx
const App = () => {
  const [count, setCount] = useState(0);
  const onPressHandler = useCallback(() => setCount(c => c + 1), []);
  
  return (
    <View>
      <Text>{count}</Text>
      <Button onPress={onPressHandler} title="Press" />
    </View>
  );
};

const Button = memo(({onPress, title}) => (
  <Pressable onPress={onPress}>
    <Text>{title}</Text>
  </Pressable>
));
```

## Interpreting Results

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| Many yellow components | Cascading re-renders | Add memoization or use React Compiler |
| "Props changed" on callbacks | Inline functions recreated | Use `useCallback` |
| "Parent component rendered" | State too high in tree | Move state down or use atomic state |
| Long JS thread block | Heavy computation | Move to background or use `useDeferredValue` |

## Common Pitfalls

- **Profiling in dev mode**: Always disable JS Dev Mode for accurate measurements (Settings > JS Dev Mode on Android)
- **Not using production builds**: Some issues only appear with minified code
- **Ignoring "Why did this render?"**: This tells you exactly what to fix

## Related Skills

- [js-react-compiler.md](./js-react-compiler.md) - Automatic memoization
- [js-atomic-state.md](./js-atomic-state.md) - Reduce re-renders with Jotai/Zustand
- [js-bottomsheet.md](./js-bottomsheet.md) - Profile bottom sheet callback-driven re-renders
- [js-measure-fps.md](./js-measure-fps.md) - Quantify frame rate impact
