---
title: React Compiler
impact: HIGH
tags: memoization, react-compiler, memo, useMemo, useCallback
---

# Skill: React Compiler

Set up React Compiler to automatically memoize components and eliminate unnecessary re-renders.

## Quick Pattern

**Before (manual memoization):**

```jsx
const MemoizedButton = memo(({ onPress }) => <Pressable onPress={onPress} />);
const handler = useCallback(() => doSomething(), []);
```

**After (automatic with React Compiler):**

```jsx
// No memo/useCallback needed - compiler handles it
const Button = ({ onPress }) => <Pressable onPress={onPress} />;
const handler = () => doSomething();
```

## When to Use

- Want automatic performance optimization without manual `memo`/`useMemo`/`useCallback`
- Codebase follows Rules of React
- React Native 0.76+ or Expo SDK 52+
- Ready to remove boilerplate memoization code

## Prerequisites

- React 17+ (React 19 recommended for best compatibility)
- Babel-based build system
- Code follows [Rules of React](https://react.dev/reference/rules)

## Step-by-Step Instructions

### Step 1: Check Compatibility

Before enabling the compiler, verify your project is compatible:

```bash
npx react-compiler-healthcheck@latest
```

This checks if your app follows the Rules of React and identifies potential issues.

### Step 2: Install React Compiler

#### Expo Projects

**SDK 54 and later** (simplified setup):

```bash
npx expo install babel-plugin-react-compiler
```

**SDK 52-53**:

```bash
npx expo install babel-plugin-react-compiler@beta react-compiler-runtime@beta
```

Then enable in your app config:

```json
// app.json
{
  "expo": {
    "experiments": {
      "reactCompiler": true
    }
  }
}
```

#### React Native (without Expo)

```bash
npm install -D babel-plugin-react-compiler@latest
```

For React Native < 0.78 (React < 19), also install the runtime:

```bash
npm install react-compiler-runtime@beta
```

### Step 3: Configure Babel (React Native without Expo)

For non-Expo React Native projects, configure Babel manually:

```javascript
// babel.config.js
const ReactCompilerConfig = {
  target: '19', // Use '18' for React Native < 0.78
};

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: [
      ['babel-plugin-react-compiler', ReactCompilerConfig], // Must run first!
      // ... other plugins
    ],
  };
};
```

> **Important**: React Compiler must run **first** in your Babel plugin pipeline. The compiler needs the original source information for proper analysis.

### Step 4: Set Up ESLint (Recommended)

The ESLint plugin helps identify code that can't be optimized and enforces the Rules of React.

#### Expo Projects

```bash
npx expo lint  # Ensures ESLint is set up
npx expo install eslint-plugin-react-compiler -- -D
```

Configure ESLint:

```javascript
// .eslintrc.js
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const reactCompiler = require('eslint-plugin-react-compiler');

module.exports = defineConfig([
  expoConfig,
  reactCompiler.configs.recommended,
  {
    ignores: ['dist/*'],
  },
]);
```

#### React Native (without Expo)

```bash
npm install -D eslint-plugin-react-hooks@latest
```

The compiler rules are available in the `recommended-latest` preset. Follow the [eslint-plugin-react-hooks installation instructions](https://github.com/facebook/react/tree/main/packages/eslint-plugin-react-hooks).

### Step 5: Verify Optimizations

Open React DevTools. Optimized components show a `Memo ✨` badge.

You can also verify by checking build output—compiled code includes automatic memoization:

```javascript
import { c as _c } from 'react/compiler-runtime';

export default function MyApp() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for('react.memo_cache_sentinel')) {
    t0 = <div>Hello World</div>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
```

**Note**: React Native 0.76+ includes DevTools with Memo badge support by default. For older versions or third-party debuggers with version mismatches, you may need to override `react-devtools-core` in `package.json`.

## Incremental Adoption

You can incrementally adopt React Compiler using two strategies:

### Strategy 1: Limit to Specific Directories

Configure the Babel plugin to only run on specific files, e.g. `src/path/to/dir` in the following examples:

**Expo** (create `babel.config.js` with `npx expo customize babel.config.js`):

```javascript
// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          'react-compiler': {
            sources: (filename) => {
              return filename.includes('src/path/to/dir');
            },
          },
        },
      ],
    ],
  };
};
```

**React Native (without Expo)**:

```javascript
// babel.config.js
const ReactCompilerConfig = {
  target: '19',
  sources: (filename) => {
    return filename.includes('src/path/to/dir');
  },
};

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: [['babel-plugin-react-compiler', ReactCompilerConfig]],
  };
};
```

After changing `babel.config.js`, restart Metro with cache cleared:

```bash
# Expo
npx expo start --clear

# React Native CLI
npx react-native start --reset-cache
```

### Strategy 2: Opt Out Specific Components

Use the `"use no memo"` directive to skip optimization for specific components or files:

```jsx
function ProblematicComponent() {
  'use no memo';

  return <Text>Will not be optimized</Text>;
}
```

This is useful for temporarily opting out components that cause issues. Fix the underlying problem and remove the directive once resolved.

## How It Works

The compiler transforms your code to automatically cache values:

**Before (your code):**

```jsx
export default function MyApp() {
  const [value, setValue] = useState('');
  return (
    <TextInput onChangeText={() => setValue(value)}>Hello World</TextInput>
  );
}
```

**After (compiled output):**

```jsx
import { c as _c } from 'react/compiler-runtime';

export default function MyApp() {
  const $ = _c(2); // Cache with 2 slots
  const [value, setValue] = useState('');

  let t0;
  if ($[0] !== value) {
    t0 = (
      <TextInput onChangeText={() => setValue(value)}>Hello World</TextInput>
    );
    $[0] = value;
    $[1] = t0;
  } else {
    t0 = $[1]; // Return cached JSX
  }
  return t0;
}
```

## Code Examples

### React Compiler Playground

Test transformations at [React Playground](https://playground.react.dev/).

### What Gets Optimized

```jsx
// Components - auto-memoized
const Button = ({ onPress, label }) => (
  <Pressable onPress={onPress}>
    <Text>{label}</Text>
  </Pressable>
);

// Callbacks - auto-cached (no useCallback needed)
const handlePress = () => {
  console.log('pressed');
};

// Expensive computations - auto-cached (no useMemo needed)
const filtered = items.filter((item) => item.active);
```

### What Breaks Compilation

```jsx
// BAD: Mutating props
const BadComponent = ({ items }) => {
  items.push('new item'); // Mutation!
  return <List data={items} />;
};

// BAD: Mutating during render
const BadMutation = () => {
  const [items, setItems] = useState([]);
  items.push('new'); // Mutation during render!
  return <List data={items} />;
};

// BAD: Non-idempotent render
let counter = 0;
const BadRender = () => {
  counter++; // Side effect during render!
  return <Text>{counter}</Text>;
};
```

## Should You Remove Manual Memoization?

Improvements are primarily automatic. You can remove instances of `useCallback`, `useMemo`, and `React.memo` in favor of automatic memoization once the compiler is working correctly in your project.

**Note**: Class components will not be optimized. Migrate to function components for full benefits.

Expo's implementation only runs on application code (not node_modules), and only when bundling for the client (disabled in server rendering).

## Expected Performance Improvements

Testing on Expensify app showed:

- **4.3% improvement** in Chat Finder TTI
- Significant reduction in cascading re-renders
- Most impact on apps without existing manual optimization

Already heavily optimized apps may see marginal gains.

## Common Pitfalls

- **Not fixing ESLint errors first**: When ESLint reports an error, the compiler skips that component—this is safe but means you miss optimization
- **Expecting it to fix bad patterns**: Compiler optimizes good code, doesn't fix bad code
- **Forgetting shallow comparison**: Like `memo`, compiler uses shallow comparison for objects/arrays
- **Not running healthcheck**: Always run `npx react-compiler-healthcheck@latest` before enabling

## Related Skills

- [js-profile-react.md](./js-profile-react.md) - Verify optimization impact
- [js-atomic-state.md](./js-atomic-state.md) - Alternative for state-related re-renders
