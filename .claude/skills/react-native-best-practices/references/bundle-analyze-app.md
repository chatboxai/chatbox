---
title: Analyze App Bundle Size
impact: HIGH
tags: app-size, ruler, emerge-tools, thinning
---

# Skill: Analyze App Bundle Size

Measure iOS and Android app download/install sizes using Ruler, App Store Connect, and Emerge Tools.

## Quick Command

```bash
# Android (Ruler)
cd android && ./gradlew analyzeReleaseBundle

# iOS (Xcode export with thinning)
cd ios && xcodebuild -exportArchive \
  -archivePath MyApp.xcarchive \
  -exportPath ./export \
  -exportOptionsPlist ExportOptions.plist
# Check: App Thinning Size Report.txt
```

## When to Use

- App download size is too large
- Users complain about storage usage
- App approaching store limits
- Comparing releases for size regression

> **Note**: This skill involves interpreting visual size reports (Ruler, Emerge Tools X-Ray). AI agents cannot yet process screenshots autonomously. Use this as a guide while reviewing the reports manually, or await MCP-based visual feedback integration (see roadmap).

## Key Metrics

| Metric | Description | User Impact |
|--------|-------------|-------------|
| Download Size | Compressed, transferred over network | Download time, data usage |
| Install Size | Uncompressed, on device storage | Storage space |

**Google finding**: Every 6 MB increase reduces installs by 1%.

## Android: Ruler (Spotify)

### Setup

Add to `android/build.gradle`:

```groovy
buildscript {
    dependencies {
        classpath("com.spotify.ruler:ruler-gradle-plugin:2.0.0-beta-3")
    }
}
```

Add to `android/app/build.gradle`:

```groovy
apply plugin: "com.spotify.ruler"

ruler {
    abi.set("arm64-v8a")  // Target architecture
    locale.set("en")
    screenDensity.set(480)
    sdkVersion.set(34)
}
```

### Analyze

```bash
cd android
./gradlew analyzeReleaseBundle
```

Opens HTML report with:
- Download size
- Install size
- Component breakdown (biggest → smallest)

### CI Size Validation

```groovy
ruler {
    verification {
        downloadSizeThreshold = 20 * 1024 * 1024  // 20 MB
        installSizeThreshold = 50 * 1024 * 1024   // 50 MB
    }
}
```

Build fails if thresholds exceeded.

## iOS: Xcode App Thinning

### Via App Store Connect (Most Accurate)

After uploading to TestFlight:
1. Open App Store Connect
2. Go to your build
3. View size table by device variant

**Note**: TestFlight builds include debug data, App Store builds slightly larger due to DRM.

### Via Xcode Export

1. Archive app: **Product → Archive**
2. In Organizer, click **Distribute App**
3. Select **Custom**
4. Choose **App Thinning: All compatible device variants**

Or in `ExportOptions.plist`:

```xml
<key>thinning</key>
<string>&lt;thin-for-all-variants&gt;</string>
```

### Output

Creates folder with:
- **Universal IPA**: All variants combined
- **Thinned IPAs**: One per device variant
- **App Thinning Size Report.txt**:

```
Variant: SampleApp-<UUID>.ipa
App + On Demand Resources size: 3.5 MB compressed, 10.6 MB uncompressed
App size: 3.5 MB compressed, 10.6 MB uncompressed
```

- Compressed = Download size
- Uncompressed = Install size

## Emerge Tools (Cross-Platform)

Third-party service with visual analysis.

### Upload

Upload IPA, APK, or AAB through their web interface or CI integration.

### Features

![Emerge Tools X-Ray for iOS](images/emerge-xray-ios.png)

- **X-Ray**: Treemap visualization (like source-map-explorer for binaries)
  - Shows Frameworks (hermes.framework), Mach-O sections (TEXT, DATA), etc.
  - Color-coded: Binaries, Localizations, Fonts, Asset Catalogs, Videos, CoreML Models
  - Visible components: `main.jsbundle` (JS code), RCT modules, DYLD sections
- **Breakdown**: Component-by-component size
- **Insights**: Automated suggestions (use with caution)

**Caution**: Some suggestions may not apply to React Native (e.g., "remove Hermes").

## Size Comparison

| Tool | Platform | Accuracy | CI Integration |
|------|----------|----------|----------------|
| Ruler | Android | High | Yes (Gradle) |
| App Store Connect | iOS | Highest | No |
| Xcode Export | iOS | High | Yes (xcodebuild) |
| Emerge Tools | Both | High | Yes (API) |

## Typical React Native App Sizes

| Component | Approximate Size |
|-----------|------------------|
| Hermes engine | ~2-3 MB |
| React Native core | ~3-5 MB |
| JavaScript bundle | 1-10 MB |
| Assets (images, etc.) | Varies |

**Baseline empty app**: ~6-10 MB download

## Optimization Impact Example

| Optimization | Size Reduction |
|--------------|----------------|
| Enable R8 (Android) | ~30% |
| Remove unused polyfills | 400+ KB |
| Asset catalog (iOS) | 10-50% of assets |
| Tree shaking | 10-15% |

## Quick Commands

```bash
# Android release bundle size
cd android && ./gradlew bundleRelease
# Check: android/app/build/outputs/bundle/release/

# iOS archive
cd ios && xcodebuild -workspace ios/MyApp.xcworkspace \
  -scheme MyApp \
  -configuration Release \
  -archivePath MyApp.xcarchive \
  archive

# Export with thinning report
cd ios && xcodebuild -exportArchive \
  -archivePath MyApp.xcarchive \
  -exportPath ./export \
  -exportOptionsPlist ExportOptions.plist
```

## Related Skills

- [bundle-r8-android.md](./bundle-r8-android.md) - Reduce Android size
- [bundle-native-assets.md](./bundle-native-assets.md) - Optimize asset delivery
- [bundle-analyze-js.md](./bundle-analyze-js.md) - JS bundle analysis
