# Modifications in this fork

This repository is a **modified version** of [chatboxai/chatbox](https://github.com/chatboxai/chatbox)
("Chatbox"). Upstream Chatbox is licensed under the **GNU General Public License v3.0**
(`GPL-3.0`); see [`LICENSE`](./LICENSE) in this repository, which is kept unchanged.

Per GPL-3.0 §5, this file records who changed what and when, so that anyone receiving a binary
built from this repository can find the corresponding source (this repository) and see the
modifications.

## Provenance

| Field | Value |
| --- | --- |
| Upstream project | `https://github.com/chatboxai/chatbox` |
| Upstream commit this fork is based on | `446bcf4` (`test: match DeepSeek defaults to the open client`) |
| Fork | `https://github.com/vmware001/chatbox` |
| Branch with these changes | `deepseek-kimi-glm-search` |
| Changes made | 2026-11-19 |
| License | GPL-3.0 (unchanged, see `LICENSE`) |

## What was changed

By default, Chatbox's built-in web search can only use the paid Chatbox AI service, Bing
scraping, Tavily, BoCha, Querit or SearXNG. This fork adds **native search providers that use
a model vendor's own official web-search API together with your own API key**, plus a
**fallback provider** used when the selected provider fails.

### 1. DeepSeek search provider (native)

- `POST https://api.deepseek.com/v1/tools/search` (`query`, `count`) → `results[].{title,url,summary|snippet}`
- `POST https://api.deepseek.com/v1/tools/fetch` (`url`) → `{title, content}` (used for "read web page")
- Reuses the API key configured for the **DeepSeek** model provider.
- Files: `src/shared/services/native-web-search.ts`, `src/renderer/packages/web-search/{deepseek,constants,index,configuration-issue}.ts`

### 2. Kimi (Moonshot) search provider (native)

- `POST {host}/v1/tools/search` (`text_query`, `limit`, `timeout_seconds`) → `search_results[].{title,url,snippet|content}`
- `POST {host}/v1/tools/fetch` (`url`) → `{title, markdown}` (used for "read web page")
- `host` is `https://api.moonshot.ai` (international) or `https://api.moonshot.cn` (China); the
  key is taken from the Moonshot / Moonshot CN model provider, whichever is configured.
- Files: `src/renderer/packages/web-search/kimi.ts`, `src/renderer/components/settings/KimiProviderKeyRow.tsx`, plus the shared files below.

### 3. GLM (Zhipu / BigModel) search provider (native)

- `POST https://open.bigmodel.cn/api/paas/v4/web_search`:
  `search_query` (≤70 chars), `search_engine: search_std`, `search_intent: false`,
  `count` (1–50), `content_size: medium` → `search_result[].{title,content,link,...}`
- Reuses the API key configured for the **GLM** model provider (`chatglm-6b`), falling back to
  the GLM Coding Plan key when that one is set instead.
- GLM exposes no standalone URL-fetch endpoint, so this provider supports search only
  ("read web page" stays unavailable for it).
- Files: `src/renderer/packages/web-search/glm.ts`, `src/renderer/components/settings/GlmProviderKeyRow.tsx`.

### 4. Search fallback provider

- New setting `extension.webSearch.fallbackProvider` (default `deepseek`, `none` disables it):
  when the selected provider throws (missing key, network error, rate limit, API error) the same
  query is retried with the fallback provider; if the fallback also fails, the **original** error
  is reported.
- Switching the primary provider to the same value as the fallback clears the fallback to `none`.
- The readiness check ("web search is not configured") is relaxed when a usable fallback exists.
- Console: `[web-search] provider "<primary>" failed, retrying with fallback "<fallback>"`.
- Files: `src/renderer/packages/web-search/index.ts`, `src/renderer/packages/web-search/configuration-issue.ts`,
  `src/renderer/routes/settings/web-search.tsx`, `packages/chatbox-core/src/domain/settings/{settings-schema,settings-defaults}.ts`.

### 5. Shared changes

- `src/shared/models/errors.ts` + `errors.test.ts`: new codes `kimi_api_key_required` (20053) and
  `glm_api_key_required` (20054), and `deepseek_api_key_required` (20048).
- `src/renderer/components/common/ChatboxAIErrorMessage.tsx`: buttons that deep-link to the
  matching model-provider settings.
- `packages/chatbox-i18n/src/locales/{en,zh-Hans}/translation.json`: strings for the new rows and errors.
- `capacitor.config.ts`: Capacitor configuration used to wrap the renderer as an Android app
  (`appId com.chatbox.open`, `webDir release/app/dist/renderer`, `server.androidScheme https`).
  The generated `android/` project is **not** committed — see below.

### 6. Python execution on mobile (Pyodide / WebAssembly)

Upstream `code_execution` only runs JavaScript in a QuickJS sandbox on mobile, and its own
contract text states that Python is unavailable. This fork adds CPython via
[Pyodide](https://pyodide.org/) so the Android app can run Python locally, without a desktop
companion.

- `code_execution` accepts `language: "javascript" | "python"` (default `javascript`); the tool
  description gains a Python environment/example section.
- Runtime: `src/renderer/packages/mobile-work-mode/python-service.ts` lazily loads Pyodide from
  the bundled assets (`/pyodide/`, served from the app bundle), keeps a single instance, and for
  every run: resets `/home/pyodide/work`, copies the session workspace into it, executes the
  snippet, then reads that directory back and commits the files through the same workspace port
  the JavaScript sandbox uses (`input/` read-only, outputs under `output/`).
- Wiring: `PythonExecutionPort` + optional constructor argument in
  `src/shared/mobile-work/LocalWorkMode.ts`, provided by
  `src/renderer/packages/mobile-work-mode/runtime.ts`; contract strings in
  `src/shared/mobile-work/execution-contract.ts`.
- Bundled runtime: `src/renderer/public/pyodide/` — `pyodide.mjs`, `pyodide.asm.js`,
  `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json` (11.7 MB, Pyodide 0.29.5,
  CPython 3.13). Added as a dev dependency in `package.json` / `pnpm-lock.yaml`.
- Bundled scientific stack (offline): `loadPackage(['numpy', 'pandas', 'matplotlib'])` is called
  once after the runtime loads, and the matching wheels live in the same directory, so Pyodide
  resolves them from `indexURL` without any network access:

  | wheel | version |
  | --- | --- |
  | numpy | 2.2.5 |
  | pandas | 2.3.3 |
  | matplotlib | 3.8.4 |
  | scipy | 1.14.1 |
  | pillow / contourpy / cycler / fonttools / kiwisolver / packaging / pyparsing / python-dateutil / pytz / tzdata / six | 11.3.0 / 1.3.1 / 0.12.1 / 4.56.0 / 1.4.8 / 26.2 / 3.2.1 / 2.9.0.post0 / 2025.2 / 2025.3 / 1.17.0 |

  They are the unmodified `cp313`/`pyemscripten_2025_0_wasm32` wheels published for Pyodide
  0.29.5 (downloaded from `https://cdn.jsdelivr.net/pyodide/v0.29.5/full/`, 32.4 MB total), and
  each keeps its own `*.dist-info` license metadata.
  Matplotlib must run headless: the tool description tells the model to call
  `matplotlib.use('Agg')` before importing `pyplot` and to save with `fig.savefig('output/x.png')`,
  because `pyplot.show()` is meaningless on mobile.
- Limits: standard library plus the table above, `micropip` (0.11.1, also bundled) for pure-Python
  packages **when the device has network access** (`import micropip; await micropip.install('httpx')`),
  no shell or Node API, 60 s deadline, 64 KiB output cap, and it is available in **work mode** only,
  because `code_execution` is a work-mode tool. Python runs on the main renderer thread, so a long run
  blocks the UI. Packages with compiled C extensions cannot be installed at runtime; bundle their
  Pyodide wheels instead (that is what the table above does).
  Pyodide itself is **MPL-2.0**; the bundled files and their licenses are distributed unchanged.

### 7. HEIC/HEIF image input (libheif WebAssembly)

Chromium — and therefore the Android WebView — cannot decode HEIC/HEIF with `<img>`, so an iPhone
photo used to fail with "Failed to decode image" even though the picker listed `.heic` files. This
fork decodes HEIC locally with [libheif-js](https://github.com/nokiatech/libheif) before the image is
downscaled and sent to the model; nothing is uploaded and no native plugin is involved.

- `src/renderer/packages/heic-image.ts` (new): `isHeicImage()` (MIME type or `.heic`/`.heif`
  extension), `hasHeicMagicBytes()` (ISO-BMFF `ftyp` brands: `heic`, `heix`, `hevc`, `hevx`, `heim`,
  `heis`, `hevm`, `hevs`, `mif1`, `mif2`, `msf1`, `avif`, `avis`), and `decodeHeicToImageData()`
  (primary image → RGBA, 60 MP guard, throws on corrupt input).
- `src/renderer/packages/pic_utils.ts`: new `encodeImageDataToBase64()` and exported
  `isHeicImage()`; `getImageBase64AndResize()` decodes HEIC through libheif instead of `<img>`.
- `src/renderer/components/InputBox/InputBox.tsx`: images are detected by MIME type **or** HEIC
  extension, because Android often reports `.heic` as `application/octet-stream`.
- `src/renderer/packages/model-calls/toolsets/view-image.ts`: `.heic`/`.heif` in
  `IMAGE_MEDIA_TYPES`, HEIC magic-byte sniffing, HEIC skips the byte-level dimension pre-check
  (libheif reports the size while decoding), tool description updated.
- `src/shared/tools/view-image.ts`: `.heic`/`.heif` added to `READ_FILE_IMAGE_EXTENSIONS`.
- `src/renderer/packages/libheif-js.d.ts` (new): minimal ambient types for the untyped package.
- Dependency: `libheif-js@^1.23.5` (**LGPL-3.0**, compatible with this GPL-3.0 project), used through
  its self-contained classic build (wasm inlined) and loaded lazily, so the 3 MB chunk is only
  fetched when a HEIC file is actually opened.
- Mobile builds no longer emit renderer sourcemaps or the bundle report
  (`electron.vite.config.ts`), which removes ~10 MB of dead weight from the APK.

### 8. Python workspace write-back fix

`python-service.ts` used to send **every** file in the sandbox back to the workspace, including the
read-only `input/` attachments, so `CapacitorWorkspace.commit()` rejected the whole run with
"Input and delivered files are read-only". `collectFiles()` now skips `input/` and `artifacts/` and
only reports files that were created or changed, matching the JavaScript sandbox
(`WorkerFiles.serialize()`).

### 9. Automatic cleanup of old work-mode workspaces

Every code/Python run leaves files under the app-private `files/workspaces/<session>/` directory
(`output/chart.png`, exported CSVs, `input/` attachments). Deleting a conversation does not remove
them, so long-lived installs accumulate tens or hundreds of megabytes of stale data.

- `src/renderer/packages/mobile-work-mode/workspace-cleanup.ts` (new): `listWorkspaceUsage()` walks
  each session directory and reports size/files; a workspace's "last used" time is the **newest
  mtime of the directory and every file inside it** (a directory's own mtime does not change when a
  nested file is overwritten). `cleanupStaleWorkspaces({ retentionDays })` removes the directories
  older than the window and returns `{ scanned, removed, freedBytes, failed }`;
  `autoCleanupWorkspaces()` runs it at most once per day.
- Startup: `src/renderer/index.tsx` runs the cleanup in the background on mobile, after settings are
  hydrated, and never blocks or breaks startup.
- Settings: `workspaceCleanup: { enabled?, retentionDays? }` in the core settings schema
  (defaults: enabled, 30 days) and a **Settings → Data & Backup → Workspaces** section
  (`src/renderer/components/settings/WorkspaceCleanupSection.tsx`) showing current usage, a manual
  "Clean now" button, the auto-cleanup switch and the retention select (7/14/30/60/90 days).
  Conversations themselves are never deleted — only the per-conversation workspace files.

Upstream files that were touched (nothing else): the ones listed above, plus
`src/renderer/packages/web-search/{constants.test.ts,parse-link-consistency.test.ts,configuration-issue.test.ts}`.

## Building the Android APK from this repository

```bash
# Node 22.x (repo engines: >=22.13 <23) and pnpm 10.33.0
corepack enable
pnpm install

export CHATBOX_BUILD_TARGET=mobile_app
export CHATBOX_BUILD_PLATFORM=android
export CHATBOX_ELECTRON_VITE_TARGET=renderer
export NODE_ENV=production
pnpm exec electron-vite build          # -> release/app/dist/renderer

pnpm exec cap add android              # generates ./android (git-ignored)
pnpm exec cap sync android
cd android && ./gradlew assembleDebug  # -> app/build/outputs/apk/debug/app-debug.apk
```

Gradle needs JDK 21 and an Android SDK with `platforms;android-35` + `build-tools;35.0.0`.
On Windows, `android/local.properties` must contain `sdk.dir=...` (git-ignored).

## Using the new providers

1. Settings → Model Providers → paste your own API key into **DeepSeek**, **Moonshot**
   (or Moonshot CN) and/or **GLM**.
2. Settings → Capabilities → Web Search → choose the **Search Provider**
   (DeepSeek / Kimi / GLM) and optionally a **Fallback** provider.
3. In a chat, open the agent panel (robot icon) and enable **Web Search**.

## Using Python in the Android app

1. Open a chat and switch the agent panel to **Work mode** (工作模式) — `code_execution` is a
   work-mode tool.
2. Ask for a Python task, or let the model pick `language: "python"`; the first run loads the
   WebAssembly runtime from the app bundle and pre-loads numpy, pandas and matplotlib (a few
   seconds on a modern phone, then it is cached for the session).
3. Files follow the same workspace rules as the JavaScript sandbox: read from `input/`, write to
   `output/`, then download with `create_download`.
4. Charts: ask for `output/chart.png`; the bundled matplotlib runs headless (`Agg`) and the PNG
   appears in the chat as an artifact you can download.

Example prompt that works out of the box:

> Use python with numpy, pandas and matplotlib: compute the mean and std of 1000 random numbers,
> print them, then save a line plot to output/chart.png.

Extra pure-Python packages (network required):

```python
import micropip
await micropip.install('httpx')   # pure Python only; compiled packages must be bundled instead
import httpx
```

## Using HEIC photos in the Android app

- Attach a `.heic`/`.heif` photo like any other image (the attach menu → 添加图片, or 选择文件).
  It is decoded on device with libheif, downscaled, and sent to the model as a normal image —
  providers that cannot read HEIC never see one.
- `view_image` and `read_file` also accept `.heic`/`.heif` paths inside a work-mode workspace.

## Privacy / secrets

- **No API keys, tokens, cookies or credentials are stored in this repository.** The keys live in
  the app's local settings (on-device) and are entered by the user.
- Keys are read at runtime from the model-provider settings; nothing is hard-coded.
- `android/`, `local.properties`, APKs/AABs, keystores and `node_modules` are git-ignored, so no
  local paths, signing material or build artifacts are published.

## License

This fork is distributed under **GPL-3.0**, the same license as upstream. If you distribute a
binary built from this repository you must:

1. ship/publish this repository (or the exact source you built) — this repo is that source;
2. keep the `LICENSE` file and upstream copyright notices intact;
3. keep this `MODIFICATIONS.md` so recipients can see what changed (§5 "state changes").

Chatbox, its name and its logo remain the property of their respective owners; this fork is not
affiliated with or endorsed by Chatbox.
