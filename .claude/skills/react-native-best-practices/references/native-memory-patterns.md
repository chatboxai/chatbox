---
title: Native Memory Management
impact: MEDIUM
tags: memory, c++, swift, kotlin, arc, smart-pointers
---

# Skill: Native Memory Management

Understand memory management patterns in C++, Swift, and Kotlin for React Native native modules.

## Quick Reference

| Pattern | Languages | Mechanism |
|---------|-----------|-----------|
| Reference Counting | Swift, Obj-C, C++ (smart ptrs) | Count refs, free at zero |
| Garbage Collection | Kotlin/Java, JavaScript | GC scans and frees unreachable |
| Manual | C, C++ (raw pointers) | Explicit new/delete |

**Key rule**: Use `std::unique_ptr`/`std::shared_ptr` in C++, `weak` for delegates in Swift.

## When to Use

- Writing native modules with manual memory management
- Debugging native memory leaks
- Interfacing C++ with Swift/Kotlin
- Understanding reference counting vs garbage collection

## Memory Management Patterns

| Pattern | Languages | Mechanism |
|---------|-----------|-----------|
| Reference Counting | Swift, Obj-C, C++ (smart pointers) | Count refs, free at zero |
| Garbage Collection | Kotlin/Java, JavaScript | GC scans and frees unreachable |
| Manual | C, C++ (raw pointers) | Explicit new/delete |

## C++ Smart Pointers

### `std::unique_ptr` - Single Owner

```cpp
#include <memory>

void takeOwnership(std::unique_ptr<std::string> s) {
    std::cout << *s;
    // Automatically deleted when function ends
}

int main() {
    auto str = std::make_unique<std::string>("Hello");
    
    // Can only be moved, not copied
    takeOwnership(std::move(str));
    // str is now empty
    
    return 0;
}
```

### `std::shared_ptr` - Multiple Owners

```cpp
void useShared(std::shared_ptr<std::string> s) {
    std::cout << *s;  // Reference count temporarily +1
}

void useReference(const std::shared_ptr<std::string>& s) {
    std::cout << *s;  // No ref count change (passed by reference)
}

int main() {
    auto str = std::make_shared<std::string>("Hello");
    
    useShared(str);      // Copies pointer, ref count +1
    useReference(str);   // No copy, ref count unchanged
    
    std::cout << *str;   // Still valid
    return 0;
}
```

### `std::weak_ptr` - Non-Owning Reference

```cpp
void useWeak(std::weak_ptr<std::string> weak) {
    if (auto shared = weak.lock()) {  // Check if still exists
        std::cout << *shared;
    } else {
        std::cout << "Object destroyed";
    }
}

int main() {
    auto str = std::make_shared<std::string>("Hello");
    std::weak_ptr<std::string> weak = str;  // No ref count increase
    
    useWeak(weak);  // Works
    str.reset();    // Destroys object
    useWeak(weak);  // "Object destroyed"
    
    return 0;
}
```

## Swift ARC (Automatic Reference Counting)

```swift
class Person {
    let name: String
    init(name: String) { self.name = name }
    deinit { print("Deallocated") }
}

do {
    let person1 = Person(name: "John")  // Ref count: 1
    
    do {
        let person2 = person1  // Ref count: 2
    }  // person2 out of scope, ref count: 1
    
}  // person1 out of scope, ref count: 0, "Deallocated"
```

### Breaking Reference Cycles with `weak`

```swift
// BAD: Reference cycle (memory leak)
class A {
    var b: B?
}
class B {
    var a: A?  // Strong reference creates cycle
}

// GOOD: Use weak to break cycle
class A {
    var b: B?
}
class B {
    weak var a: A?  // Weak reference, doesn't prevent deallocation
}
```

## Kotlin/Android GC

### WeakHashMap for Caches

```kotlin
val weakMap = WeakHashMap<String, String>()

run {
    weakMap[String("temp")] = "value"
    println(weakMap.size)  // 1
}

System.gc()  // Force garbage collection
Thread.sleep(100)

println(weakMap.size)  // 0 (key was collected)
```

### WeakReference for Callbacks

```kotlin
class DataManager {
    // Weak references to listeners prevent memory leaks
    private val listeners = mutableListOf<WeakReference<DataListener>>()
    
    fun addListener(listener: DataListener) {
        listeners.add(WeakReference(listener))
    }
    
    fun notifyListeners(data: String) {
        listeners.forEach { ref ->
            ref.get()?.onDataChanged(data)
        }
    }
}
```

## Common Memory Leak Sources

### 1. Forgetting to Delete (C++)

```cpp
// BAD: Memory leak
int main() {
    std::string* str = new std::string("Hello");
    // Forgot to delete!
    return 0;
}

// GOOD: Use smart pointers or stack allocation
int main() {
    auto str = std::make_unique<std::string>("Hello");
    // Automatically deleted
    return 0;
}
```

### 2. Reference Cycles (Swift/C++)

```cpp
// BAD: Cycle
class A { std::shared_ptr<B> b; };
class B { std::shared_ptr<A> a; };

// GOOD: Break with weak_ptr
class A { std::shared_ptr<B> b; };
class B { std::weak_ptr<A> a; };
```

### 3. Unremoved Listeners (Kotlin)

```kotlin
// BAD: Listener never removed
class MyClass {
    private val listener = object : Callback {
        override fun onEvent() { /* ... */ }
    }
    
    init {
        EventManager.addListener(listener)
        // Never removed!
    }
}

// GOOD: Implement cleanup
class MyClass : AutoCloseable {
    private val listener = object : Callback {
        override fun onEvent() { /* ... */ }
    }
    
    init {
        EventManager.addListener(listener)
    }
    
    override fun close() {
        EventManager.removeListener(listener)
    }
}
```

## Swift `Unmanaged` (Advanced)

For C interop, manually manage reference counts:

```swift
let obj = MyObject()                        // Ref count: 1

// Increment manually
let unmanaged = Unmanaged.passRetained(obj) // Ref count: 2

// Decrement and get object
let retrieved = unmanaged.takeRetainedValue() // Ref count: 1

// Get raw pointer for C
let pointer = unmanaged.toOpaque()
```

**Rule**: Match `passRetained` with `takeRetainedValue`, `passUnretained` with `takeUnretainedValue`.

## Best Practices Summary

| Language | Best Practice |
|----------|---------------|
| C++ | Use smart pointers (`shared_ptr`, `unique_ptr`) |
| Swift | Use `weak` for delegates, breaking cycles |
| Kotlin | Implement `AutoCloseable`, use `WeakReference` |
| All | Prefer stack over heap when possible |

## Related Skills

- [native-memory-leaks.md](./native-memory-leaks.md) - Find leaks with profilers
- [native-turbo-modules.md](./native-turbo-modules.md) - Build memory-safe modules
