# Chatbox 开源版 → Android APK（DeepSeek API + 联网搜索）

产物：
- `chatbox-kimi-fallback-debug.apk`（63.7 MB，含 Kimi 搜索提供方 + 搜索失败自动回退，**最新**）
- `chatbox-deepseek-arm64-x86_64-debug.apk`（56.2 MB，仅 DeepSeek 搜索）

包名 `com.chatbox.open`，可与官方版 `xyz.chatboxapp.chatbox` 共存。
源码：https://github.com/chatboxai/chatbox （GPL-3.0，community edition）

## 1. 本地构建

前置：Node 22（仓库 `engines` 锁 `>=22.13.0 <23.0.0`，Node 26 会被 engine-strict 拒绝）、pnpm 10.33（`packageManager` 固定）、JDK 21、Android SDK platform 35 + build-tools 35。

Node 22 现在统一放在 `<node-home>\v22.23.5`（原 `ds_chat\tools\node-v22.23.5-win-x64` 已清空，只留一个 README 指向新位置）：

```powershell
# 注意顺序：global 在前 -> pnpm 走 corepack shim，按 package.json 精确取 10.33.0
#            v22 目录在后 -> node.exe 取 22.23.5（而不是系统那个 26.x）
$env:PATH = '<node-home>\global;<node-home>\v22.23.5;' + $env:PATH
node -v    # v22.23.5
pnpm -v    # 10.33.0
```

```powershell
# 依赖
pnpm install

# 渲染层：必须以 mobile_app + android 目标编译，否则会走桌面/Web 平台实现
$env:CHATBOX_BUILD_TARGET='mobile_app'
$env:CHATBOX_BUILD_PLATFORM='android'
$env:CHATBOX_ELECTRON_VITE_TARGET='renderer'
$env:NODE_ENV='production'
pnpm exec electron-vite build          # 产物 release/app/dist/renderer

# Capacitor 外壳（capacitor.config.ts 已放在仓库根，webDir 指向上面产物）
pnpm exec cap add android
pnpm exec cap sync android             # 13 个插件：sqlite/filesystem/haptics/stream-http...

# 打包
cd android
$env:JAVA_HOME='<jdk21>'; $env:ANDROID_HOME='<android-sdk>'
.\gradlew.bat assembleDebug            # 产物 app/build/outputs/apk/debug/app-debug.apk
```

坑位记录：

- `android/gradle/wrapper/gradle-wrapper.properties` 默认从 services.gradle.org 拉 `gradle-8.11.1-all`（约 200 MB，国内极慢），已改为 `https://mirrors.cloud.tencent.com/gradle/gradle-8.10.2-bin.zip`。
- AGP 8.7.2 默认要 build-tools 34.0.0，本机只有 35.0.0，Gradle 会自动补装。
- 本仓库是 Capacitor 移动端同一套代码，`CHATBOX_BUILD_TARGET=mobile_app` 决定 `platform/index.ts` 选 `MobilePlatform`（Capacitor SQLite 等），漏掉这个变量会白屏或存储异常。

## 2. 让联网搜索用你自己的 DeepSeek key

**根因**：搜索提供方默认是 `Chatbox AI`（付费服务，未登录时消息里只留一句「Web Search was skipped because Chatbox AI requires sign-in」），所以看起来"搜索不可用"。

设置路径（App 内）：

1. 设置 → 模型提供方 → **DeepSeek** → 填 API 密钥（可点"检查"跑连通性测试，文本/图片/工具调用三项全绿）。
2. 设置 → 能力 → **联网搜索** → 搜索提供方 从 `Chatbox AI` 改成 **DeepSeek**（复用第 1 步的 key，不需要额外 key）。
3. 任意会话 → 输入框左侧机器人图标（Agent 模式面板）→ 打开 **联网搜索** 开关（状态会被记住）。

⚠️ 模型选择器里有两个同名项，别选错：

- `Chatbox AI` 分组（62 个模型）里的 "**DeepSeek V4.1 Flash**" → 走 Chatbox AI 中转，未登录直接报「请登录」，请求 ID 形如 `53622a6d…`。
- `更多提供商 · 自带 API KEY` → `DeepSeek` 分组里的 "**DeepSeek Flash**" / "DeepSeek V4 Pro" → 走你的 key，直连 `api.deepseek.com`。

## 3. 实测结果（MuMu 12 / Android 15 x86_64）

- 问句 "What is the weather in Shanghai today?"，模型 `DeepSeek Flash`
- 步骤链：深度思考 ✓ → 联网搜索 **2 次**（含中文 query 改写）→ 作答，耗时 13.9s
- 用量：4497 input tokens / 1152 cached；答案给出阴、6–12°C、西北风 2 级、湿度 43%、AQI 23、日出 06:24 / 日落 16:54
- 结论：客户端搜索走 `POST https://api.deepseek.com/v1/tools/search`，阅读网页走 `/v1/tools/fetch`，均用 DeepSeek key 直接鉴权，不经过 Chatbox 服务器。

## 4. 成本与合规

- 客户端直连的 Search / Fetch 按请求计费：$0.75 / 1000 次（成功且有结果才计费）。
- 若改用服务端工具（`deepseek_web_search`，Anthropic Messages / Responses / Chat Completions 协议），搜索本身不计费，只算 token。
- debug 签名，仅供自用；如需上架或长期分发，需自行配置 release 签名。

## 5. 新增：Kimi 搜索提供方 + 搜索失败自动回退

### Kimi 搜索提供方

- 复用 `Moonshot`（国际，`api.moonshot.ai`）/ `Moonshot CN`（国内，`api.moonshot.cn`）模型提供方的 API key：设置 → 模型提供方 → Moonshot 填 key，搜索侧无需再填。
- 搜索：`POST {host}/v1/tools/search`，body `{ text_query, limit, timeout_seconds: 30 }`，取 `search_results[].{title,url,snippet}`（无 snippet 时截断 `content` 前 300 字）。
- 阅读网页：`POST {host}/v1/tools/fetch`，body `{ url }`，取 `markdown`（回退 `content`）。
- 计费按请求次数，失败或空结果不计费。

### 搜索失败自动回退（Fallback）

设置 → 能力 → 联网搜索 → **备用** 区块，选一个备用提供方（默认 `DeepSeek`，可选 `None` 关闭）。

- 触发条件：主提供方的 `search()` 抛错——缺 key、网络错误、限流、接口报错。
- 行为：先记住原始错误 → 用备用提供方重试 → 成功则正常作答（结果标注 `fallbackFrom`），仍失败才把**原始**错误抛给模型。
- 切换主提供方时，如果备用提供方与新主提供方相同，会自动把备用清成 `None`（避免留下一个永远不生效的同值配置）。
- 控制台会打印 `[web-search] provider "kimi" failed, retrying with fallback "deepseek"`（`adb logcat | Select-String 'web-search'` 可见）。
- 就绪判定同步放宽：主提供方没配 key 但备用可用时，不再拦截联网搜索开关。

真机验证（MuMu，主提供方 = Kimi 且未填 Moonshot key，备用 = DeepSeek）：提问 "What is the weather in Shanghai today?" → 1.2s 内回退，联网搜索 2 次，正常给出上海天气（`deepseek-flash · 4741 tokens`），logcat 里能抓到 `[web-search] provider "kimi" failed, retrying with fallback "deepseek" Error: kimi_api_key_required`。

改动文件：`src/shared/services/native-web-search.ts`、`src/renderer/packages/web-search/{kimi,index,constants,configuration-issue}.ts`、`src/renderer/routes/settings/web-search.tsx`、`src/renderer/components/settings/KimiProviderKeyRow.tsx`、`src/renderer/components/common/ChatboxAIErrorMessage.tsx`、`src/shared/models/errors.ts`、`packages/chatbox-core/src/domain/settings/{settings-schema,settings-defaults}.ts`、`packages/chatbox-i18n/src/locales/{en,zh-Hans}/translation.json`。

## 6. Node 运行时统一（避免多份重复占用）

本机原有 4 份 Node，现统一到 `<node-home>\`，原路径全部改为 junction，脚本和 IDE 配置无需改动：

| 位置 | 用途 | 状态 |
| --- | --- | --- |
| `<system-node>`（v26.7.0，110 MB，MSI） | 系统 PATH 里的默认 node | 保留原地（MSI 安装，卸载器依赖） |
| `<node-home>\v24.14.0` | 原 `<node-home>\node-v24.14.0-win-x64` | 已迁移，原路径 junction |
| `<node-home>\global` | 原 `<node-home>\global`（npm 全局包，`pnpm` 就在这里） | 已迁移，原路径 junction |
| `<node-home>\v22.23.5` | 原 `<workdir>\tools\node-v22.23.5-win-x64`（本仓库构建用） | 已迁移；`ds_chat\tools\node-v22.23.5-win-x64` 现在是**空目录 + README**（指向新位置），`node-v22.23.5-win-x64.zip` 已删除 |

> code 目录里其余项目（clash_verge / cloud-mail / Kimi_Agent_3DCube / 数字信号处理 …）只有各自的 `node_modules`，没有自带 Node 运行时，直接复用系统 node 即可；全盘扫描 `<code-dir>` 已无 `node.exe`。

- junction 用 `cmd /c mklink /J <原路径> <新路径>` 重建，`node -v` / `pnpm -v` / 构建链均验证可用。
- pnpm store 本来就在 `<pnpm-store>`，无需处理。
- 未迁移：`<other-tool>\binaries\node\versions`（287 MB，属其它工具，迁移时其 3 个进程正在运行，强行移动会破坏该工具）。
- 遗留：`<node-home>\global_leftover_locked`（10.7 MB），迁移时 `agent-browser-win32-x64.exe` 被别的会话占用导致无法删除，改名保留；等占用释放后可删。

## 7. 各家模型厂商的「官方搜索能力」对照

原则：**只有厂商自己提供了独立的搜索 REST 接口，才像 DeepSeek 那样做成搜索提供方**；只能挂在对话请求里的「服务端联网工具」不算（那要求把搜索塞进 chat 请求，形态完全不同）。

| 厂商 | 独立搜索接口 | 端点 / 关键参数 | 鉴权（key 复用） | 阅读网页 | 是否接入 |
| --- | --- | --- | --- | --- | --- |
| DeepSeek | ✅ | `POST https://api.deepseek.com/v1/tools/search`（`query`/`count`）；`POST /v1/tools/fetch`（`url`→`content`） | 复用 DeepSeek 模型 key | ✅ | **已接入**（`deepseek`） |
| Kimi / Moonshot | ✅ | `POST {host}/v1/tools/search`（`text_query`/`limit`/`include_content`/`timeout_seconds`）、`/v1/tools/search_pro`（`sites`≤5、`time_window`、返回 `chunks[]`）、`POST {host}/v1/tools/fetch`（`url`→`markdown`）；`host` = `api.moonshot.ai` 或 `api.moonshot.cn` | 复用 Moonshot 模型 key | ✅ | **已接入**（`kimi`） |
| 智谱 GLM / BigModel | ✅ | `POST https://open.bigmodel.cn/api/paas/v4/web_search`：`search_query`≤70、`search_engine`=`search_std`/`search_pro`/`search_pro_sogou`/`search_pro_quark`、`search_intent`、`count` 1–50、`content_size`=`medium`/`high`、`search_domain_filter`、`search_recency_filter`；响应 `search_result[].{title,content,link,media,icon,refer,publish_date}` | 复用 GLM 模型 key（`chatglm-6b`），无则回退 GLM Coding Plan 的 key | ❌（`web_fetch` 只在托管 Agent 工具里，没有独立 REST） | **已接入**（`glm`，不含「阅读网页」） |
| 阿里云百炼 Qwen / DashScope | ❌ | 只有对话内 `enable_search` / `search_options`、或 MCP 版 `WebSearch` 服务 | — | — | 未接入（无独立搜索 REST） |
| MiniMax | ❌ | 只有对话内服务端 `web_search` 工具 | — | — | 未接入 |
| 硅基流动 SiliconFlow | ❌ | 无自有搜索，纯转发各模型 | — | — | 未接入 |
| 火山方舟 豆包 / 百度文心 / 腾讯混元 | ❌ | 均为对话内「联网搜索」服务端工具，无独立搜索 REST（豆包/文心/混元走各自 bot/plugin 通道） | — | — | 未接入 |
| 非模型厂商（Chatbox 原有） | ✅ | Bing（抓 HTML）、Tavily、BoCha、Querit、SearXNG、Chatbox AI（付费） | 各自 key / 站点 URL | Bing ✗，Tavily/Chatbox ✅ | 原有 |

### GLM 搜索提供方的实现要点（与 DeepSeek/Kimi 同一套做法）

- 搜索：`searchNativeGlm()` in `src/shared/services/native-web-search.ts`——`search_query` 按 70 字截断、`count` 夹在 1–50、`content_size: 'medium'`、`search_intent: false`、`search_engine: 'search_std'`；结果取 `title` + `link` + 截断到 300 字的 `content`。
- key：`resolveNativeGlmApiKey()` 先取 `providers[ModelProviderEnum.GLM]`（`chatglm-6b`），空则回退 `providers[ModelProviderEnum.ZhipuGLMCodingPlan]`。
- 没有独立 URL fetch → `src/renderer/packages/web-search/glm.ts` 只实现 `search()`，`supportsParseLink` 保持 `false`，`PROVIDERS_WITH_PARSE_LINK` 不含 `glm`，所以设置里「阅读网页」显示 ✗。
- 新错误码 `glm_api_key_required` = **20054**（`src/shared/models/errors.ts` + `errors.test.ts` 映射），提示里带 `<OpenGLMProviderSettingButton>`，点击跳到 `/settings/provider/chatglm-6b`。
- 设置页新增 `GlmProviderKeyRow`（`src/renderer/components/settings/GlmProviderKeyRow.tsx`），只展示状态 + 跳转，key 仍在模型提供方里填。
- 加一个厂商要做的事（照抄 GLM 即可）：① `native-web-search.ts` 的联合类型/选项/`resolve*ApiKey`/就绪判定/分发 + 一个 `searchNativeXxx`；② `web-search/xxx.ts` 一个类（有 fetch 才写 `parseLink`）；③ `constants.ts` + `configuration-issue.ts` + `index.ts` 的 case；④ `errors.ts` 新码 + `errors.test.ts`；⑤ `settings-schema.ts` 两处 enum（`provider` 与 `fallbackProvider`）；⑥ 设置页的 key 行 + i18n 两条语言文件。

本版 APK：`<repo>-glm-search-debug.apk`，66,668,565 bytes，sha256 `F51E440EDA87DBA87B1780D9F28EB5DB8319E537104D220F86DC63EE17AAD76C`（单测 10 文件 / 105 例全绿；真机 MuMu 上搜索提供方下拉已出现 9 项，GLM 位于 Kimi 与 Tavily 之间，选中后显示「GLM API 密钥 / 请先在 GLM 模型提供方设置中填写…」+「GLM 提供方设置」按钮，工具行为 联网搜索 ✓ / 阅读网页 ✗）。

真机还顺带复现了另一种回退组合（主 Kimi 无 key → 备用 Bing）：logcat 打印 `[web-search] provider "kimi" failed, retrying with fallback "bing"`，随后 bing 返回结果并正常作答。

## 8. 在手机上跑 Python（Pyodide / WASM）

- 为什么这么做：Android 版 Chatbox 的 `code_execution` 只跑 QuickJS（JavaScript/WASM），契约文本明写 Python 不可用；手机上也没有可插件的 Python 进程。可选方案里 Chaquopy（原生 CPython）要改 Gradle 与 ABI、APK 增大且构建复杂；"不改 APK、只连本机 MCP" 又和"只要手机版"矛盾——所以选 **Pyodide**：纯 WASM 的 CPython，跟着 APK 走，不依赖电脑。
- 资产：`pnpm add -D pyodide@0.29.5`（`pyodide` 的 `latest` 是 314.0.8，但仓库 `minimumReleaseAge` 拒绝安装新发布的版本，所以用 dist-tag `stable-0.29`）。把 `pyodide.mjs` / `pyodide.asm.js` / `pyodide.asm.wasm` / `python_stdlib.zip` / `pyodide-lock.json` 放到 `src/renderer/public/pyodide/`，**11.72 MB**；vite 会把它拷进 `release/app/dist/renderer/pyodide/`，Capacitor 以 `https://localhost/pyodide/...` 提供。APK 因此从 63.7 MB 变成 65.9 MB（66,668,565 → 69,055,266 bytes）。
- 运行时：`src/renderer/packages/mobile-work-mode/python-service.ts` 导出 `capacitorPython`，懒加载 `loadPyodide({ indexURL: '/pyodide/' })` 并缓存；每次执行前清空 `/home/pyodide/work`、把工作区文件写进去，执行后把该目录里的文件读回并交给 `workspace.commit()`——与 JS 沙箱共用同一套文件契约（`input/` 只读、产物写 `output/`）。stdout/stderr 用 `setStdout/setStderr({ batched })` 收集，60 秒超时、64 KiB 输出上限。
- 工具接线：`code_execution` 的 inputSchema 新增 `language: 'javascript' | 'python'`（默认 javascript），`LocalWorkMode` 构造函数新增可选 `pythonExecution?: PythonExecutionPort`，由 `src/renderer/packages/mobile-work-mode/runtime.ts` 传入 `capacitorPython`；描述里追加 `PYTHON_ENVIRONMENT` / `PYTHON_EXAMPLE`（`src/shared/mobile-work/execution-contract.ts`）。
- 限制：只有 Python **标准库** + 下节内置的科学计算包（其它第三方包没打进去，`pip`/`micropip` 需要联网，未启用），无网络、无 shell、无 Node API；Python 在主渲染进程跑（Pyodide 不能放进 work-mode 的 `allow-scripts` 离屏 iframe，那是 opaque origin，取不到应用资源）；只在**工作模式**下可用（`code_execution` 是工作模式工具）。
- 真机实测（MuMu 12 / Android 15）：工作模式下问「Use python to print the python version and the sum of 1..100」→ 3.0s 返回 `Python version: 3.13.2`、`Sum of 1..100: 5050`；再问「write output/hello.txt then read it back」→ 2.2s 返回文件内容与 58 字符长度，文件确实写进工作区。logcat 里能看到 `Loading Pyodide runtime from https://localhost/pyodide/` 与随后对 `pyodide.mjs` / `python_stdlib.zip` / `pyodide.asm.wasm` 的本地请求。

### 8.1 内置科学计算包：numpy / pandas / matplotlib

- 做法：Pyodide 的 `pyodide-lock.json` 列了 379 个包，但 npm 包里只有运行时、没有这些 wheel。把所需 wheel 从 `https://cdn.jsdelivr.net/pyodide/v0.29.5/full/` 下到同一个 `src/renderer/public/pyodide/` 目录，`loadPyodide({ indexURL })` 之后 `loadPackage(['numpy','pandas','matplotlib'])` 就会从这个目录取（依赖链写在 lockfile 的 `depends` 里，会自动带上），**全程不出网**。
- 打包的 wheel（共 14 个，**16.76 MB**）：`numpy-2.2.5`、`pandas-2.3.3`、`matplotlib-3.8.4`、`pillow-11.3.0`、`contourpy-1.3.1`、`cycler-0.12.1`、`fonttools-4.56.0`、`kiwisolver-1.4.8`、`packaging-26.2`、`pyparsing-3.2.1`、`python_dateutil-2.9.0.post0`、`pytz-2025.2`、`tzdata-2025.3`、`six-1.17.0`（都是 cp313/pyemscripten_2025_0_wasm32 或 pure-python 版本）。`scipy-1.14.1` 在 lockfile 里但没打包（约 30 MB 量级），需要时同样方式加一行即可。
- 代码：`python-service.ts` 里 `const BUNDLED_PACKAGES = ['numpy','pandas','matplotlib']`，`loadRuntime()` 首次加载运行时后调用 `preloadBundledPackages()`（`runtime.loadPackage(...)`，失败只记 warn，标准库仍可用）；`execution-contract.ts` 的 `PYTHON_ENVIRONMENT` / `PYTHON_EXAMPLE` 已改为说明内置 numpy/pandas/matplotlib、matplotlib 必须 `matplotlib.use('Agg')` 后再 import pyplot、用 `fig.savefig('output/chart.png', dpi=150)` 落盘（`pyplot.show()` 在手机上无效）。
- 体积：`dist/renderer/pyodide/` 从 11.72 MB 变成 **28.48 MB**，APK 从 69.06 MB 变成 **81.03 MB**（wheel 本身是 zip，压缩余量很小；`chatbox-python-libs-debug.apk`）。
- 真机实测（MuMu 12 / Android 15，工作模式）：一次提问「Use python with numpy pandas and matplotlib: compute mean and std of 1000 random numbers, print them, then save a line plot to output/chart.png」→ 13.9s 完成，mean `0.00027693693240745174`、std `0.994410018954286`，`output/chart.png` 165.8 KB 出现在"产物"卡片里；把文件从设备 `files/workspaces/<id>/output/chart.png` 拉出来验证是合法 PNG（魔数 `89 50 4E 47`，1200×675，坐标轴/标题/刻度都正确渲染）。
- 许可：Pyodide 是 MPL-2.0，numpy/pandas 等是 BSD 系（numpy BSD-3、pandas BSD-3、matplotlib PSF-based、pillow HPND、fonttools MIT、kiwisolver BSD、packaging Apache-2.0/BSD、pyparsing MIT、python-dateutil Apache-2.0/BSD、pytz MIT、six MIT、tzdata Apache-2.0），wheel 里自带的 `*.dist-info` 元数据随包分发，见 `MODIFICATIONS.md`。

本版 APK：`<repo>-python-libs-debug.apk`，84,968,231 bytes（81.03 MB），sha256 `EA5DF29DF31B297EF3E96CED9CF381592DB18A3979357916EC99379F0E19F1CE`；上一版无第三方库的为 `chatbox-python-debug.apk`（69,055,266 bytes，sha256 `F9100D37B8436E50FE116BC5ACF056A8107D0708F270662643B6DADB9D83D471`）。

## 9. HEIC 图片输入 + `micropip`（运行时 pip）+ APK 瘦身

- 问题：Android WebView 的 `<img>` 解不了 HEIC/HEIF，`getImageBase64AndResize` 会走 `img.onerror` 直接失败——所以以前从相册选 `.heic` 会报"Failed to decode image"（代码里只有扩展名/MIME 映射，没有任何解码器）。
- 做法：`pnpm add libheif-js`（**1.23.5，LGPL-3.0**，与 GPL-3.0 应用兼容）。用它的 **classic 构建**（`libheif/libheif.js`，3.19 MB，wasm 已内联，`HeifDecoder` 是同步 API），通过 `import('libheif-js')` **按需加载**，所以只在真正遇到 HEIC 时才拉那个 3 MB 的 chunk。
- 代码接线（6 处）：
  1. 新文件 `src/renderer/packages/heic-image.ts`：`isHeicImage({ type, name })`（MIME / 扩展名）、`hasHeicMagicBytes(bytes)`（ISO-BMFF `ftyp` + HEIC/AVIF brand）、`decodeHeicToImageData(bytes)`（解码主图 → RGBA `ImageData`，60 MP 上限，失败抛错）。
  2. `src/renderer/packages/pic_utils.ts`：新增 `encodeImageDataToBase64()`（像素 → 缩放 → dataURL，复用 `calculateImageResizeSize`）与 `isHeicImage()` 导出；`getImageBase64AndResize()` 开头先判 HEIC，命中就走 libheif 解码而不是 `<img>`。
  3. `src/renderer/components/InputBox/InputBox.tsx`（`~1337`）：图片分支条件从 `file.type.startsWith('image/')` 改为 `file.type.startsWith('image/') || picUtils.isHeicImage(file)`——Android 上 `.heic` 常常报 `application/octet-stream`，只按 MIME 判断会漏。
  4. `src/renderer/packages/model-calls/toolsets/view-image.ts`：`IMAGE_MEDIA_TYPES` 加 `.heic`/`.heif`；魔术字节识别 HEIC（`hasHeicMagicBytes`）；HEIC 跳过 `readRasterImageBounds` 预检（没有对应的字节级解析器，尺寸由 libheif 解码时给出）；工具描述/报错文案加 heic。
  5. `src/shared/tools/view-image.ts`：`READ_FILE_IMAGE_EXTENSIONS` 加 `.heic`/`.heif`（`read_file` 也能把 HEIC 当图片回传）。
  6. `src/renderer/packages/libheif-js.d.ts`：该包没有类型声明，补了最小 ambient 声明。
- 顺手修的 bug：`python-service.ts` 之前把沙箱里**所有**文件都回写工作区，包括只读的 `input/`，`CapacitorWorkspace.commit()` 会直接抛 "Input and delivered files are read-only"——只要工作区里有附件，`language: "python"` 就必然失败。现在 `collectFiles()` 跳过 `input/` 与 `artifacts/`，且只回写"新增或内容有变化"的文件（先记录 seed 的 base64 做对比），与 JS 沙箱的 `WorkerFiles.serialize()`（只回写 changed）对齐。
- `micropip`：把 `micropip-0.11.1-py3-none-any.whl`（115 KB，lockfile 里就是 0.11.1）也放进 `src/renderer/public/pyodide/`，`BUNDLED_PACKAGES` 变成 `['numpy','pandas','matplotlib','micropip']`；`PYTHON_ENVIRONMENT` 说明"有网时可用 `import micropip; await micropip.install('httpx')` 装纯 Python 包，带 C 扩展的包装不了、只能像 numpy 那样预先打进去"。
- APK 瘦身：mobile 构建（`CHATBOX_BUILD_TARGET=mobile_app`）不再产出 sourcemap 与 `stats.html`（`electron.vite.config.ts`：`sourcemap: isMobile ? false : ...`，visualizer 在 mobile 下不挂）。这两项本来在 APK 里占 ~10 MB 压缩体积，纯浪费。**净效果：加了 3 MB 的 libheif + 0.1 MB micropip，APK 反而从 81.03 MB 降到 80.24 MB。**
- 真机实测（MuMu 12 / Android 15，工作模式）：
  - 把 `sample.heic`（用 `pillow-heif` 造的 1200×675 HEIF，58,049 bytes）放进会话工作区的 `input/`，让模型 `view_image` 读它 → 模型准确描述出图表：X 轴 200–1000、Y 轴 "Value" −3..+3、~1000 个标准正态随机点、峰值在 ~530/~560/~870、谷值 ~900 ——说明 HEIC 被 libheif 解码成图后正常送进了视觉模型。
  - `run python to import micropip and print its version` → `micropip version: 0.11.1`（离线可导入；真装包需要联网）。
  - 带 `input/` 附件的会话里跑 Python 不再报只读错误（模型自己说 "Python is working again!"）。
- 测试：`src/renderer/packages/heic-image.test.ts` 9 例（MIME/扩展名/魔术字节、主图选择、空文件、无图、解码失败、超大尺寸）+ `pic_utils.test.ts` 既有 10 例全绿；`pnpm exec tsc --noEmit` 通过。
- 已知限制：DocumentsUI/图片选择器会把"MediaStore 里没有 `image/heic` 元数据"的 `.heic` 置灰（我用的合成样本就是这样，改 `content insert` 会 segfault），所以选图那条路没法用这种样本验证；真机 iPhone 拍的 HEIC 由系统正确登记 MIME，会走同一条解码路径。

本版 APK：`<repo>-heic-debug.apk`，84,141,722 bytes（**80.24 MB**），sha256 `2F56229DFF0B55DE59E30EE461A5B1EF564052BCD6D584CD03CA0BA954620CC2`。

## 10. 内置 scipy + 历史对话工作区自动清理

### 10.1 scipy 也打进 APK

- 追加 `scipy-1.14.1-cp313-cp313-pyemscripten_2025_0_wasm32.whl`（**15.67 MB**，只依赖 numpy，lockfile 里原本就有）到 `src/renderer/public/pyodide/`，`BUNDLED_PACKAGES` 变成 `['numpy','pandas','matplotlib','scipy','micropip']`。
- `PYTHON_ENVIRONMENT` 文案同步说明内置 scipy（`from scipy import stats`）。
- 体积：`dist/renderer/pyodide/` 28.48 → **44.26 MB**（16 个 wheel），APK 80.24 → **95.71 MB**（`chatbox-scipy-wscleanup-debug.apk`）。
- 真机实测（工作模式）：问「Use python with scipy: print the pdf of standard normal at 0 and a ttest pvalue for two samples」→ `stats.t_tests_ind` 返回 `t = -0.815880124380102`、`p = 0.4304663958523153`，并给出"p≈0.43 无显著差异"的结论，说明 scipy 加载正常。

### 10.2 工作区自动清理

会话每跑一次代码/Python，就会在应用私有目录留下 `files/workspaces/<hex(sessionId)>/{input,output,artifacts}`（Python 出图、pandas 导出的 CSV 都在里面）。这些文件不随对话删除而消失，长期会累积到几十上百 MB。

- 新增 `src/renderer/packages/mobile-work-mode/workspace-cleanup.ts`：
  - `listWorkspaceUsage()`：扫描 `workspaces/` 下每个会话目录，递归统计字节数/文件数；**最后使用时间取"目录与其下所有文件 mtime 的最大值"**（目录 mtime 在嵌套文件被覆盖时不会变，只看目录会误判为旧）。
  - `cleanupStaleWorkspaces({ retentionDays, now? })`：删除 mtime 早于窗口的目录（`Filesystem.rmdir ... recursive`），返回 `{ scanned, removed, freedBytes, failed }`；单个目录失败只记 warn，不影响其它目录。
  - `autoCleanupWorkspaces({ enabled, retentionDays })`：每天最多跑一次（localStorage 记 `chatbox:workspace-cleanup:last-run`），可在设置里关掉。
  - 辅助：`normalizeMtime()`（秒/毫秒都兼容）、`formatBytes()`、`isStaleWorkspace()`。
- 启动时后台执行：`src/renderer/index.tsx` 在 `await bootstrapRenderer(...)` 之后、`platform.type === 'mobile'` 时 `void autoCleanupWorkspaces(...)`（读完 `settingsStore.getState().workspaceCleanup`），失败只 `console.warn`，绝不阻塞启动。
- 设置项（`packages/chatbox-core/src/domain/settings/settings-schema.ts` + `settings-defaults.ts`）：`workspaceCleanup: { enabled?: boolean; retentionDays?: number }`，默认 `{ enabled: true, retentionDays: 30 }`。
- UI：`设置 → 数据与备份 → 工作区`（新组件 `src/renderer/components/settings/WorkspaceCleanupSection.tsx`，仅 mobile 显示）：
  - 「工作区存储：已用 5.8 MB，分布在 6 个会话工作区」+「立即清理」按钮；
  - 「自动清理旧工作区」开关；
  - 「工作区保留时长」下拉（7/14/30/60/90 天）；
  - 底部说明"仅作用于工作区，对话本身不会被删除"。
- 真机实测：手工造了一个 40 天前、5 MB 的假工作区（`touch -t 202501010000`）和一个新的，页面显示「已用 5.8 MB，分布在 6 个会话工作区」→ 点「立即清理」→ 变成「已用 863 KB，分布在 5 个会话工作区」，旧目录 `6f6c642d…` 在设备上确认已被删除，新目录保留。
- 测试：`workspace-cleanup.test.ts` 9 例（mtime 归一化、字节格式化、过期判定、嵌套统计与"新文件时间"、根目录不存在、只删过期、自动清理的每日节流）；`src/shared/mobile-work` + `src/renderer/packages/mobile-work-mode` + `web-search` + `chatbox-core/domain` 合计 **39 文件 / 261 例全绿**，`tsc --noEmit` 通过。

本版 APK：`<repo>-scipy-wscleanup-debug.apk`，100,357,894 bytes（**95.71 MB**）。
## 11. 开源化改造：去掉 Chatbox AI 托管模型与付费推广 + 内置 MCP + Kimi 预设 + 聊天模式 Python

这一版把「要联网付费才能用的东西」换成了「自带 key 也能用」的默认值，共四件事。

### 11.1 一个总开关：`src/shared/open-build.ts`

```ts
export const CHATBOX_AI_ENABLED = false
export const CHATBOX_AI_MCP_PROXY_ENABLED = false
```

`CHATBOX_AI_ENABLED = false` 会一次性关掉：

- `src/renderer/hooks/useChatboxAIModels.ts`：`useQuery({ enabled: CHATBOX_AI_ENABLED })`，`allChatboxAIModels` / `chatboxAIModelList` 一律返回空 —— 模型选择器不再出现 Chatbox AI 分组、62 个托管模型、`升级到 Pro` 锁定项。
- `src/renderer/routes/settings/route.tsx`：设置首页顶部那张「Chatbox AI / 未激活」卡片。
- `src/renderer/routes/settings/provider/route.tsx`：模型提供方列表里的 `chatbox-ai` 行（原先被提到最前面）。
- `src/renderer/routes/settings/web-search.tsx`：页脚的「您可以 try Chatbox AI for free now!」推广。

其余付费痕迹（ProTrialClaim、LowQuotaReminder、ChatboxAIQuotaHint、GenericMessageError 的试用文案）只在**已登录/已激活**时出现，没有 license 时天然不显示，所以没改。

### 11.2 内置 MCP：Fetch / Context7 换成公开端点，去掉订阅门禁

| id | 端点 | 授权 |
| --- | --- | --- |
| `fetch` | `https://mcp.jina.ai/sse` | 公开 |
| `context7` | `https://mcp.context7.com/mcp` | 公开 |
| `arxiv` | `https://mcp.chatboxai.app/arxiv` | 需要 Chatbox AI license |

- `packages/chatbox-core/src/mcp/builtin.ts`：`BuildinMCPServerConfig` 增 `protocolMode?: MCPProtocolMode`、`requiresLicense?: boolean`；`getBuiltinServerConfig()` 现在按每个 server 自己的 `protocolMode` 建链（原先一律 `legacy` GET-SSE），只有 `requiresLicense && licenseKey` 时才带 `x-chatbox-license` 头。
- `DEFAULT_ENABLED_BUILTIN_SERVERS = LICENSE_FREE_BUILTIN_SERVERS`，`settings-defaults.ts` 的 `mcp.enabledBuiltinServers` 默认 `['fetch','context7']`；`prepareRemoteMCPTools()` 在读到空数组时回退到 `DEFAULT_ENABLED_BUILTIN_SERVERS`（老配置没有这个字段时也能直接生效，这是修 MCP 工具不出现的关键一行）。
- `src/renderer/components/settings/mcp/BuiltinServersSection.tsx`：去掉 `useAutoValidate()` 的订阅门禁，改成 `accessible={!requiresLicense || !!licenseKey}`；arXiv 因此依然灰着，Fetch/Context7 可点。
- `src/renderer/stores/premiumActions.ts`：license 被移除/切换时只清非免费的内置服务器（`LICENSE_FREE_BUILTIN_SERVERS` 保留）。
- 真机结果：Context7 建链 `running`、模型实际调到了 `resolve-library-id` + `get-library-docs` 并拿到 react.dev 的真实文档片段；Fetch 在这台模拟器上 `MCP connection cancelled or timed out`（模拟器 DNS 把 `mcp.jina.ai` 投到 199.59.150.45 且不回包，宿主侧 curl 200），正常网络应可用。

### 11.3 Kimi 作为预设提供商

`src/renderer/components/settings/provider/providerIcons.tsx` 的 `FEATURED_PROVIDER_IDS` 里加上 `ModelProviderEnum.Moonshot` 与 `ModelProviderEnum.MoonshotCN`。Kimi 本来就是系统 provider（`api.moonshot.ai` / `api.moonshot.cn`，模型 `kimi-k3.1-pro` 等），只是排在被折叠的「更多提供商」里；加进 featured 之后，模型提供方列表直接显示 **Moonshot AI** / **Moonshot CN**。

### 11.4 聊天模式也能跑 Python

之前 `code_execution` 只存在于工作模式的 `LocalWorkMode.createTools()` 里。现在：

- 新增 `src/renderer/packages/mobile-work-mode/chat-python-tool.ts`：`buildChatPythonTools({ sessionId, workspace })` 返回一个只做 Python 的 `code_execution`（zod 参数只有 `code`，没有 `language`），内部走 `capacitorPython.execute()`，成功后把新文件 `workspace.commit()` 回工作区；配套 `CHAT_PYTHON_INSTRUCTIONS` 说明「已预装 numpy/pandas/matplotlib/scipy、没有网络、画图用 Agg 存 output/」。
- `src/renderer/stores/session/tools-builder.ts`：在 `includeAgentTools === false`（即对话模式）且 `platform.type === 'mobile'` 且模型支持 agent 工具时，动态 `import()` 上面两个模块并注册工具、追加 instructions（动态 import 是为了不把 wasm/企业版依赖拖进主包）。
- 真机结果：普通对话（非工作模式）问「Use python to print 2+2 and the python version」→ 10.5s 返回 `4` 与 `3.13.2`。

### 11.5 体积与产物

二进制没有变化（wasm 早就在包里），APK 仍 **95.71 MB**。

```powershell
# 构建（PATH 里 pnpm 必须走 global，否则会拉 pnpm 12 破坏 lockfile）
$env:PATH = '<node-home>\global;<node-home>\v22.23.5;' + $env:PATH
$env:CHATBOX_BUILD_TARGET='mobile_app'; $env:CHATBOX_BUILD_PLATFORM='android'
$env:CHATBOX_ELECTRON_VITE_TARGET='renderer'; $env:NODE_ENV='production'
cd <repo>
pnpm exec electron-vite build
pnpm exec cap sync android
cd android; .\gradlew.bat assembleDebug
```

本版 APK：`<repo>-open-build-debug.apk`，95.71 MB（`04B5CDA21E4AB2C1A3779D4F1888A90457C6AE267D3F70EAAC035D15560DCEFA`）。
## 12. 语言切换入口（设置首页）

原先切换语言只有两个入口：引导页右上角的「文A」，以及 `设置 → 应用 → 外观` 里的下拉——手机上两级菜单下去才算找得到，很多人根本不知道有这个东西。

这一版在**设置首页最上面**加了一行「语言」，右边直接显示当前语言（例如「简体中文」），点开是底部弹层「选择语言」，列出全部 15 种语言，当前项打勾：

```
设置
├─ 🔍 搜索设置
├─ 文A  语言            简体中文  ›     ← 新增
├─ 模型 → 模型提供方 / 默认模型
├─ 能力 → 联网搜索 / MCP / Skills / Agent 与记忆 / 文档解析器
└─ ...
```

- 新组件 `src/renderer/components/settings/LanguageSettingsCard.tsx`：一行 `LanguageSettingsCard`（`data-testid="settings-language-entry"`），弹层用现成的 `AdaptiveModal`（手机是 vaul 底部抽屉，桌面是 Mantine Modal），选项来自 `@/i18n/locales` 的 `languages` / `languageNameMap`（`en`/`zh-Hans`/`zh-Hant`/`ja`/`ko`/`ru`/`de`/`fr`/`pt-PT`/`es`/`ar`/`it-IT`/`sv`/`nb-NO`/`tr`），每项 `data-testid="settings-language-<code>"`。
- 选中后只写 `setSettings({ language })`，界面语言由既有的 `useI18nEffect()` 监听 settings.language 自动 `i18n.changeLanguage()`，无需额外同步；桌面端 `设置 → 外观` 里的下拉仍然保留。
- 真机验证：设置首页顶部出现「语言 简体中文」→ 点开「选择语言」列出全部语言（当前项打勾）→ 选 English，整个设置页立即变英文且行尾显示「English」→ 再切回简体中文，恢复原状。
## 13. MCP 抓取修复、本地 `fetch_url` 工具与 Kimi Code 提供方

### 13.1 内置 Fetch MCP 的两个问题
1. **协议**：`https://mcp.jina.ai` 要求请求头同时带 `Accept: application/json` 与 `text/event-stream`，只带 `application/json` 会得到 `406 Not Acceptable`。`packages/chatbox-core/src/mcp/platform.ts` 的 `createMCPFetch` 现在会自动补全 `text/event-stream`，并有 6 条单测覆盖。
2. **网络**：部分网络到 `mcp.jina.ai` 的 DNS 被污染（解析到 `31.13.95.38`，TCP 443 超时），而 `mcp.context7.com` 正常。因此 Fetch 在受限网络下会停在 `idle`。

### 13.2 新增本地工具 `fetch_url`（工作模式）
`src/renderer/packages/mobile-work-mode/fetch-tool.ts`：

- `createFetchUrlTool({ fetchImpl?, maxChars? })` 注册 `fetch_url({ url, max_chars? })`，走 `nativeFetch`（CapacitorHttp，绕过 WebView CORS），30s 超时 / 4 MB 上限 / 默认 20 000 字符截断。
- HTML 用 `htmlToReadableText()` 转纯文本（去掉 `head`/`title`/`script`/`style`/注释，块级标签转换行，解码常见实体），二进制（图片/音视频/字体/zip/pdf/wasm/octet-stream）直接拒绝。
- 返回 `{ url, status, content_type, title, text, truncated }`；在 `mobile-work-mode/runtime.ts` 里与 `web.tools` 一起并入 `createTools(...)`。
- 用途：不依赖搜索提供方/付费 MCP 的网页读取；用户站点 `https://cf.a0x7fff.site` 真机验证返回 `status 200`、标题 `My Server Dashboard` 与真实导航内容。

### 13.3 Kimi Code（`sk-kimi-`）与 Kimi 搜索
- `sk-kimi-` 前缀的 key 属于 **Kimi Code 订阅**，只认 `https://api.kimi.com/coding/v1`；Moonshot 开放平台域名会 401。新增系统提供方 **Kimi Code**（`src/shared/providers/definitions/kimi-code.ts`，模型 `kimi-for-coding` / `kimi-for-coding-highspeed` / `k3.1-pro` / `k3.1-pro-highspeed` / `k3` / `k3-256k`，并加入 `FEATURED_PROVIDER_IDS` 与图标别名）。
- Kimi Code **没有** `/v1/tools/search`（404），所以联网搜索的 Kimi 提供方只对开放平台 key 有效；`searchNativeKimi` 对 `sk-kimi-` 前缀给出明确报错，引导改用 `platform.moonshot.cn` 的 key。
- 实测：`/coding/v1/models`、`/coding/v1/me` 均 200；chat 请求在**额度用尽**时返回 429 `exceeded_current_quota_error`（配额按自然月重置）。
- **Android 上的额外一步**：Kimi Code 网关不回 CORS 头，WebView 直连会被拦。新添加的提供方默认 `useProxy: true`（走原生 HTTP 通道），设置页里对应「改善网络兼容性」开关；该开关在手机端也对该提供方可见（`src/renderer/routes/settings/provider/-networkCompatibility.ts`）。老的 Kimi Code 条目需要手动打开一次。
- **额度**：Kimi Code 套餐按自然月计费，额度用完时接口返回 429 `exceeded_current_quota_error`（附升级链接），这是账号额度而非客户端问题。
- **错误卡片**：429（额度/限流）现在只显示真实的 `HTTP 429` 与服务器返回的原文，不再附带「登录 Chatbox AI 使用许可证」提示和「Chatbox AI 免费试用」按钮——这两处在 open build 里由 `CHATBOX_AI_ENABLED` 关掉（`src/renderer/components/chat/GenericMessageError.tsx`）。

## 14. AGENTS.md 全局协议（仿 Kimi Code）

- **设置**：`设置 → 智能体与记忆 → AGENTS.md`：开关 + 文本框（上限 64 KB），存于 `extension.agentsMd {enabled, content}`。
- **注入**：`src/renderer/stores/session/agent-harness.ts` 在 instructions 组装后追加 `buildGlobalAgentsMdInstructions()`（`src/renderer/packages/model-calls/workspace-instructions.ts`），覆盖聊天与工作模式全部三个分支；包成 `<AGENTS_MD path="global">` 信封，与桌面版工作区 AGENTS.md 格式一致。
- **移动端会话层**：`platform.readSessionWorkspaceAgentsMd()`（`mobile_platform.ts` → `packages/mobile-work-mode/workspace-agents-md.ts`）自动读取会话工作区根的 `AGENTS.md`（32 KB 截断），等价 Kimi Code 读项目 `./AGENTS.md`；best-effort，读不到不报错。工作模式里让 agent「保存为 AGENTS.md」即可在后续轮次自动生效。
- **实测**（MuMu，kimi-for-coding）：问 "Prove that sqrt(2) is irrational."，回答以协议格式输出——「已证 / 简述」「按玩具例子→反例检查→直接证明流程」「先问一句…」「置信度：高」，协议注入生效。
- **预填方式**：文本框粘贴；或停掉 App 后直接改 `databases/chatboxSQLite.db` 的 `key_value` 表（key=`settings`，JSON 内 `extension.agentsMd`）。可靠写法：本地改好 db 后 `[Convert]::ToBase64String` 编码 → `adb push` 到 `/data/local/tmp` → 设备上 `run-as sh -c 'cat /data/local/tmp/x.b64 > cache/x.b64 && base64 -d cache/x.b64 > databases/chatboxSQLite.db'`（**不要**用 PowerShell 管道直接喂 `base64 -d > db` 的 stdin，大 payload 会把文件头写成 0，且回读验证也可能被管道损坏）。

## 15. 修复 Python 生成的图片无法显示（工作区图片解析）

**现象**：移动端工作模式里 Python/matplotlib 把图存到 `output/chart.png`，模型用 `![chart](output/chart.png)` 引用，气泡里只显示破图 —— 点击后 PhotoSwipe 弹出 "The image cannot be loaded"。

**根因**：markdown 里的图片地址是**工作区相对路径**，不是 URL。WebView 把它当成相对 `https://localhost/` 的地址去请求，当然 404。桌面版同理，但桌面产物一般走 `artifacts/` + `create_download` 独立通道，移动端工作模式默认让模型写 `output/`。

**修复**（`src/renderer/components/message-parts/workspace-image.ts` + `WorkspaceImage.tsx`，接入 `Markdown.tsx` 的 `img` 渲染）：

- `isWorkspaceImagePath(src)` 只认「无 scheme、非绝对路径、无 `..`、扩展名是 png/jpg/jpeg/webp/gif/bmp」的相对路径；`https:`/`data:`/`blob:`/`file:`/`//host`/`#anchor` 一律照旧交给浏览器。
- 移动端命中后读工作区文件（`CapacitorWorkspace.readBase64`），转成 `data:` URL 内联渲染；单图上限 20 MB。
- 解析结果按 `sessionId:path` 缓存（markdown 每个流式增量都会重渲染，缓存避免反复读文件）。
- **关键**：失败**不缓存永久**。用户消息里的 `![](output/chart.png)` 会在 Python 跑完前先渲染一次，若把这次 miss 永久记住，后面真正生成好的助手消息就永远显示不出图 —— 这正是第一版实现的 bug。现在失败标记只保留 2 秒，且组件会对「文件还没落盘」的情况自动重试（1.5 s、4 s 各一次），文件一落盘图片自动出现。
- 彻底失败（工作区被清理/文件被删）或超限时降级成小 chip（`图片已不在该工作区中` / `图片过大，无法显示`），而不是浏览器的破图图标。
- 桌面端/网页端行为完全不变（组件里按 `platform.type` 放行原 `<img src>`）。

**实测**（MuMu + deepseek-flash，工作模式）：「Use python to plot sin(x) and save it as output/chart.png…」→ 助手气泡内**完整渲染出 y=sin(x) 曲线图**（坐标轴、图例、网格、虚线零参考线都在）。修复前同一会话只显示破图。

**测试**：`workspace-image.test.ts`（11 例，路径识别/归一化/mime/大小/缓存 TTL）+ `WorkspaceImage.test.tsx`（8 例，内联渲染、路径归一化、失败降级、超大降级、桌面放行、无 session 放行、同路径只读一次、**文件稍后出现能自动恢复**）。