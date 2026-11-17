# Token 估算数据流

历史估算由 `TokenEstimationService` 从独立行接口读取，`useRowTokenHistory` 管理订阅与任务生命周期。Renderer 和 RN 使用同一选择语义；minimap 使用正文窗口的消息；估算独立持有数据。估算用于输入提示和压缩阈值，不等同于供应商账单。

## 首窗与任务

正文首窗完成必要布局并可交互后，宿主开放 `firstWindowReady`。历史计数查询、正文补读、聚合和计算从此之后开始。任务按批次执行并让出 JS 执行权；滚动或输入不引入另一套暂停调度器。

切换会话、数据来源或模型后，任务取消并丢弃过期结果。草稿文本与附件单独计算，草稿变化复用有效历史结果。进度按批次合并，只通知估算订阅，不刷新正文查询、不更换 messages 数组、不回填 Message 的 token 字段。

## 选择与缓存

1. `createSessionTokenPlan` 基于目标生成 thread、选中因果路径、压缩边界、消息资格和当前设置确定估算范围。
2. `readSessionTokenPage` 先读取轻量身份与有效缓存；只有缺失项读取正文，批次最多100项，正文读取有字节预算。
3. 数值缓存绑定不可变正文身份、模型/tokenizer及适用策略。替换正文会使受影响项失效；热缓存不扫描历史正文。
4. 计数写入独立存储，不增加正文提交 revision，不制造正文缓存投影事件。
5. 共享估算服务最多保留16份已完成的历史数值汇总，按会话 revision、目标 thread、上下文范围、模型及附件策略复用；不保留正文或历史消息数组；每份汇总最多记录256个需要复查的外部内容消息 ID。每次估算仍创建当前读取计划，当前草稿与外部指令独立重新计算。
6. 汇总复用要求宿主提供 Session 事件订阅。提交、删除、创建、派生数据变更及列表重置会使相关汇总失效；跨越失效事件的在途任务不发布缓存。依赖外部附件内容或缺少附件的消息不计入稳定汇总，下一次仅重读这些消息，再与稳定汇总相加；需复查的消息超过256条时按完整分页流程执行。取消和失败的任务不发布部分汇总。

跨 thread 浏览不改变发送或估算范围；显式激活 thread 才验证新的上下文。图片、抽样长文本和失败附件要准确保留近似/未完成状态。空字符串文本为零；不能通过 trim 把有意义的空白输入当作空串。

## 发送与压缩

发送和压缩按自己的目标、revision及策略校验历史汇总。有效汇总直接复用，未完成或失效时按原分页流程估算，不等待无关的后台批次。`buildContext` 与附件计划统一系统提示、摘要、历史窗口、RAG、全文/预览及沙箱工具语义。压缩提交校验选中路径和输入来源，不能用展示窗口作为待压缩完整上下文。

## 实现入口

- `packages/chatbox-core/src/application/token-estimation/TokenEstimationService.ts`：独立历史计划、批次、缓存和取消。
- `packages/chatbox-react/src/use-row-token-history.ts`：首窗门控、订阅、过期任务和结果状态。
- `src/renderer/packages/token-estimation/hooks/useTokenEstimation.ts`：renderer 草稿与历史组合。
- `src/shared/context/attachments.ts`、`src/shared/token-estimation/attachments.ts`：发送形态与附件计数规则。

回归覆盖冷/热/局部失效、首窗前零历史查询、模型与会话切换、部分结果、长文本、图片、失败恢复和压缩一致性。真实应用还需验证估算更新没有引起正文重新渲染或测量。
