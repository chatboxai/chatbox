# 发送消息后的滚动位置

> Last updated: 2026-11

## 概述

用户向上滚动阅读历史消息时发送新消息，列表是否跳到底部取决于布局：移动端跳到底部，让用户直接看到新消息和回复；桌面端保持阅读位置，通过“正在生成”按钮提示并提供回到底部的入口。

“移动布局”指 Capacitor 移动应用（`platform.type === 'mobile'`），或渲染进程的小屏布局（`useIsSmallScreen()`，MUI `sm` 断点以下，例如窄窗口和手机浏览器）。两者任一成立即按移动端处理，与触控布局（`src/renderer/utils/touch-layout.ts`）对平台和小屏的判断一致；平板上的 Capacitor 应用即使是宽布局也按移动端处理。

## 行为

| 场景 | 桌面 / 网页宽布局 | Capacitor 移动端 / 小屏布局 | React Native 移动端 |
|------|------------------|----------------------------|---------------------|
| 在底部发送 | 跟随新消息到底部 | 跟随新消息到底部 | 跟随新消息到底部 |
| 阅读历史时发送 | 保持阅读位置；生成中显示“正在生成”按钮，点击回到底部 | 跳到底部 | 跳到底部 |
| 点击回到底部后、列表尚未到底时发送 | 跟随到底部 | 跟随到底部 | 跟随到底部 |
| 发送后、消息提交前用户再次滚动或跳转到其他消息 | 不再跳到底部 | 不再跳到底部 | 不再跳到底部 |
| 开启“新消息滚动到顶部”设置 | 新消息滚动到列表顶部 | 新消息滚动到列表顶部 | 发送仍跳到底部，不读取该设置 |

发送意图在按下发送时读取，而不是在消息异步提交后读取；提交前的分页窗口切换等程序性布局变化不会改变结果。用户在发送过程中的主动滚动表示要继续阅读，此时不再强制回到底部。

## 实现位置

| 平台 | 代码位置 |
|------|----------|
| 布局判断 | `src/renderer/components/chat/send-follow-intent.ts`（`sendFromHistoryFollowsTail`） |
| 发送意图捕获（桌面 / Capacitor 共用） | `src/renderer/components/chat/send-follow-intent.ts`（`createSendFollowIntent`）、`src/renderer/components/chat/MessageList.tsx`（`captureSendFollow`） |
| 提交后滚动 | `src/renderer/routes/session/$sessionId.tsx`（`onSubmit` 捕获意图，`pendingSendScroll` 在用户消息提交后调用 `scrollToBottom`） |
| 桌面“正在生成”按钮 | `src/renderer/components/chat/MessageList.tsx`（`activity === 'generating'` 时的 `Generating...` 按钮） |
| React Native | `apps/mobile/src/screens/SessionScreen.tsx`（`send` 记录 `readingIntent`，`onMessagesPersisted` 中意图未变时导航到 `tail`） |

测试：`src/renderer/components/chat/send-follow-intent.test.ts`、`src/renderer/components/chat/MessageList.test.tsx`（`send follow intent`）、`src/renderer/routes/session/-sendScroll.test.tsx`。
