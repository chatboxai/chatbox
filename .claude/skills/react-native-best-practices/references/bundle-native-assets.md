---
title: Native Assets
impact: HIGH
tags: assets, images, asset-catalog, app-thinning
---

# Skill: Native Assets

Configure platform-specific asset delivery to reduce app download size.

## Quick Config

**iOS Asset Catalog (Build Phase):**

```bash
# Add to "Bundle React Native code and images" build phase
export EXTRA_PACKAGER_ARGS="--asset-catalog-dest ./"
```

**Android**: Automatic via AAB — Play Store delivers correct density per device.

## When to Use

- Images bloating app size
- Different device densities need different assets
- Want to leverage App Store/Play Store optimization
- Using high-resolution images

## Concept: Size Suffixes

React Native convention for multiple resolutions:

```
assets/
├── image.jpg       # 1x resolution (base)
├── image@2x.jpg    # 2x resolution
└── image@3x.jpg    # 3x resolution
```

```tsx
// React Native selects best one for device
<Image source={require('./assets/image.jpg')} />
```

## Android: Automatic Optimization

Android handles this automatically.

### How It Works

1. Build AAB:
   ```bash
   cd android && ./gradlew bundleRelease
   ```

2. Metro places images in density folders:
   ```
   android/app/build/outputs/bundle/release/
   └── base/
       └── res/
           ├── drawable-mdpi-v4/     # 1x
           ├── drawable-hdpi-v4/     # 1.5x
           ├── drawable-xhdpi-v4/    # 2x
           ├── drawable-xxhdpi-v4/   # 3x
           └── drawable-xxxhdpi-v4/  # 4x
   ```

3. Play Store delivers only needed density per device.

**No configuration required** for Android.

## iOS: Asset Catalog Setup

iOS requires explicit configuration.

### Step 1: Create Asset Catalog

Create folder in `ios/`:

```
ios/RNAssets.xcassets/
```

**Important**: Must be named exactly `RNAssets.xcassets` (hardcoded in React Native).

### Step 2: Configure Build Phase

In Xcode:
1. Open project settings
2. Go to **Build Phases**
3. Find **"Bundle React Native code and images"**
4. Add before line 8:

```bash
export EXTRA_PACKAGER_ARGS="--asset-catalog-dest ./"
```

### Step 3: Build

Run build to populate asset catalog:

```bash
npx react-native run-ios --mode Release
```

Or manually:

```bash
npx react-native bundle \
  --entry-file index.js \
  --bundle-output ios-bundle.js \
  --platform ios \
  --dev false \
  --asset-catalog-dest ios \
  --assets-dest ios/assets
```

### Step 4: Verify

After build, `RNAssets.xcassets` contains:

```
ios/RNAssets.xcassets/
└── assets_image_image.imageset/
    ├── Contents.json
    ├── image.jpg
    ├── image@2x.jpg
    └── image@3x.jpg
```

App Store then delivers only needed resolution.

## Before/After Comparison

### Without Asset Catalog (All Variants)

```
App bundle contains:
├── image.jpg       (100 KB)
├── image@2x.jpg    (300 KB)
└── image@3x.jpg    (600 KB)
Total: 1 MB
```

### With Asset Catalog (Device-Specific)

```
iPhone 15 Pro receives:
└── image@3x.jpg    (600 KB)
Total: 600 KB  (40% smaller)
```

## Asset Optimization Tips

### 1. Compress Images

Use tools before adding to project:

```bash
# ImageOptim (macOS)
# TinyPNG (web)
# sharp (programmatic)

npx sharp-cli input.jpg -o output.jpg --quality 80
```

### 2. Use Appropriate Formats

| Format | Best For |
|--------|----------|
| JPEG | Photos |
| PNG | Icons, transparency |
| WebP | Both (smaller) |
| SVG | Vector icons |

### 3. Consider react-native-fast-image

Caching and better image handling:

```bash
npm install react-native-fast-image
```

## Verification

### iOS App Thinning Report

After export, check `App Thinning Size Report.txt`:

```
Variant: MyApp-<UUID>.ipa
Supported variant descriptors: iPhone15,2 ...
App size: 3.5 MB compressed, 10.6 MB uncompressed
```

### Use Emerge Tools

Upload IPA to see asset breakdown.

## Common Pitfalls

- **Wrong folder name**: Must be `RNAssets.xcassets` exactly
- **Missing build phase config**: Assets not processed
- **Not using size suffixes**: All variants included anyway
- **Forgetting to rebuild**: Changes need fresh build

## Future Note

As of January 2025, Asset Catalog is not default. May become default in future React Native versions.

## Related Skills

- [bundle-analyze-app.md](./bundle-analyze-app.md) - Verify asset impact
- [bundle-r8-android.md](./bundle-r8-android.md) - Android code optimization
