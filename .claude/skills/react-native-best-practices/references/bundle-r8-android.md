---
title: R8 Code Shrinking
impact: HIGH
tags: android, r8, proguard, minify, shrink
---

# Skill: R8 Code Shrinking

Enable R8 for Android to shrink, optimize, and obfuscate native code.

## Quick Config

```groovy
// android/app/build.gradle
def enableProguardInReleaseBuilds = true

android {
    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
        }
    }
}
```

## When to Use

- Android app size too large
- Want to obfuscate code for security
- Building release APK/AAB

## What is R8?

R8 replaces ProGuard in Android:
- **Shrinks**: Removes unused code
- **Optimizes**: Improves bytecode
- **Obfuscates**: Renames classes/methods

**Compatibility**: Uses ProGuard configuration format.

## Step-by-Step Instructions

### 1. Enable R8

Edit `android/app/build.gradle`:

```groovy
def enableProguardInReleaseBuilds = true
```

This sets `minifyEnabled = true` for release builds.

### 2. Enable Resource Shrinking (Optional)

Further reduces size by removing unused resources:

```groovy
android {
    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true  // Requires minifyEnabled
            
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### 3. Configure ProGuard Rules (If Needed)

Edit `android/app/proguard-rules.pro`. React Native defaults are usually sufficient—only add rules when specific libraries break after enabling R8.

**Only add if using Firebase (`@react-native-firebase/*`):**

```proguard
-keep class io.invertase.firebase.** { *; }
-dontwarn io.invertase.firebase.**
```

**Only add if using Retrofit:**

```proguard
-keepattributes Signature
-keepattributes *Annotation*
-keep class retrofit2.** { *; }
-dontwarn retrofit2.**
```

See [Common Library Rules](#common-library-rules) and [Troubleshooting](#troubleshooting) for more examples.

### 4. Build and Test

```bash
cd android
./gradlew assembleRelease
# or
./gradlew bundleRelease
```

**Critical**: Test thoroughly! R8 can remove code it thinks is unused.

## ProGuard Rules Reference

| Rule | Effect |
|------|--------|
| `-keep class X` | Don't remove class X |
| `-keepclassmembers` | Keep members but allow rename |
| `-keepnames` | Keep names but allow removal if unused |
| `-dontwarn X` | Suppress warnings for X |
| `-dontobfuscate` | Disable obfuscation |

### Keep Entire Package

```proguard
-keep class com.mypackage.** { *; }
```

### Keep Classes with Annotation

```proguard
-keep @interface com.facebook.proguard.annotations.DoNotStrip
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
}
```

## Disable Obfuscation (If Needed)

```proguard
# proguard-rules.pro
-dontobfuscate
```

Use when:
- Debugging crashes (stack traces more readable)
- Library requires class names

## Size Impact

Example from guide:
- **Without R8**: 9.5 MB
- **With R8**: 6.3 MB
- **Savings**: 33%

Larger apps may see 20-30% reduction.

## Troubleshooting

### App Crashes After R8

Usually means needed class was removed.

**Debug steps**:

1. Check crash log for class name
2. Add keep rule:
   ```proguard
   -keep class com.example.CrashedClass { *; }
   ```
3. Rebuild and test

### Library Specific Rules

Many libraries provide ProGuard rules. Check:
- Library README
- Library's `consumer-proguard-rules.pro`
- Stack Overflow for library + proguard

### Common Library Rules

```proguard
# Hermes (usually auto-included)
-keep class com.facebook.hermes.unicode.** { *; }

# React Native
-keep class com.facebook.react.** { *; }

# Gson
-keepattributes Signature
-keep class com.google.gson.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
```

## Verification

### Check APK Size

```bash
# Build
./gradlew assembleRelease

# Check size
ls -la android/app/build/outputs/apk/release/
```

### Use Ruler for Detailed Analysis

See [bundle-analyze-app.md](./bundle-analyze-app.md).

### Verify Obfuscation

Decompile APK to check class names are obfuscated:

```bash
# Using jadx or similar
jadx android/app/build/outputs/apk/release/app-release.apk
```

## Common Pitfalls

- **Not testing release build**: Always QA with R8 enabled
- **Missing library rules**: Check library docs
- **Over-keeping**: Too many keep rules negates benefits
- **Reflection**: Code using reflection may break

## Related Skills

- [bundle-analyze-app.md](./bundle-analyze-app.md) - Measure size impact
- [bundle-native-assets.md](./bundle-native-assets.md) - Further size reduction
