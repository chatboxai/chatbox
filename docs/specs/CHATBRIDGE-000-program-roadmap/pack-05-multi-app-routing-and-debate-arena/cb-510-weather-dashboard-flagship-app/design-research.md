# CB-510 Design Research

## Repo Findings

### Reviewed runtime shell

- [`ReviewedAppLaunchSurface.tsx`](/private/tmp/chatbox-cb-510/src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.tsx)
  already owns the reviewed launch lifecycle, LangSmith launch trace, and
  session persistence hooks.
- [`reviewed-app-launch.ts`](/private/tmp/chatbox-cb-510/src/renderer/packages/chatbridge/reviewed-app-launch.ts)
  promotes host-approved `summaryForModel`, `statusText`, and `snapshot`
  updates into later-turn continuity. Weather should reuse this seam instead of
  inventing a second memory path.

### Existing flagship exemplar

- [`drawing-kit.ts`](/private/tmp/chatbox-cb-510/src/shared/chatbridge/apps/drawing-kit.ts)
  proves the repo already accepts a dedicated reviewed-app snapshot contract
  rather than forcing everything through a generic shell.
- [`reviewed-app-runtime.ts`](/private/tmp/chatbox-cb-510/src/renderer/packages/chatbridge/bridge/reviewed-app-runtime.ts)
  shows the current runtime layer tolerates bold, story-specific surface design
  when the contract remains host-owned.

### Manual smoke and seed lab

- [`chatbridgeManualSmoke.ts`](/private/tmp/chatbox-cb-510/src/renderer/dev/chatbridgeManualSmoke.ts)
  and [`ChatBridgeSeedLab.tsx`](/private/tmp/chatbox-cb-510/src/renderer/components/dev/ChatBridgeSeedLab.tsx)
  expect fixtures to state clear smoke support, trace IDs, and explicit
  pass/fail handling.
- Weather needs a supported active-flagship fixture, not a legacy reference,
  and its trace labels should remain queryable in the same `chatbox-chatbridge`
  project.

### Catalog and route posture

- [`reviewed-app-catalog.ts`](/private/tmp/chatbox-cb-510/src/shared/chatbridge/reviewed-app-catalog.ts)
  already makes Weather Dashboard part of the active flagship trio.
- [`routing.ts`](/private/tmp/chatbox-cb-510/src/shared/chatbridge/routing.ts)
  already selects Weather for explicit forecast-style prompts, so CB-510 should
  not reopen router language unless runtime needs expose a gap.

## External Findings

### Open-Meteo geocoding

- Official docs: [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api)
- The search endpoint accepts `name`, returns `latitude`, `longitude`,
  `timezone`, `country`, and admin labels, and documents that the stable
  required input is the search term plus optional filters.
- This supports a host-owned normalization layer where the renderer only sees a
  resolved place label and normalized coordinates never need to become UI truth.

### Open-Meteo forecast fields

- Official docs: [Open-Meteo Forecast API](https://open-meteo.com/en/docs)
- The forecast docs list compact current and daily fields suitable for an
  inline dashboard, including `temperature_2m`, `apparent_temperature`,
  `weather_code`, `wind_speed_10m`, `temperature_2m_max`,
  `temperature_2m_min`, and `precipitation_probability_max`.
- That field set is sufficient for a short reviewed dashboard without creating
  an hourly-data wall or a provider-specific renderer contract.

### Accessibility status handling

- Official guidance: [W3C Understanding Success Criterion 4.1.3: Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- W3C calls out `role="status"` for success or state updates and `role="alert"`
  for warning/error states where the user should be informed without a focus
  jump.
- The Weather runtime should use polite status messaging for refresh success and
  cache freshness, and alert semantics only for degraded or unavailable states.

## Directional Implications

- The surface should optimize for the first 3 seconds of reading:
  place, now, next few days, freshness, and recovery path.
- A compact poster-plus-strip composition fits the existing reviewed-app shell
  better than a data table or a travel-app card stack.
- Freshness and degraded state must be visible near the top of the shell, not
  buried below forecast content.
- The follow-up continuity summary should feel like host utility text, not
  provider prose.
