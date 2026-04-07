---
title: Android 16 KB Page Size Alignment
impact: CRITICAL
tags: android, native, 16kb, alignment, page-size, google-play, third-party
---

# Android 16 KB page size alignment

---

## Quick Reference

| Item                   | Details                                              |
| ---------------------- | ---------------------------------------------------- |
| Google Play deadline   | November 1, 2025 for apps targeting Android 15+      |
| React Native support   | Built-in since React Native 0.79                     |
| What to check          | Third-party native libraries (`.so` files)           |
| Official documentation | [developer.android.com/guide/practices/page-sizes][] |

[developer.android.com/guide/practices/page-sizes]: https://developer.android.com/guide/practices/page-sizes

---

## Quick Command

Verify APK alignment using Android's official `zipalign` tool:

```bash
zipalign -c -P 16 -v 4 app-release.apk
```

If any 64-bit libraries (`arm64-v8a`, `x86_64`) show misalignment, they need updating.

For deeper ELF-level inspection, use Android's [check_elf_alignment.sh][] script.

[check_elf_alignment.sh]: https://cs.android.com/android/platform/superproject/main/+/main:system/extras/tools/check_elf_alignment.sh

---

## When to Check

React Native 0.79+ builds core binaries with correct alignment. However, **third-party
native libraries** may still be misaligned. Check alignment when:

* Adding or updating SDKs with native code
* Preparing a release for Google Play
* Investigating crashes on Android 15+ devices with 16 KB page size

---

## CI Integration

Add alignment check to your release pipeline to catch issues before submission, example:

```bash
zipalign -c -P 16 -v 4 app-release.apk 2>&1 | tee alignment.log
if grep -q "Verification FAILED" alignment.log; then exit 1; fi
```

## Step-by-Step

1. Build your release APK or AAB
2. Run `zipalign` verification (see Quick Command)
3. If misaligned libraries are found, trace them to source packages (see below)
4. Update, replace, or remove the affected dependencies

For runtime testing, use the [16KB Android Emulator image][] or enable
"Boot with 16KB page size" on Pixel 8/8a/9 devices.

[16KB Android Emulator image]: https://developer.android.com/guide/practices/page-sizes#set-up-the-android-emulator-with-a-16-kb-based-system-image

---

## Tracing Misaligned Libraries

When `zipalign` reports a misaligned library like `libfoo.so`, find its source package:

```bash
# Find the .so file in node_modules
find node_modules -name "libfoo.so" 2>/dev/null

# Or search gradle files for references
grep -r "foo" node_modules/*/android --include="*.gradle" 2>/dev/null
```

Once identified, update the dependency or contact the vendor for a 16KB-compatible build.

---

## Common Pitfalls

* Waiting for Play Store rejection instead of checking in CI
* Assuming a React Native upgrade rebuilds third-party native binaries
* Only checking 32-bit ABIs (`armeabi-v7a`, `x86`) — these are not affected
* Using `zipalign` without the `-P 16` flag (checks 4 KB, not 16 KB)
* Validating only debug builds

---

## Fixing Alignment Issues

Alignment issues require **rebuilding** the native library with a compatible toolchain.
Repackaging alone does not fix them.

See [official remediation steps][] for detailed guidance.

[official remediation steps]: https://developer.android.com/guide/practices/page-sizes#build-app-16kb

---

## Related Skills

* [native-profiling.md](./native-profiling.md) — Native debugging tools
