---
title: Profile Native Code
impact: MEDIUM
tags: xcode, instruments, android-studio, profiler
---

# Skill: Profile Native Code

Use Xcode Instruments and Android Studio Profiler to identify native performance bottlenecks.

## Quick Command

```bash
# iOS: Open Instruments
# Xcode → Open Developer Tool → Instruments → Time Profiler

# Android: Open Profiler
# Android Studio → View → Tool Windows → Profiler
```

## When to Use

- App is slow but JS profiler shows no issues
- Investigating native module performance
- Startup feels slow (native init)
- Battery drain concerns
- Need CPU/memory breakdown by thread

> **Note**: This skill involves interpreting visual profiler output (Xcode Instruments, Android Studio Profiler). AI agents cannot yet process screenshots autonomously. Use this as a guide while reviewing the profiler UI manually, or await MCP-based visual feedback integration (see roadmap).

## iOS Profiling with Xcode

### Quick Check: Debug Navigator

1. Run app via Xcode
2. Open Debug Navigator (side panel)
3. View real-time: CPU, Memory, Disk, Network

**CPU percentage can exceed 100%** (multi-core usage).

### Deep Profiling: Instruments

1. Open: **Xcode → Open Developer Tool → Instruments**
2. Select **Time Profiler**
3. Choose target device and app
4. Click record (red circle)
5. Perform actions in app
6. Stop recording

### Analyzing Time Profiler Results

**Key views:**
- **Flame Graph**: Visual call stack over time
- **Call Tree**: Hierarchical function breakdown
- **Ranked**: Functions sorted by time (Bottom-Up)

**Useful filters:**
- Hide System Libraries
- Invert Call Tree (bottom-up view)
- Filter by thread (main, JS, etc.)

**Identifying problems:**
- **Microhang**: Brief UI unresponsiveness
- **Hang**: Full UI thread block (critical)
- Yellow = most time spent

### Thread Breakdown

Pin threads to compare:
- **Main thread** (SampleApp): UI rendering
- **JavaScript thread**: React/JS execution
- **Background threads**: Native modules

**Pro tip**: JS thread blocking ≠ UI block (React Native design benefit).

## Android Profiling with Android Studio

### Launch Profiler

1. **View → Tool Windows → Profiler**
2. Or: Click "Profile" in toolbar

### CPU Profiling

1. Select **"Find CPU Hotspots"**
2. Click **"Start profiler task"**
3. Interact with app
4. Stop to analyze

### Analyzing Results

**Flame Graph:**
- Zoom with scroll/pinch
- Click to expand call stacks
- Filter by keyword (e.g., "hermes")

**Views:**
- **Top Down**: From entry points down
- **Bottom Up**: From slowest functions up
- **Flame Chart**: Timeline visualization

### Reading the Call Stack

Example analysis:
```
JS Thread activity after button press:
- Event handler on main thread
- Triggers JS work via sync JSI calls
- Hermes processes React reconciliation
- ~30% time in "commit" phase (Yoga layout)
```

## Code Example: What to Look For

### 5000 Views in ScrollView (Bad)

Profiler shows:
- 240ms+ JS thread work
- Many 1ms Hermes spikes
- Exceeds 16.6ms frame budget
- Result: Dropped frames, UI jank

### Using FlatList (Better)

Profiler shows:
- Minimal JS work (windowed rendering)
- Smooth main thread
- Stays within frame budget

## Platform Tools Summary

| Tool | Platform | Use Case |
|------|----------|----------|
| Time Profiler | iOS | CPU hotspots |
| Leaks | iOS | Memory leaks |
| Hangs | iOS | UI thread blocks |
| CPU Profiler | Android | CPU hotspots |
| Memory Profiler | Android | Memory tracking |
| Perfetto | Android | Advanced trace analysis |

## Perfetto (Advanced Android)

Export traces from Android Studio and analyze at [ui.perfetto.dev](https://ui.perfetto.dev/):

- Cross-process analysis
- Custom trace events
- Additional visualizations

## Pro Tips

1. **Profile on low-end devices**: Issues appear more clearly
2. **Use release builds**: Debug builds have overhead
3. **Compare before/after**: Export traces for comparison
4. **Filter by thread**: Focus on relevant work
5. **Look for patterns**: Spikes correlating with interactions

## Expo Notes

- **Expo Go**: Cannot profile native code directly; JS profiling only
- **Dev Client / Prebuild**: Full native profiling supported via Xcode/Android Studio
- Run `npx expo prebuild` to generate native projects, then profile as bare React Native

## Common Findings

| Symptom | Likely Cause |
|---------|--------------|
| Main thread hangs | Heavy UI work, blocked operations |
| JS thread spikes | React re-renders, heavy computation |
| Background thread busy | Native module work |
| Memory climbing | Leak (see memory profiling skills) |

## Related Skills

- [native-measure-tti.md](./native-measure-tti.md) - Profile startup specifically
- [native-memory-leaks.md](./native-memory-leaks.md) - Memory profiling
- [js-profile-react.md](./js-profile-react.md) - JS/React profiling
