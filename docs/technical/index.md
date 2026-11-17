# Chatbox Community Edition 技术设计文档

> Last updated: 2026-10

本目录包含 Chatbox Community Edition 的系统设计与技术决策文档，面向工程师和技术负责人。

## 文档目录

| 文档 | 描述 |
|------|------|
| [AI 供应商系统](./ai-providers.md) | 模型供应商注册表、OAuth 登录集成、模型类层级、能力声明、自建供应商 |
| [Provider 网络兼容性请求](./provider-networking.md) | 改善网络兼容性的跨平台传输矩阵、Desktop 主进程直连、relay 与取消边界 |
| [Cursor / OpenCode 订阅登录](./subscription-oauth-research.md) | 两个订阅产品的官方登录机制、Cursor 无私有 API 接入、OpenCode Zen / Go API Key 网关 |
| [思考控制（Reasoning Control）](./reasoning-control.md) | 思考控制支持条件判定（provider + 写死 model id）、effectiveProvider/apiStyle 映射、参数流转与请求侧兜底 |
| [Gemini 工具调用 Thought Signatures](./gemini-tool-call-thought-signatures.md) | Gemini 3 function calling 的 signature 规则、并行工具调用历史序列化、25 次暂停继续问题复盘 |
| [Gemini 流式错误拦截与重试安全](./gemini-stream-error-handling.md) | mid-stream 错误帧检测、MidStreamApiError 重试安全分类、网关范围决策与依赖升级维护清单 |
| [会话管理系统](./session-management.md) | 数据模型、模块拆分、新会话机制、线程历史、消息分叉 |
| [聊天/工作模式分化](./chat-work-mode-split.md) | 在下方回答平铺回退、模式策略（mode-policy）、队列/steering 聊天禁用、生成中切分支、性能与兼容性决策 |
| [App 存储地图](./storage-map.md) | 业务分类、平台介质、关键 key、附件与备份范围 |
| [数据备份与恢复边界](./data-backup.md) | 设置入口可用状态、普通数据操作、V3 与 V1/V2 适配交付边界 |
| [工具步间上下文压缩](./mid-run-compaction.md) | 生成分段、分支归属、摘要边界与步间上下文替换 |
| [Session Attachment RAG 评测](./session-attachment-rag-eval.md) | 大文件问答 RAG 的模型工具调用评测、真实 Chatbox 流程与 fixture 策略 |
| [工具与集成系统](./tools-and-integrations.md) | MCP 服务器、Web 搜索、内置工具集、Tool 构建 |
| [Agent 文件编辑工具调研](./agent-file-editing-research.md) | 开源 edit 协议演进、Chatbox 当前实现、并发与容错边界、改进顺序和评测设计 |
| [Chatbox Virtual CLI](./chatbox-virtual-cli.md) | 内置 Skill 的应用操作命令、权限边界、异步生图与会话 follow-up |
| [Agent Skills 技术设计](./agent-skills.md) | Skills 发现/解析、IPC 通道、上下文注入与会话级配置 |
| [Agent Soul 与 Memories](./agent-soul-memories.md) | 全局人格文档、智能体记忆、冻结快照与 prompt cache 稳定性设计 |
| [Chat 代码执行](./code-execution.md) | Agent Mode、Code Execution 工具集、SandboxProvider 抽象、会话隔离 |
| [移动端本地工作模式](./mobile-work-mode.md) | RN 本地 JavaScript 沙箱、文档产物、按需工具加载与系统权限 |
| [Windows 原生代码执行](./windows-sandbox.md) | Windows 代码执行根因分析、SRT/Codex 方案对比、当前最小原生支持（放弃隔离）与未来强隔离演进 |
| [构建与部署](./build-and-deployment.md) | 构建工具链、依赖管理、签名打包、CI/CD |
| [自动更新系统](./auto-updater.md) | electron-updater 机制、状态管理、Feed URL Fallback、本地测试方法 |
| [Sentry 错误上报](./sentry-error-reporting.md) | 错误覆盖范围、统一分类、采样降噪、去重与隐私规则 |
| [产品分析上报](./analytics.md) | GA 客户端 DAU、Plausible 页面趋势、跨平台事件与追踪授权边界 |
| [VibeDrop HTML 发布](./vibedrop-publish.md) | 跨仓发布链路、鉴权、可见性、内容审核和运行时依赖的实施记录 |

## 文档定位

- **本目录**（`docs/technical/`）：**怎样**设计的？技术架构与决策记录
- **实现文档**（`docs/`）：**怎样**实现的？开发指南和代码规范

## 如何维护

每个文档都包含 `Last updated: YYYY-MM` 标记。当系统设计发生变化时：

1. 更新相关文档内容
2. 更新该文档的 `Last updated` 时间戳
3. 如果涉及多个文档，同时更新所有相关文件
4. 提交 commit 时说明变更原因
