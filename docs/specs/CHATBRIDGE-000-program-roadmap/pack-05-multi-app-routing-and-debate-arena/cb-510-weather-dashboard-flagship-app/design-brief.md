# CB-510 Design Brief

## Metadata

- Story ID: CB-510
- Story Title: Weather Dashboard flagship app
- Author: Codex
- Date: 2026-04-02

## Audience / Entry Context

- Primary audience:
  a Chatbox user who asks for weather in plain language and expects a quick,
  glanceable answer without leaving the thread
- What brings them to this surface now:
  they asked for current conditions or a short forecast and the reviewed router
  selected Weather Dashboard instead of plain chat
- What they likely know before landing:
  the location they asked about and the fact that this should still feel like a
  normal chat turn, not a separate website
- What they need to decide or do next:
  confirm the place, scan current conditions, inspect the next few days, and
  optionally refresh if the host warns that the data is stale or upstream is
  degraded

## Desired Feeling

- Primary feeling to create:
  calm, quick, and trustworthy
- Secondary feelings to support:
  lightly atmospheric, host-owned, and easy to recover when upstream data is
  missing
- Feelings to avoid:
  enterprise analytics console, glossy travel app, or flat text-only fallback
- Why this emotional posture fits the story:
  weather is inherently glance-driven, and the host needs to show useful
  structured data without making the reviewed app feel heavier than the chat
  turn that launched it

## Design Language Translation

- Cue 1:
  a compact sky-card hero with current conditions and place identity above the
  fold
- Cue 2:
  short forecast tiles that scan left-to-right without looking like a dense
  spreadsheet
- Cue 3:
  host-owned status chips and banners that clearly distinguish fresh, cached,
  and degraded data
- Cue 4:
  restrained weather atmosphere through gradient, temperature contrast, and
  iconography, not photorealistic backgrounds
- Cue 5:
  refresh controls that read like utility chrome, not gamified CTA buttons
- Optional cue 6:
  a summary rail that previews what later chat continuity will remember
- Optional cue 7:
  visible timestamping so users understand whether the host is showing fresh or
  fallback data
- Anti-cues to avoid:
  giant map surfaces, travel-booking chrome, dense hourly tables, invisible
  stale-state handling, and generic “card dashboard” repetition

## System Direction

- Neutral role:
  Chatbox paper and slate neutrals for shell, copy, and card framing
- Primary role:
  bright sky blue for healthy/fresh weather state and refresh affordances
- Secondary role:
  warm sun amber for forecast highs, cache age, and attention without panic
- Accent role:
  storm coral for degraded or unavailable upstream status
- Typography posture:
  editorial weather bulletin, with one large numeric read and compact supporting
  stats
- Component or surface character:
  rounded reviewed-app shell, stacked summary cards, small forecast pills, and
  one crisp utility action row

## Layout Metaphor

- Physical-object or editorial analogy:
  a pinned desk weather bulletin with a current-condition poster on top and a
  compact strip of upcoming days underneath
- Why this metaphor fits:
  it makes the current condition the fastest read while leaving enough room for
  forecast, stale-state recovery, and host continuity notes inside the chat
  shell
- Variation axis 1:
  how poster-like versus dashboard-like the top section feels
- Variation axis 2:
  whether the forecast reads as a ribbon, strip, or stacked mini cards
- Variation axis 3:
  how prominently stale/degraded host status is promoted relative to the main
  weather content

## Copy Direction

- Copy change status: materially changing
- Voice and tone:
  direct, plain, and host-owned, with atmospheric labels only where they help
  scanability
- Naming posture:
  keep `Weather Dashboard` as the app name, but use short labels like `Now`,
  `Next 4 days`, `Host status`, and `Refresh`
- CTA posture:
  one clear utility action, `Refresh weather`
- Real draft copy required before design-grade review: yes
- If no, why:
  n/a

## Constraints / No-Go Decisions

- Scope constraints:
  current conditions plus a short forecast only; no maps, radar, account state,
  or long-range analytics
- Content constraints:
  do not surface raw provider payloads, geocoding internals, or low-signal
  meteorological jargon
- Accessibility constraints:
  loading, refreshed, cached, and degraded states need programmatic status
  messaging and keyboard-reachable refresh controls
- Implementation constraints:
  the data boundary stays host-owned in the main process; the renderer runtime
  can only consume the normalized contract
- Explicit no-go decisions:
  do not make Weather look like a separate consumer app brand, do not bury
  degraded state behind tiny helper text, and do not rely on color alone to
  distinguish fresh versus cached data

## Design Prompt Inputs

- Prompt phrase 1:
  calm in-thread weather bulletin
- Prompt phrase 2:
  host-owned freshness and degraded banners
- Prompt phrase 3:
  current-condition poster plus compact forecast strip
- Prompt phrase 4:
  editorial temperature hierarchy with restrained atmosphere
- Prompt phrase 5:
  later-chat continuity summary inside the reviewed app shell
