<div align="center">

<img src="./doc/statics/icon.png" width="80" alt="Chatbox Logo" />

# Chatbox (Local Vector RAG 移动与桌面双端增强版)

**一款专注于隐私安全、支持手机移动端与桌面端 100% 离线向量检索的跨平台开源 AI 助手**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Android Ready](https://img.shields.io/badge/Android-APK%20Available-brightgreen?logo=android&logoColor=white)](https://github.com/flupke91/chatbox/releases)
[![iOS Ready](https://img.shields.io/badge/iOS-Xcode%20Ready-lightgrey?logo=apple&logoColor=white)](https://github.com/flupke91/chatbox)
[![Windows](https://img.shields.io/badge/Windows-Desktop-blue?logo=windows&logoColor=white)](https://github.com/flupke91/chatbox/releases)
[![Local First RAG](https://img.shields.io/badge/RAG-100%25%20Local%20Vector-orange?logo=sqlite&logoColor=white)](#-核心亮点与独家特性)

[📥 下载 Android 安装包与桌面版](#-下载与安装) • [✨ 核心亮点](#-核心亮点与独家特性) • [📐 技术架构](#-移动端本地-rag-技术架构) • [🛠️ 编译构建](#-开发与编译指南) • [📑 工程白皮书](./chatbox_mobile_vector_rag_project.md)

</div>

---

> [!NOTE]
> **本仓库是针对 [chatboxai/chatbox](https://github.com/chatboxai/chatbox) 官方开源社区版的重大功能增强分支。**  
> 官方版本在移动端（Android / iOS）默认禁用了会话附件本地向量检索能力。本项目攻克了移动端本地嵌入与分层索引技术难题，完整实现了 **Android / iOS 端侧 SQLite 本地向量 RAG 引擎**、**混合召回（BM25 关键词 + 向量余弦相似度）**，并**全面优化适配了移动端异形屏与状态栏安全区**，彻底消除顶部按钮被遮蔽的问题。

---

## 🚀 核心亮点与独家特性

### 1. 📱 移动端 100% 本地向量检索（Mobile Local RAG）
- **无须 NAS，无须远端向量数据库**：完全摆脱对局域网 NAS、个人服务器或第三方昂贵云端向量库的依赖，索引数据库直接存储在手机端本地 SQLite 中。
- **18MB+ 超长知识库实测秒级召回**：针对小说、长文报告、行业规范等超大附件，通过端侧 Parent / Child 分层切片技术与断点分批计算，既保障移动端内存安全，又保证上下文语义完整。
- **混合检索（Hybrid Search）**：创新结合了精准词法检索（BM25）与语义特征检索（Cosine Similarity），既能搜到专有名词与精确数字，又能理解同义词与隐式意图。

### 2. 🎨 完美适配手机异形屏与状态栏（Safe Area Fix）
- **告别状态栏遮挡**：针对全面屏、打孔屏、刘海屏与灵动岛手机，采用 Capacitor 原生安全区插件结合动态 CSS 环境变量 `max(env(safe-area-inset-top), var(--mobile-safe-area-inset-top))` 双重回退策略。
- **全界面精细校准**：聊天窗口顶部标题栏、汉堡抽屉菜单（Sidebar）、历史会话抽屉（Thread History）、全屏弹窗与代码预览组件均严格遵循设备安全区避让规范。

### 3. 🍏 双端移动支持（Android 原生 + iOS 原生）
- **Android**：提供开箱即用的 Release / Debug APK，下载即可直接在 Android 手机或平板上安装体验。
- **iOS**：仓库内完整交付了标准 Xcode 原生工程（`ios/App/App.xcodeproj`），已配置好 CocoaPods 依赖与原生插件，iOS 开发者或用户可在 macOS 上使用 Xcode 一键构建并安装到 iPhone/iPad。

### 4. 🔒 本地优先，极致隐私
- 用户的个人文档、知识库、解析后的纯文本片段与特征向量，**永久留在用户自己的手机或电脑闪存中**。
- 支持 OpenAI、DeepSeek、Claude、Gemini、Ollama 等任意兼容 OpenAI 协议的模型及 Embedding API。

---

## 📥 下载与安装

### 📱 移动端（Android / iOS）

| 平台 | 下载与安装方式 | 说明 |
| :--- | :--- | :--- |
| **Android** | [📱 点击下载 Android 安装包 (APK)](https://github.com/flupke91/chatbox/releases/download/v1.9.8-rag/Chatbox-mobile-rag-debug.apk) | 支持 Android 8.0 及以上系统，已集成状态栏避让与本地向量数据库。 |
| **iOS** | [🍏 查看 iOS 工程源码目录](./ios) | 支持 iOS 14.0+。克隆本项目后，在 macOS 终端执行 `npx cap open ios` 即可在 Xcode 中运行。 |

### 💻 桌面端（Windows / macOS / Linux）

| 操作系统 | 下载文件 | 架构支持 |
| :--- | :--- | :--- |
| **Windows** | [💻 Windows 安装包 (.exe)](https://github.com/flupke91/chatbox/releases/download/v1.9.8-rag/Chatbox-1.23.5-Setup.exe) | 64位 Windows 10 / 11 |
| **macOS** | [前往 Releases 页面查看](https://github.com/flupke91/chatbox/releases) | Intel & Apple Silicon (M系列) |
| **Linux** | [前往 Releases 页面查看](https://github.com/flupke91/chatbox/releases) | AppImage / deb |

*所有版本的历史包、安装包校验和及完整发布资产请访问：[GitHub Releases 资产页](https://github.com/flupke91/chatbox/releases)*

---

## 📐 移动端本地 RAG 技术架构

整个端侧检索链路完全运行在移动设备本地，其核心流转过程如下：

```text
       ┌────────────────────────────────────────────────────────┐
       │                 移动端文件导入 (18MB+ TXT/PDF)          │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
                 [MobilePlatform 本地文本分段解析]
                                   │
                                   ▼
          ┌──────────────────────────────────────────────────┐
          │        MobileRagEngine 分层分块器 (Chunker)       │
          │  - Parent Chunk: 1600~2400 字符 (语义上下文容器)    │
          │  - Child Chunk: 448 字符 (精细检索匹配单元)         │
          └────────────────────────┬─────────────────────────┘
                                   │
                                   ▼
          ┌──────────────────────────────────────────────────┐
          │          端侧断点续传队列 (Batch Size = 50)       │
          │  - 避免移动端爆内存与网络请求超时                   │
          │  - 记录进度 Checkpoint，支持退出断点恢复            │
          └────────────────────────┬─────────────────────────┘
                                   │
                                   ▼
          ┌──────────────────────────────────────────────────┐
          │     Capacitor SQLite 原生移动端向量数据库          │
          │  - chunks 表 (存储 Child & Parent 映射)           │
          │  - vector_index 表 (BLOB 二进制存储 IEEE754 Float)│
          └────────────────────────┬─────────────────────────┘
                                   │
                                   ▼
          ┌──────────────────────────────────────────────────┐
          │              端侧混合检索与重排序                 │
          │  - BM25 词法评分 + 向量余弦相似度加权召回 Top 20   │
          │  - 自动回溯读取对应的 Parent 上下文 (Top 8)        │
          └────────────────────────┬─────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │       通过标准 Tool 协议将最相关知识提供给大模型生成回答 │
       └────────────────────────────────────────────────────────┘
```

---

## 📱 移动端屏幕与安全区适配说明

在现代手机（如具有挖孔屏、水滴屏、药丸灵动岛的设备）中，WebView 默认工作在 `viewport-fit=cover` 沉浸式全屏模式下。如果直接硬编码顶部内边距为 `0px`，状态栏中的信号电量图标会强行遮挡顶部功能栏的“新建会话”、“历史记录”及“模型切换”按钮。

本项目对此进行了全局深度适配：
1. **跨平台安全区监听**：统一在 `src/renderer/setup/mobile_safe_area.ts` 中初始化 Capacitor 原生安全区插件，同时针对 Android 与 iOS 注册屏幕旋转、窗口 Resize、软键盘弹出的高精度监听。
2. **CSS 多重安全回退**：
   ```css
   padding-top: max(env(safe-area-inset-top, 0px), var(--mobile-safe-area-inset-top, 0px));
   ```
   双重保障确保无论系统 WebView 是何种版本，页面核心内容与按钮都完美避开状态栏遮挡。

---

## 🛠️ 开发与编译指南

### 1. 准备工作
- 安装 [Node.js](https://nodejs.org/) (推荐 v20+)
- 安装包管理器：`pnpm` (`npm install -g pnpm`)
- 如需编译 Android：安装 JDK 17+ 及 Android Studio / Android SDK
- 如需编译 iOS：macOS 环境下安装 Xcode 及 CocoaPods

### 2. 获取代码与安装依赖
```bash
git clone https://github.com/flupke91/chatbox.git
cd chatbox
pnpm install
```

### 3. 构建与运行

#### 📱 Android 移动端构建：
```bash
# 1. 编译前端移动端资源包
pnpm run build:mobile

# 2. 同步资源至 Android 工程
npx cap sync android

# 3. 编译 Android Debug APK
cd android
./gradlew assembleDebug
# 生成的 APK 位于：android/app/build/outputs/apk/debug/app-debug.apk
```

#### 🍏 iOS 移动端构建：
```bash
# 1. 编译前端移动端资源包
pnpm run build:mobile

# 2. 同步资源并更新 Pods
npx cap sync ios

# 3. 在 Xcode 中打开工程并运行
npx cap open ios
```

#### 💻 桌面端开发与打包：
```bash
# 启动桌面端热重载开发服务器
pnpm run dev

# 打包 Windows / macOS / Linux 桌面安装包
pnpm run package
```

---

## 📄 文档与白皮书

- 📖 **[移动端本地向量 RAG 项目白皮书与架构总结 (Markdown)](./chatbox_mobile_vector_rag_project.md)**
- 📑 **[项目技术白皮书 (Word .docx 格式)](./chatbox_mobile_vector_rag_project.docx)**
- 📜 **[更新日志与变更记录](./CHANGELOG.md)**

---

## ⚖️ 开源许可证

本项目基于 [GPLv3 许可证](./LICENSE) 开源发布。保留对 Chatbox 原作者团队的全部版权与署名致敬。
