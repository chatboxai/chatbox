# 数据备份归档

> Last updated: 2026-07

Chatbox 的手动数据备份使用带版本的 ZIP 归档。归档以会话为独立恢复单元，同时携带会话引用的受管图片、附件原文、解析内容和其他 blob 资源。历史单 JSON 备份仍可导入，但新导出统一使用 ZIP v2。

## 归档结构

```text
chatbox-backup-YYYY-M-D.zip
├── manifest.json
├── settings.json                  # 选中“设置”时存在
├── copilots.json                  # 选中“My Copilots”时存在
├── session-settings.json          # 存在相关设置时生成
├── sessions/
│   └── <encoded-session-id>/
│       ├── session.json
│       └── resources/
│           └── <resource-id>.<ext>
└── resources/
    └── <resource-id>.<ext>        # 全局或共享资源
```

`manifest.json` 最后写入，因此它记录的是本次流式导出的最终结果，而不是导出前的预估。根字段包括：

- `format: "chatbox-backup"` 与 `formatVersion: 2`；
- 导出时间、应用版本、平台和所选导出范围；
- 设置、Copilot、session settings 和每个 session JSON 的路径、字节数与 SHA-256；
- 资源 id、原始 storage key、归档路径、会话映射、MIME type、编码、字节数与 SHA-256；
- session/资源读取失败、外部路径跳过和 RAG 重建失败的 warning；
- session、资源、去重资源和 warning 数量。

Schema 的单一实现位于 `src/renderer/packages/backup/types.ts`。导入端只接受明确支持的格式版本，不对未知版本做猜测性恢复。
导出端在报告成功前也会用同一 schema 校验最终 manifest，并执行与导入端一致的 entry 数量、单项大小和总大小限制，避免生成自身无法导入的归档。超长 session id 仅在归档路径中替换为内容哈希，manifest 与恢复后的 session id 保持原值。

## 资源边界

资源收集器遍历 session 当前消息、历史线程和消息分叉，并收集：

- 消息图片和旧版图片会话图片；
- 附件解析内容 `storageKey` 与原始附件 `rawStorageKey`；
- 已解析链接、离线 tool result；
- session 头像和背景图；
- 设置头像、全局背景及 Copilot 图片。

相同 storage key 只生成一个资源节点；内容、编码和 MIME type 相同的不同 key 也可共享同一个归档 entry。manifest 保留所有原始 key 和 session 映射，导入时再按目标存储状态决定是否复用或重映射。

仅导出 Chatbox blob storage 中的受管内容。`localPath` 等外部绝对路径不会进入备份，也不会递归读取用户目录；缺少受管原文时会写入 warning。session attachment RAG 的 attachment id、索引状态、chunk 和 embedding 等派生状态会从 session JSON 中移除。原始/解析附件恢复后，桌面端重新创建 RAG 索引任务；不支持该能力的平台降级为 inline 附件。

未选择“API KEY 与许可证”时，设置备份会移除许可证、模型提供商 API/OAuth/AWS 凭据、自定义提供商默认凭据、联网搜索密钥、MinerU token、VibeDrop 发布密钥，以及 MCP 的环境变量和请求头。许可证运行时状态无论是否选择该项都不会写入备份。

## 有界内存与跨平台输出

`fflate` 的 streaming `Zip`/`Unzip` API 负责逐 entry 压缩和解压。ZIP writer 将单个输入 entry 切成 1 MiB 块，输出队列使用 4 MiB 高水位背压。DOCX、PPTX、XLSX 等本身为 ZIP 容器的附件仍作为不透明的单个资源 entry 保存；streaming Unzip 会按已读取的压缩字节数验证 data descriptor 边界，不把附件内部的 `PK` 签名误认为外层 entry。导出内存上限由“单个 session JSON 或单个资源”决定，不随完整归档大小线性增长。

- Desktop/Web：优先使用 File System Access 可写流；不支持时退化为 Blob 下载，并在 UI 明确提示本次保存需要缓冲完整归档。
- Android：分块写入 Documents；权限或目录能力不足时流式写入 Cache，再交给系统文件选择器，结束后删除临时文件。
- iOS：分块写入 Cache 后打开系统分享面板，完成或失败后清理临时文件。

导出取消会终止 ZIP producer，并删除已创建的部分文件。资源或 session 读取失败不会被静默吞掉：manifest 和设置页都会显示 warning。导入包含缺失受管资源的归档时，会依据 manifest 中实际声明的资源清理所有不可用 storage key、图片和装饰引用，继续恢复其余数据，并向用户显示 warning。

## 导入事务

ZIP 导入分为三个阶段：

1. **读取与暂存**：逐 entry 解压；JSON entry 写入临时 KV，资源写入临时 blob。
2. **完整校验**：验证 manifest schema、entry/path 唯一性、大小、SHA-256、session/resource 双向映射和统计值。
3. **提交**：先规划资源 key，再写资源、session、meta、设置和 Copilot。目标 key 已有不同内容时生成同类的新 key，并重写所有引用。

提交前保存将被覆盖的 KV/meta 快照。提交中取消或失败时按逆序恢复快照、删除新资源，并清理所有暂存 key。仅包含会话和资源的 ZIP 导入成功后，清除旧会话缓存并刷新会话列表，直接在当前页面显示结果。含设置、Copilot 或 session-settings 全局条目的 ZIP，以及旧 JSON 备份，导入后重启应用，使全局状态从持久化数据重新加载；有 warning 时先展示详情，由用户点击 Continue 完成重启。

## ZIP 安全限制

导入器在解压前后同时检查：

- 绝对路径、反斜杠、空路径段、`.` / `..` 和 Windows drive path；
- 重复 entry path、缺少 central directory 或截断归档；
- entry 数量（最多 50,000 个 session、50,000 个资源和 4 个全局 JSON entry）；
- 单 entry 解压大小（JSON 为 128 MiB，资源为 512 MiB）；
- 总解压大小（默认 4 GiB）；
- 高压缩比 entry（默认上限 2,000 倍；单项和总解压硬上限仍同时生效）；
- manifest 未声明的 entry、缺失 entry、size/checksum 不一致和映射不一致。

这些限制在写入正式存储前生效。

## 相关实现

- `src/renderer/packages/backup/`：manifest、资源图、ZIP codec、导出、导入和 RAG 恢复。
- `src/renderer/routes/settings/general.tsx`：导出范围、进度、取消、warning 和 legacy JSON 路由。
- `src/renderer/platform/*_exporter.ts`：Desktop/Web/Mobile 输出能力。
- `src/renderer/platform/filter_writer.ts`：Capacitor 分块写入、Android picker fallback 和临时文件清理。

### 备份交互与进度

导出弹窗依次展示范围选择、检查摘要、执行和结果。摘要页可返回修改，保留勾选和搜索；当前检查释放写入限制后才返回，再次继续时重新检查数据。摘要说明会话数量、额外数据和版本兼容性。

分片导出、校验和恢复复用现有流式读写统计未压缩字节，不为进度增加全文扫描。界面每约 500 ms 更新一次数据量，阶段切换和阶段完成立即更新；只在有可靠总量时显示阶段进度条。等待已有工作、取消清理和最终收尾分别显示，清理完成前保持操作限制。

缺失会话、缺失附件/图片和搜索索引恢复失败分别计数。检查摘要显示已发现的问题，最终结果补齐运行时发现的问题；明细按需展开、分批展示。warning 可带可选的 `itemName` 显示名称，旧备份缺少该字段时回退到可用元数据或标识符。损坏、缺片和 checksum 不匹配仍按恢复失败处理。
