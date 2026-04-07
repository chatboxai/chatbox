---
title: Threading Model
impact: HIGH
tags: threads, turbo-modules, fabric, async, sync
---

# Skill: Threading Model

Understand which threads Turbo Modules and Fabric use for initialization, method calls, and view updates.

## Quick Reference

| Action | iOS Thread | Android Thread |
|--------|------------|----------------|
| Module init | Main | JS (lazy) / Native (eager) |
| Sync method | JS | JS |
| Async method | Native modules | Native modules |
| View init/props | Main | Main |
| Yoga layout | JS | JS |

**Key rule**: Sync methods block JS thread. Keep under 16ms or make async.

## When to Use

- Building native modules
- Debugging threading issues
- Accessing UI from native code
- Understanding async vs sync method behavior

## Available Threads

| Thread | Name in Debugger | Purpose |
|--------|------------------|---------|
| Main/UI | Main thread | UI rendering, UIKit/Android Views |
| JavaScript | `mqt_v_js` | JS execution, React |
| Native Modules | `mqt_v_native` | Async Turbo Module calls |
| Custom | Various | Your background threads |

## Turbo Modules Threading

### Initialization

| Platform | Thread | Notes |
|----------|--------|-------|
| iOS | Main thread | Assumes UIKit access needed |
| Android (lazy) | JS thread | Default behavior |
| Android (eager) | Native modules thread | When `needsEagerInit = true` |

**iOS**: React Native runs `init` on main thread assuming UIKit access.

**Android Eager Loading:**

```kotlin
// ReactModuleInfo constructor params:
// canOverrideExistingModule, needsEagerInit, isCxxModule, isTurboModule
ReactModuleInfo(
    AwesomeModule.NAME,
    AwesomeModule.NAME,
    false,
    true,   // needsEagerInit = true → runs on native modules thread
    false,
    true
)
```

### Synchronous Method Calls

**Always run on JS thread** - blocks until return.

```swift
// iOS - runs on JS thread
@objc func multiply(_ a: Double, b: Double) -> NSNumber {
    // This blocks JS for entire duration!
    return a * b as NSNumber
}
```

**Danger**: Long sync operations freeze the app:

```swift
// BAD: Blocks JS for 20 seconds
@objc func multiply(_ a: Double, b: Double) -> NSNumber {
    Thread.sleep(forTimeInterval: 20)  // App frozen!
    return a * b as NSNumber
}
```

### Asynchronous Method Calls

**Run on Native Modules thread** - doesn't block JS.

```swift
// iOS - runs on mqt_v_native thread
@objc func asyncOperation(
    _ a: Double,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
) {
    // Already on background thread
    resolve(a * 2)
}
```

```kotlin
// Android - runs on native modules thread
override fun asyncOperation(a: Double, promise: Promise?) {
    // Already on background thread
    promise?.resolve(a * 2)
}
```

### Module Invalidation

Called when React Native instance is torn down (e.g., Metro reload):

| Platform | Thread |
|----------|--------|
| iOS | Native modules thread |
| Android | ReactHost thread pool |

**iOS**: Implement `RCTInvalidating` protocol.

## Fabric (Native Views) Threading

### View Lifecycle

| Operation | Thread |
|-----------|--------|
| View init | Main thread |
| Prop updates | Main thread |
| Layout (Yoga) | JS thread |

Views always manipulate UI on main thread (UIKit/Android requirement).

### Yoga Layout

Layout calculations happen on JS thread:

```
JS Thread: Calculate Yoga tree → Shadow tree
Main Thread: Apply layout to native views
```

## Moving Work to Background

### iOS: DispatchQueue

```swift
@objc func heavyWork(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
) {
    DispatchQueue.global().async {
        // Heavy computation here
        let result = self.compute()
        resolve(result)
    }
}
```

### Android: Coroutines

```kotlin
class MyModule(reactContext: ReactApplicationContext) :
    NativeMyModuleSpec(reactContext) {
    
    private val moduleScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    
    override fun heavyWork(promise: Promise?) {
        moduleScope.launch {
            // Heavy computation here
            val result = compute()
            promise?.resolve(result)
        }
    }
    
    override fun invalidate() {
        super.invalidate()
        moduleScope.cancel()  // Important: cancel to prevent leaks
    }
}
```

## Thread Safety Checklist

| Scenario | Safe? | Solution |
|----------|-------|----------|
| Sync method accessing shared state | ⚠️ | Use locks/synchronized |
| Async method accessing UI | ❌ | Dispatch to main thread |
| Multiple async calls to same resource | ⚠️ | Queue or mutex |
| Accessing JS from background | ❌ | Use CallInvoker |

### Accessing UI from Background (iOS)

```swift
DispatchQueue.global().async {
    let result = self.heavyComputation()
    
    DispatchQueue.main.async {
        // Safe to update UI here
        self.updateUI(with: result)
    }
}
```

### Accessing UI from Background (Android)

```kotlin
moduleScope.launch(Dispatchers.Default) {
    val result = heavyComputation()
    
    withContext(Dispatchers.Main) {
        // Safe to update UI here
        updateUI(result)
    }
}
```

## Summary Table

| Action | iOS Thread | Android Thread |
|--------|------------|----------------|
| Module init | Main | JS (lazy) / Native (eager) |
| Sync method | JS | JS |
| Async method | Native modules | Native modules |
| View init | Main | Main |
| Prop update | Main | Main |
| Yoga layout | JS | JS |
| Invalidate | Native modules | ReactHost pool |

## Related Skills

- [native-turbo-modules.md](./native-turbo-modules.md) - Implement background threads
- [native-profiling.md](./native-profiling.md) - Debug thread issues
