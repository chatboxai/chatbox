# Chatbox Pro 产品说明

> Last updated: 2026-03 (added Chat 代码执行)

## 产品简介

Chatbox Pro 是一款跨平台 AI 聊天客户端，支持桌面（macOS / Windows / Linux）、移动端（iOS / Android）和网页版。用户可在同一个应用中接入 30 多家 AI 模型服务商，管理多轮对话，并通过知识库、网页搜索、工具扩展等增强 AI 的能力。

## 核心功能

| 功能 | 说明 | 详情 |
|------|------|------|
| 多模型支持 | 同时接入 OpenAI、Claude、Gemini、DeepSeek 等 30+ AI 服务商，并支持部分官方 OAuth 登录 | [AI 模型与服务商](./ai-models.md) |
| 会话管理 | 多会话并行、线程分支、消息分叉、自动命名 | [会话与对话](./conversations.md) |
| 发送后滚动 | 阅读历史时发送：移动端跳到底部，桌面端保持位置 | [发送消息后的滚动位置](./send-scroll-behavior.md) |
| 知识库 | 上传文档让 AI 检索回答，支持 PDF / Word / Markdown 等格式 | [知识库](./knowledge-base.md) |
| 工具与集成 | MCP 工具扩展、网页搜索、文件读取 | [工具与集成](./tools-and-integrations.md) |
| Agent Skills | 遵循 agentskills.io 规范的技能系统，支持全局与会话级启用 | [Agent Skills](./agent-skills.md) |
| Chat 代码执行 | 在聊天对话中执行代码、解析文档、生成可下载文件（桌面端） | [Chat 代码执行](./code-execution.md) |
| 跨平台 | 桌面 / 移动 / 网页三端一致体验 | [跨平台支持](./cross-platform.md) |
| 智能上下文 | 自动压缩长对话、Token 用量实时估算 | [智能上下文管理](./context-and-tokens.md) |

## 目标用户

- **个人用户**：日常使用 AI 助手进行写作、编程、学习、翻译等任务
- **知识工作者**：需要将自有文档与 AI 结合，实现基于文档的问答和分析
- **开发者**：需要灵活切换不同 AI 模型，并通过 MCP 协议扩展 AI 能力
- **团队**：需要在多端使用统一的 AI 工具

## 文档导航

- **本目录**（`docs/product/`）：产品功能说明，面向产品经理、设计师和非技术人员
- **技术文档**（[`docs/technical/`](../technical/index.md)）：系统架构与技术决策，面向工程师
