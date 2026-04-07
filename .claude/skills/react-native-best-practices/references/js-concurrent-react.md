---
title: Concurrent React
impact: HIGH
tags: useDeferredValue, useTransition, suspense, concurrent
---

# Skill: Concurrent React

Use `useDeferredValue` and `useTransition` to improve perceived performance by prioritizing critical updates.

## Quick Pattern

**Incorrect (blocks input on every keystroke):**

```jsx
const [query, setQuery] = useState('');
<TextInput value={query} onChangeText={setQuery} />
<ExpensiveList query={query} />  // Blocks typing
```

**Correct (input stays responsive):**

```jsx
const [query, setQuery] = useState('');
const deferredQuery = useDeferredValue(query);
<TextInput value={query} onChangeText={setQuery} />
<ExpensiveList query={deferredQuery} />  // Deferred update
```

## When to Use

- Search/filter inputs feel laggy with large result sets
- Expensive computations block UI interactions
- Loading states appear too frequently
- Want to show stale content while loading new content
- Need to prioritize user input over background updates

## Prerequisites

- React Native with New Architecture enabled (default in RN 0.76+)
- React 18+ features (`useDeferredValue`, `useTransition`, `Suspense`)

## Concept Overview

**Concurrent React** allows updates to be:
- **Paused**: Low-priority work can wait
- **Interrupted**: User input takes priority
- **Abandoned**: Outdated updates can be skipped

## Step-by-Step Instructions

### Pattern 1: Defer Expensive Rendering with `useDeferredValue`

Use when a value drives expensive computation but you want input to stay responsive.

```jsx
import { useState, useDeferredValue } from 'react';

const SearchScreen = () => {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  
  // query updates immediately (input stays responsive)
  // deferredQuery updates when React has time
  
  return (
    <View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search..."
      />
      {/* ExpensiveList receives deferred value */}
      <ExpensiveList query={deferredQuery} />
    </View>
  );
};
```

### Pattern 2: Show Stale Content While Loading

```jsx
const SearchWithStaleIndicator = () => {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;
  
  return (
    <View>
      <TextInput value={query} onChangeText={setQuery} />
      <View style={isStale && { opacity: 0.7 }}>
        <SearchResults query={deferredQuery} />
      </View>
      {isStale && <ActivityIndicator />}
    </View>
  );
};
```

### Pattern 3: Transition Non-Critical Updates with `useTransition`

Use when you have multiple state updates and want to mark some as low-priority.

```jsx
import { useState, useTransition } from 'react';

const TransitionExample = () => {
  const [count, setCount] = useState(0);
  const [heavyData, setHeavyData] = useState(null);
  const [isPending, startTransition] = useTransition();
  
  const handleIncrement = () => {
    // High priority - updates immediately
    setCount(c => c + 1);
    
    // Low priority - can be interrupted
    startTransition(() => {
      setHeavyData(computeExpensiveData());
    });
  };
  
  return (
    <View>
      <Text>Count: {count}</Text>
      {isPending ? <ActivityIndicator /> : <HeavyComponent data={heavyData} />}
      <Button onPress={handleIncrement} title="Increment" />
    </View>
  );
};
```

### Pattern 4: Suspense for Data Fetching

```jsx
import { Suspense, useDeferredValue } from 'react';

const DataScreen = () => {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  
  return (
    <View>
      <TextInput value={query} onChangeText={setQuery} />
      <Suspense fallback={<LoadingSpinner />}>
        <SearchResults query={deferredQuery} />
      </Suspense>
    </View>
  );
};
```

## Code Examples

### Slow Component Optimization

```jsx
// Without Concurrent React - UI freezes
const SlowSearch = () => {
  const [query, setQuery] = useState('');
  
  return (
    <>
      <TextInput value={query} onChangeText={setQuery} />
      <SlowComponent query={query} /> {/* Blocks every keystroke */}
    </>
  );
};

// With Concurrent React - UI stays responsive  
const FastSearch = () => {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  
  return (
    <>
      <TextInput value={query} onChangeText={setQuery} />
      <SlowComponent query={deferredQuery} />
    </>
  );
};

// Important: Wrap SlowComponent in memo to prevent re-renders from parent
const SlowComponent = memo(({ query }) => {
  // Expensive computation here
});
```

### Automatic Batching (React 18+)

React 18 automatically batches state updates:

```jsx
// Before React 18 - 2 re-renders
setTimeout(() => {
  setCount(c => c + 1);
  setFlag(f => !f);
  // Rendered twice
}, 1000);

// React 18+ - 1 re-render (automatic batching)
setTimeout(() => {
  setCount(c => c + 1);
  setFlag(f => !f);
  // Rendered once!
}, 1000);
```

## When to Use Which

| Scenario | Solution |
|----------|----------|
| Single value drives expensive render | `useDeferredValue` |
| Multiple state updates, some non-critical | `useTransition` |
| Need loading indicator for transition | `useTransition` (has `isPending`) |
| Data fetching with loading states | `Suspense` + `useDeferredValue` |
| Simple parent-to-child value deferral | `useDeferredValue` |

## Important Considerations

1. **Wrap expensive components in `memo()`**: Without memoization, the component re-renders from parent anyway.

2. **Use with New Architecture**: Concurrent features require New Architecture in React Native.

3. **Don't overuse**: Only defer truly expensive work. Adding complexity for fast components is counterproductive.

## Common Pitfalls

- **Forgetting memo()**: `useDeferredValue` is useless if child re-renders from parent
- **Using for simple state**: Overhead isn't worth it for cheap updates
- **Expecting faster computation**: These hooks don't make code faster, they prioritize what runs when

## Related Skills

- [js-profile-react.md](./js-profile-react.md) - Identify slow components
- [js-react-compiler.md](./js-react-compiler.md) - Automatic memoization
- [js-lists-flatlist-flashlist.md](./js-lists-flatlist-flashlist.md) - For list-specific optimizations
