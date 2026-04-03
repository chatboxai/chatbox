# CB-510 Design Decision

## Inputs Used

- [`design-brief.md`](/private/tmp/chatbox-cb-510/docs/specs/CHATBRIDGE-000-program-roadmap/pack-05-multi-app-routing-and-debate-arena/cb-510-weather-dashboard-flagship-app/design-brief.md)
- [`design-research.md`](/private/tmp/chatbox-cb-510/docs/specs/CHATBRIDGE-000-program-roadmap/pack-05-multi-app-routing-and-debate-arena/cb-510-weather-dashboard-flagship-app/design-research.md)
- [`feature-spec.md`](/private/tmp/chatbox-cb-510/docs/specs/CHATBRIDGE-000-program-roadmap/pack-05-multi-app-routing-and-debate-arena/cb-510-weather-dashboard-flagship-app/feature-spec.md)
- [`technical-plan.md`](/private/tmp/chatbox-cb-510/docs/specs/CHATBRIDGE-000-program-roadmap/pack-05-multi-app-routing-and-debate-arena/cb-510-weather-dashboard-flagship-app/technical-plan.md)
- Existing runtime exemplars:
  [`ReviewedAppLaunchSurface.tsx`](/private/tmp/chatbox-cb-510/src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.tsx)
  and [`drawing-kit.ts`](/private/tmp/chatbox-cb-510/src/shared/chatbridge/apps/drawing-kit.ts)

## Options Considered

### Option A: Sky Poster

- Thesis:
  one large current-condition card on top, a compact 4-day forecast strip
  below, and host freshness/degraded banners directly under the headline
- Component posture:
  large temperature read, location line, one refresh action, short stat row,
  and a small host continuity card
- Strengths:
  fastest glance path, clearest stale/degraded placement, easy mobile collapse
- Risks:
  could feel too “hero card” if the forecast strip is undersized

### Option B: Transit Stack

- Thesis:
  stack current conditions, host status, and each forecast day as equal cards in
  a vertical list
- Component posture:
  denser operational dashboard with repeated card anatomy
- Strengths:
  easy implementation, strong degraded-state insertion point
- Risks:
  slower to scan, visually generic, and too close to ordinary settings cards

### Option C: Window Seat

- Thesis:
  split layout with current conditions left, forecast right, and continuity
  summary as a footer rail
- Component posture:
  more panoramic, more “mini app”
- Strengths:
  spacious desktop presentation, room for more detail
- Risks:
  weaker small-width collapse, more likely to feel like a separate product
  shell instead of a chat-native reviewed surface

## Scoring Rubric

| Criterion | Weight | A | B | C |
|---|---:|---:|---:|---:|
| Task clarity and system status | 5 | 5 | 4 | 4 |
| Match to user language and user goals | 5 | 5 | 3 | 4 |
| Control, recovery, and error prevention | 5 | 5 | 5 | 4 |
| Consistency with existing Chatbox patterns | 4 | 4 | 4 | 3 |
| Information hierarchy and restraint | 5 | 5 | 3 | 4 |
| Accessibility and responsive feasibility | 4 | 4 | 4 | 3 |
| Implementation fit and testability | 4 | 4 | 5 | 3 |
| Weighted total |  | 124 | 102 | 96 |

## Critique / Refinement Loop

- Initial concern with Option A:
  it risked becoming too decorative if the atmospheric styling overshadowed the
  host-owned status layer.
- Refinement applied:
  keep the sky treatment subtle, promote freshness/degraded state into a
  dedicated host banner, and add a continuity card that explicitly states what
  later chat will remember.
- Result:
  Option A kept the best glance behavior while becoming more obviously
  host-governed and easier to validate.

## Chosen Direction

- Winner:
  Option A, `Sky Poster`
- Why it won:
  it gives Weather the clearest first-read hierarchy for the thread surface:
  place, current condition, short forecast, freshness, and recovery. It also
  leaves a clean slot for the host continuity summary without turning the shell
  into a generic stack of cards.

## Discarded Options

- Option B lost because:
  it over-flattened the hierarchy and made Weather look like a repeated admin
  list rather than a flagship reviewed app.
- Option C lost because:
  it pushed the shell toward a mini standalone app layout that is harder to
  keep compact and chat-native on smaller widths.

## Copy Fidelity Status

- Status:
  draft copy is specific enough to implement directly
- Required labels:
  `Weather Dashboard`, `Refresh weather`, `Host status`, `Next 4 days`,
  `Saved for follow-up chat`
- Required degraded language posture:
  plain host-owned explanations such as `Showing the last good snapshot while
  upstream weather data is unavailable.`

## Implementation Implications

- Components:
  add a dedicated Weather reviewed-app surface rather than stretching the
  generic reviewed iframe card
- States:
  loading, ready, cache-hit, manual refresh, degraded with stale snapshot, and
  unavailable-without-location all need explicit UI states
- Tokens:
  reuse existing Chatbox neutrals, add restrained sky/amber/coral accents
  inside the Weather surface only
- Tests:
  cover the poster headline, forecast strip, refresh action, stale/degraded
  banner behavior, and host continuity summary updates
