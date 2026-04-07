---
title: Fast Native Modules
impact: HIGH
tags: turbo-modules, native, swift, kotlin, c++
---

# Skill: Fast Native Modules

Build performant Turbo Modules using modern languages and background threading.

## Quick Pattern

**Incorrect (sync method blocks JS thread):**

```swift
@objc func heavyWork() -> NSNumber {
    Thread.sleep(forTimeInterval: 2)  // Blocks JS for 2s!
    return 42
}
```

**Correct (async on background thread):**

```swift
@objc func heavyWork(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
) {
    DispatchQueue.global().async {
        let result = self.compute()
        resolve(result)
    }
}
```

## When to Use

- Creating new native modules
- Optimizing existing module performance
- Heavy computation needs to run off JS thread
- Cross-platform C++ code needed

## Prerequisites

- React Native Builder Bob for scaffolding

```bash
npx create-react-native-library@latest my-library
```

## Step-by-Step Instructions

### 1. Scaffold with Builder Bob

```bash
npx create-react-native-library@latest awesome-library
# Follow prompts: choose Turbo Module, select languages
```

Creates ready-to-publish library with:
- iOS (Obj-C/Swift) support
- Android (Kotlin) support
- TypeScript definitions
- Codegen setup

For local modules:

```bash
npx create-react-native-library@latest awesome-library --local
```

### 2. Enable Swift in iOS Module

Update `awesome-library.podspec`:

```diff
- s.source_files = "ios/**/*.{h,m,mm,cpp}"
+ s.source_files = "ios/**/*.{h,m,mm,cpp,swift}"
```

Create Swift file in Xcode (accept bridging header prompt).

Update header file for Swift compatibility:

```objc
// AwesomeLibrary.h
#import <Foundation/Foundation.h>

#if __cplusplus
#import "ReactCodegen/RNAwesomeLibrarySpec/RNAwesomeLibrarySpec.h"
#endif

@interface AwesomeLibrary : NSObject
#if __cplusplus
<NativeAwesomeLibrarySpec>
#endif
@end
```

Import header in bridging header:

```objc
// AwesomeLibrary-Bridging-Header.h
#import "AwesomeLibrary.h"
```

Implement in Swift:

```swift
// AwesomeLibrary.swift
import Foundation

extension AwesomeLibrary {
    @objc func multiply(_ a: Double, b: Double) -> NSNumber {
        return (a * b) as NSNumber
    }
}
```

Bridge in Obj-C++:

```objc
// AwesomeLibrary.mm
#import "AwesomeLibrary.h"

#if __has_include("awesome_library/awesome_library-Swift.h")
#import "awesome_library/awesome_library-Swift.h"
#else
#import "awesome_library-Swift.h"
#endif

@implementation AwesomeLibrary
RCT_EXPORT_MODULE()
RCT_EXTERN_METHOD(multiply:(double)a b:(double)b);
@end
```

### 3. Run on Background Thread (iOS)

```swift
@objc func heavyOperation(
    _ input: Double,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
) {
    DispatchQueue.global().async {
        // Heavy work on background thread
        let result = self.expensiveComputation(input)
        resolve(result)
    }
}
```

### 4. Run on Background Thread (Android)

```kotlin
class AwesomeLibraryModule(reactContext: ReactApplicationContext) :
    NativeAwesomeLibrarySpec(reactContext) {
    
    private val moduleScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    
    override fun heavyOperation(input: Double, promise: Promise?) {
        moduleScope.launch {
            // Heavy work on coroutine
            val result = expensiveComputation(input)
            promise?.resolve(result)
        }
    }
    
    override fun invalidate() {
        super.invalidate()
        moduleScope.cancel()  // Prevent memory leaks!
    }
}
```

### 5. Use C++ for Cross-Platform Code

Create C++ Turbo Module for shared logic:

```cpp
// MyCppModule.h
#pragma once

#include <ReactCommon/TurboModule.h>

namespace facebook::react {

class MyCppModule : public TurboModule {
public:
    MyCppModule(std::shared_ptr<CallInvoker> jsInvoker);
    
    double multiply(double a, double b);
};

} // namespace facebook::react
```

Register for iOS auto-linking:

```objc
// MyCppModuleRegistration.mm
#include <ReactCommon/CxxTurboModuleUtils.h>

@implementation MyCppModuleRegistration

+ (void)load {
    facebook::react::registerCxxModuleToGlobalModuleMap(
        std::string(facebook::react::MyCppModule::kModuleName),
        [&](std::shared_ptr<facebook::react::CallInvoker> jsInvoker) {
            return std::make_shared<facebook::react::MyCppModule>(jsInvoker);
        }
    );
}

@end
```

## Threading Summary

| Method Type | Default Thread | Best Practice |
|-------------|----------------|---------------|
| Sync | JS thread | Keep fast (<16ms) |
| Async | Native modules thread | OK for moderate work |
| Heavy async | Custom background | Use DispatchQueue/Coroutines |

## Language Interop Costs

| Interface | Overhead | Notes |
|-----------|----------|-------|
| Obj-C ↔ C++ | ~0 | Compile-time |
| Swift ↔ C++ | ~0 | Swift 5.9+ interop |
| Kotlin ↔ C++ (JNI) | Medium | Per-call lookup |
| C++ Turbo Module | Low | JSI direct access |

**Tip**: C++ Turbo Modules skip JNI at runtime since JS holds direct C++ function references via JSI.

## Code Example: Complete Async Operation

```typescript
// TypeScript interface
export interface Spec extends TurboModule {
    multiply(a: number, b: number): number;  // Sync
    heavyOperation(input: number): Promise<number>;  // Async
}
```

```kotlin
// Android implementation
override fun heavyOperation(input: Double, promise: Promise?) {
    moduleScope.launch {
        try {
            val result = withContext(Dispatchers.Default) {
                // Simulate heavy work
                delay(1000)
                input * 2
            }
            promise?.resolve(result)
        } catch (e: Exception) {
            promise?.reject("ERROR", e.message)
        }
    }
}
```

```swift
// iOS implementation
@objc func heavyOperation(
    _ input: Double,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
) {
    DispatchQueue.global(qos: .userInitiated).async {
        // Simulate heavy work
        Thread.sleep(forTimeInterval: 1.0)
        let result = input * 2
        resolve(result)
    }
}
```

## Common Pitfalls

- **Sync methods that block**: Keep under 16ms or make async
- **Forgetting to cancel coroutine scope**: Causes memory leaks
- **Not handling errors in async**: Always try/catch with reject
- **Accessing UI from background**: Dispatch to main thread

## Related Skills

- [native-threading-model.md](./native-threading-model.md) - Thread details
- [native-memory-patterns.md](./native-memory-patterns.md) - Memory in native code
