# 并行输出与分支输出功能开发文档

## 概述

本文档记录 Chatbox 并行输出和分支输出功能的开发过程、当前状态和待解决问题。

---

## 功能说明

### 1. 并行输出功能
- **触发方式**：在输入框点击并行输出按钮（图层图标）启用
- **行为**：发送消息后，AI 会生成多次回复（默认 3 次）
- **显示**：多个回复并排显示，用户可以对比选择
- **采纳**：点击"采纳此回复"按钮，其他回复会被移除

### 2. 分支输出功能
- **触发方式**：在任意消息下方点击分支按钮（Git Fork 图标）
- **行为**：创建新对话，包含该消息及之前的所有消息
- **用途**：从某个历史点继续对话，探索不同方向

---

## 已完成的修改

### 新增文件

| 文件 | 说明 |
|-----|------|
| `src/shared/types/parallel.ts` | 并行输出类型定义 |
| `src/renderer/components/ParallelOutputView.tsx` | 并行输出显示组件 |

### 修改文件

| 文件 | 修改内容 |
|-----|---------|
| `src/shared/types/settings.ts` | 添加 `parallelOutputCount`, `parallelOutputInterval` 设置 |
| `src/shared/types/session.ts` | 添加 `parallelOutputId`, `parallelOutputIndex` 消息标记 |
| `src/shared/defaults.ts` | 添加默认值 |
| `src/shared/types.ts` | 导出新类型 |
| `src/renderer/stores/uiStore.ts` | 添加并行输出状态管理 |
| `src/renderer/stores/session/generation.ts` | 添加 `generateParallelOutput`, `acceptParallelOutputSlot` |
| `src/renderer/stores/session/crud.ts` | 添加 `createSessionFromMessages` |
| `src/renderer/components/InputBox/InputBox.tsx` | 添加并行输出开关按钮 |
| `src/renderer/components/chat/Message.tsx` | 添加分支按钮 |
| `src/renderer/components/chat/MessageList.tsx` | 过滤并行输出消息 |
| `src/renderer/routes/session/$sessionId.tsx` | 集成并行输出逻辑 |
| `src/renderer/routes/settings/chat.tsx` | 添加设置 UI |
| `src/renderer/i18n/locales/zh-Hans/translation.json` | 添加翻译 |

---

## 核心逻辑

### 并行输出流程

```
1. 用户启用并行输出模式 → 点击发送
2. 插入用户消息到 session
3. 调用 generateParallelOutput():
   - 初始化所有 slot 状态为 'waiting'
   - 串行生成每个回复：
     a. 移除之前完成的并行消息（保证上下文一致）
     b. 创建新的 assistant 消息
     c. 调用 generate() 生成
     d. 从 session 获取完整消息
     e. 保存到 slot.message
     f. 更新 slot 状态为 'completed'
4. 用户点击"采纳" → acceptParallelOutputSlot()
   - 移除其他并行消息
   - 清理并行输出状态
```

### 关键设计决策

1. **串行生成而非并行**：避免 API 速率限制，实现简单
2. **移除已完成消息再生成**：保证每个生成都看到相同的上下文
3. **slot.message 保存完整内容**：即使消息从 session 移除，也能显示

---

## 当前问题

### 问题描述

**症状**：并行输出时，第一个槽位生成完成后，第二个开始生成时：
1. 整个气泡窗口变矮
2. 第一个回复的内容看不到了
3. 三个都输出完后，只能看到第三个回复，前两个都是空白

### 已添加的调试日志

在 `generation.ts`:
```typescript
console.log('[ParallelOutput] Generation completed', {
  index: i,
  messageId: completedMsg.id,
  contentPartsLength: completedMsg.contentParts?.length,
  hasContent: completedMsg.contentParts?.some(p => p.type === 'text' && p.text)
})
```

在 `ParallelOutputView.tsx`:
```typescript
console.log('[ParallelSlotCard]', {
  index,
  status,
  hasActualMessage: !!actualMessage,
  messageTextLength: messageText.length,
  isGenerating,
  slotMessageId: slot.message?.id,
  actualMessageId: actualMessage?.id,
})
```

### 可能的原因

1. **slot.message 未正确保存**：生成完成后，`completedMsg` 可能没有完整内容
2. **getActualMessage 逻辑问题**：对于 completed 状态的 slot，应该返回 `slot.message`，但可能返回了 null
3. **session 缓存问题**：`getSession` 可能返回了过时的数据
4. **React 渲染时机**：状态更新后，组件可能没有正确重新渲染

### 排查步骤

1. 运行 `pnpm dev`
2. 启用并行输出，发送消息
3. 查看浏览器控制台日志：
   - `[ParallelOutput] Generation completed` - 检查 `hasContent` 是否为 true
   - `[ParallelSlotCard]` - 检查 `hasActualMessage` 和 `messageTextLength`
4. 根据日志定位问题

---

## 代码关键位置

### generateParallelOutput (generation.ts:46-143)

```typescript
// 核心循环
for (let i = 0; i < count; i++) {
  // 移除之前完成的并行消息
  for (const msg of completedMessages) {
    await removeMessage(sessionId, msg.id)
  }
  
  // 创建并生成新消息
  await generate(sessionId, assistantMsg, ...)
  
  // 从 session 获取完整消息
  const completedMsg = session?.messages.find(m => m.id === assistantMsg.id)
  
  // 保存并更新 slot
  completedMessages.push(completedMsg)
  uiStore.getState().updateParallelSlot(sessionId, i, {
    message: completedMsg,
    status: 'completed',
  })
}
```

### getActualMessage (ParallelOutputView.tsx:28-42)

```typescript
const getActualMessage = (slot: ParallelSlot): Message | null => {
  if (slot.status === 'generating') {
    // 生成中：从 session 获取实时内容
    const liveMsg = session?.messages.find(...)
    return liveMsg ?? slot.message
  }
  // 已完成：使用保存的消息
  return slot.message
}
```

---

## 下一步

1. 查看控制台日志，确认问题位置
2. 如果 `slot.message` 为 null，检查 `updateParallelSlot` 调用时机
3. 如果 `messageTextLength` 为 0，检查 `getMessageText` 函数
4. 如果 `hasContent` 为 false，检查 `generate` 函数是否正确更新 session

---

## 相关文件快速定位

- 类型定义：`src/shared/types/parallel.ts`
- 状态管理：`src/renderer/stores/uiStore.ts` (第 49-51, 212-274 行)
- 生成逻辑：`src/renderer/stores/session/generation.ts` (第 46-180 行)
- UI 组件：`src/renderer/components/ParallelOutputView.tsx`
- 设置页面：`src/renderer/routes/settings/chat.tsx`
- 输入框按钮：`src/renderer/components/InputBox/InputBox.tsx`
- 消息列表过滤：`src/renderer/components/chat/MessageList.tsx` (第 117-124 行)

---

## Git 提交信息

```
commit d871591f
feat: add parallel output and branch output features

- Add parallel output: generate multiple responses sequentially, display side-by-side for comparison, user can accept one
- Add branch output: create new conversation from any message point
- Add settings for parallel output count and interval
- Add debug logs for troubleshooting parallel output display issues
```

已推送到：`myfork/feature/json-export-import`
