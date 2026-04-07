---
title: Native SDKs
impact: HIGH
tags: polyfills, intl, crypto, navigation, native
---

# Skill: Native SDKs

Replace web polyfills and JS navigators with native React Native implementations for better performance.

## Quick Pattern

**Before (JS polyfills - 430+ KB):**

```tsx
import '@formatjs/intl-datetimeformat/polyfill';
import CryptoJS from 'crypto-js';
import { createStackNavigator } from '@react-navigation/stack';
```

**After (native implementations):**

```tsx
// Hermes has native Intl.DateTimeFormat support, so this polyfill is often unnecessary
import { createHash } from 'react-native-quick-crypto';  // 58x faster
import { createNativeStackNavigator } from '@react-navigation/native-stack';
```

## When to Use

- Large JS bundle from polyfills
- Navigation feels non-native
- Crypto operations are slow
- Internationalization bloating bundle

## Step-by-Step Instructions

### 1. Remove Unnecessary Intl Polyfills

Hermes supports many `Intl` APIs natively, but not every constructor and method combination across platforms. Audit the exact APIs and methods you use before removing polyfills:

```tsx
// BEFORE: All these polyfills (430+ KB)
import '@formatjs/intl-getcanonicallocales/polyfill';
import '@formatjs/intl-locale/polyfill';
import '@formatjs/intl-numberformat/polyfill';
import '@formatjs/intl-numberformat/locale-data/en';
import '@formatjs/intl-datetimeformat/polyfill';
import '@formatjs/intl-datetimeformat/locale-data/en';
import '@formatjs/intl-pluralrules/polyfill';
import '@formatjs/intl-pluralrules/locale-data/en';
import '@formatjs/intl-relativetimeformat/polyfill';
import '@formatjs/intl-relativetimeformat/locale-data/en';
import '@formatjs/intl-displaynames/polyfill';
```

**Hermes Support (as of March 2026):**

| API | Hermes | Keep Polyfill? |
|-----|--------|----------------|
| `Intl.Collator` | ✅ | No |
| `Intl.DateTimeFormat` | ✅ | No |
| `Intl.NumberFormat` | ⚠️ Partial | Maybe |
| `Intl.getCanonicalLocales()` | ✅ | No |
| `Intl.supportedValuesOf()` | ✅ | No |
| `Intl.Locale` | ❌ | Yes |
| `Intl.PluralRules` | ❌ | Yes |
| `Intl.RelativeTimeFormat` | ❌ | Yes |
| `Intl.DisplayNames` | ❌ | Yes |
| `Intl.ListFormat` | ❌ | Yes |
| `Intl.Segmenter` | ❌ | Yes |

`Intl.NumberFormat` is not fully covered on Hermes across platforms. In particular, `Intl.NumberFormat.prototype.formatToParts()` still has an iOS gap, so keep `@formatjs/intl-numberformat` if your app relies on that method.

```tsx
// AFTER: Keep only the polyfills your app still needs
import '@formatjs/intl-locale/polyfill';
import '@formatjs/intl-pluralrules/polyfill';
import '@formatjs/intl-pluralrules/locale-data/en';
import '@formatjs/intl-relativetimeformat/polyfill';
import '@formatjs/intl-relativetimeformat/locale-data/en';
import '@formatjs/intl-displaynames/polyfill';
```

If you use `Intl.NumberFormat.prototype.formatToParts()` on Hermes/iOS, also keep:

```tsx
import '@formatjs/intl-numberformat/polyfill';
import '@formatjs/intl-numberformat/locale-data/en';
```

### 2. Use Native Crypto

Replace JS crypto with native C++ implementation:

```bash
npm install react-native-quick-crypto
```

**Performance**: Up to 58x faster than `crypto-js`.

```tsx
// BEFORE: Slow JS implementation
import CryptoJS from 'crypto-js';

// AFTER: Native C++ implementation
import { createHash } from 'react-native-quick-crypto';
```

Essential for:
- Web3 wallet seed generation
- CSPRNG (Cryptographically Secure Random Numbers)
- Any heavy cryptographic operations

### 3. Use Native Stack Navigator

```bash
npm install @react-navigation/native-stack react-native-screens
```

```tsx
// BEFORE: JS-based stack (more flexible, less native)
import { createStackNavigator } from '@react-navigation/stack';
const Stack = createStackNavigator();

// AFTER: Native stack (native feel, better performance)
import { createNativeStackNavigator } from '@react-navigation/native-stack';
const Stack = createNativeStackNavigator();

// Usage is nearly identical
<Stack.Navigator>
  <Stack.Screen name="Home" component={HomeScreen} />
  <Stack.Screen name="Details" component={DetailsScreen} />
</Stack.Navigator>
```

**Benefits:**
- Native navigation animations
- Platform-specific headers (large titles on iOS)
- Lower memory usage
- Offloads work from JS thread

### 4. Use Native Bottom Tabs

```bash
npm install @bottom-tabs/react-navigation react-native-bottom-tabs
```

```tsx
// BEFORE: JS tabs
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
const Tabs = createBottomTabNavigator();

// AFTER: Native tabs
import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation';
const Tabs = createNativeBottomTabNavigator();

<Tabs.Navigator>
  <Tabs.Screen name="Home" component={HomeScreen} />
  <Tabs.Screen name="Profile" component={ProfileScreen} />
</Tabs.Navigator>
```

## Recommended Native Libraries

| Category | Library | Description |
|----------|---------|-------------|
| Navigation | `react-native-screens` | Native screen containers |
| Menus | `zeego` | Native menus (Radix-like API) |
| Slider | `@react-native-community/slider` | Native slider |
| Date Picker | `react-native-date-picker` | Native date/time picker |
| Image | `react-native-fast-image` | Native image caching |

## Decision Matrix

| Scenario | Use Native? | Tradeoff |
|----------|-------------|----------|
| Standard navigation | ✅ Yes | Slight API differences |
| Custom transition animations | ⚠️ Maybe | Native is more limited |
| Platform-consistent UI | ✅ Yes | Less customization |
| Unique/branded design | ⚠️ Consider JS | Native may not support |

## Common Pitfalls

- **Assuming constructor support means full method coverage**: Check the specific Hermes API and methods you call
- **Ignoring migration effort**: Native navigators have slightly different APIs
- **Over-customizing native components**: If design requires heavy customization, JS might be better

## Related Skills

- [bundle-analyze-js.md](./bundle-analyze-js.md) - Measure polyfill impact
- [bundle-library-size.md](./bundle-library-size.md) - Compare library sizes
