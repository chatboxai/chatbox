# 图标资源清单(全平台)

整理项目里的图标/图片资源:各平台(Desktop / Android / iOS / Web)分别用哪些、来源是什么、哪些是冗余可删的。

> 核查方式:对每个文件在 `src/`、`.erb/`、`electron-builder.yml`、`capacitor.config.ts`、构建脚本中全局 grep 引用,并对 1024 图做 MD5 去重。排除构建产物(`dist/`、`out/`、`release/`、`android/`、`ios/` 等)。

---

## 1. Desktop(Electron)——`assets/`

Electron Builder 配置(`electron-builder.yml`)关键项:
- `buildResources: assets` —— electron-builder 按**约定**自动从 `assets/` 取应用图标
- `extraResources: ./assets/**` —— `assets/` 全量打进安装包的 resources(运行时可通过 `process.resourcesPath/assets/...` 读取)
- `entitlements: assets/entitlements.mac.plist`、`nsis.include: assets/installer.nsh`

运行时入口 `src/main/main.ts`:
- `getAssetPath('icon.png')` —— 窗口图标(line 339)+ Linux 托盘(line 235)
- `getAssetPath('iconTemplate.png')` —— macOS 托盘(line 241)
- `getAssetPath('icon.ico')` —— Windows 托盘(line 243)

### ✅ 实际使用

| 文件 | 用途 | 平台 |
|------|------|------|
| `icon.icns` | 应用图标(buildResources 约定) | macOS |
| `icon.ico` | 应用图标(buildResources)+ 托盘 | Windows |
| `icon.png` (1024) | 窗口图标 + Linux 托盘 | Linux / 通用 |
| `icons/16x16…1024x1024.png`(10 个) | Linux 应用图标集(buildResources/icons 约定) | Linux |
| `iconTemplate.png` (16) | macOS 菜单栏托盘图标(Template=系统自动反色) | macOS |
| `iconTemplate@2x.png` (64) | macOS 托盘 Retina(Electron 隐式按 `@2x` 加载) | macOS |
| `entitlements.mac.plist` | 签名授权 | macOS |
| `installer.nsh` | NSIS 安装器脚本 | Windows |
| `assets.d.ts` | TS 模块声明(`*.png`/`*.svg` 等),非图片,保留 | 构建 |

### 🎨 设计源文件(不被 build/运行时直接使用,但用于**重新生成**上面的图标)

| 文件 | 说明 |
|------|------|
| `icon.svg` | 应用图标矢量母版 |
| `icon-raw.png` (1024) | 应用图标原始位图母版(生成 icon.png/icns/ico 的来源) |
| `iconTemplateRaw.png` (512) | 托盘图标母版 —— 见 `main.ts:238-240` 注释里的 `gm convert` 生成命令 |
| `iconTemplateRawPreview.png` (512) | 托盘图标母版预览 |

> 这些 grep 不到引用,但删了会丢失"重新导出图标"的能力。**保留**(除非确定弃用)。

### 🗑 冗余 / 完全不需要(已删除)

| 文件 | 原因 |
|------|------|
| `icon-1024.png` | 与 `icon.png` **MD5 完全相同**,纯重复 |
| `icon_pro.png` | 废弃的备用品牌图,零引用 |
| `icon_pro2.png` | 同上 |
| `icon_pro_plus.png` | 同上 |
| `.DS_Store` | macOS 目录元数据垃圾(本就未被 git 跟踪) |

---

## 2. Mobile(Android + iOS)——`resources/`

由 `pnpm mobile:assets`(`npx capacitor-assets generate --ios --android`)从 `resources/` 生成两端的图标和启动屏。**与 `assets/` 完全独立。**

| 源文件 (1024 / 2732) | 生成目标 | 平台 |
|------|------|------|
| `icon-foreground.png` | 自适应图标前景层 | Android(+ iOS 合成) |
| `icon-background.png` | 自适应图标背景层 | Android(+ iOS 合成) |
| `icon-only.png` | 传统单图 / iOS AppIcon | Android 旧机 + iOS |
| `splash.png` | 启动屏(亮色) | Android + iOS |
| `splash-dark.png` | 启动屏(暗色) | Android + iOS |

> Android 图标的目录结构与 inset/白边细节见 `docs/android-app-icons.md`。

### iOS 可选图标

普通版在「设置 → 通用 → 应用图标」提供经典、扁平渐变和立体三种样式，经典为默认图标。`AppIconPlugin` 使用系统 `alternateIconName` 读取当前选择，使用 `setAlternateIconName` 切换；选择由 iOS 保存，不进入设置同步或聊天备份。

- 立体图标直接导出自 [Figma `chatbox logo_2.0_classic`（658:1345）](https://www.figma.com/design/rXievlhKAqDxyN8Y4y7CmY/Chatbox-Marketing?node-id=658-1345)，导出 PNG 去除画板外透明边缘，截取 `(29, 0, 1024, 1024)`，源 PNG 为 `resources/icon-sculpted.png`，同步到 `Sculpted.appiconset/1024.png` 和 `src/renderer/static/app-icons/sculpted.png`。
- Xcode 的 Debug / Release 配置都将 `FlatGradient` 和 `Sculpted` 注册为 Alternate App Icon Set，保留 `AppIcon` 为 Primary App Icon Set。
- 设置预览 `src/renderer/static/app-icons/default.png` 来自经典 `AppIcon.appiconset/180.png`。
- 切换入口仅在 iOS 且系统支持备用图标时显示。验证应覆盖切换、恢复经典、重启后回读以及 iPhone / iPad 主屏幕显示。


---

## 3. Web ——`src/renderer/`(不在 `assets/`)

Web/renderer 的图标独立于桌面端,在 `src/renderer/`:

| 文件 | 用途 |
|------|------|
| `src/renderer/favicon.ico` | 浏览器 favicon(`index.html` 引用 `/favicon.ico`) |
| `src/renderer/static/favicon.png` | favicon PNG |
| `logo192.png` | apple-touch-icon(`index.html` 引用) |

---

## 总结:三套互相独立的图标体系

| 平台 | 目录 | 工具/约定 |
|------|------|-----------|
| Desktop | `assets/` | electron-builder buildResources + `main.ts` 运行时加载 |
| Mobile(iOS/Android) | `resources/` | `pnpm mobile:assets`(capacitor-assets) |
| Web | `src/renderer/` | `index.html` 直接引用 |

改某个平台的图标只动它对应的目录即可,互不影响。
