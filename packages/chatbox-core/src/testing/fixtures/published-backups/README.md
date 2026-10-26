# 历史备份格式夹具

所有内容均为合成数据，不含用户数据。V2 目录保存 ZIP 解包后的原始 entry 字节；打包时不修改 JSON 排版或资源内容，以保持 manifest 的长度和校验值有效。

## 正式版本来源

来源为 `v1.23.5`（`b1939944ff0fd69360e8bee0eac70ad96976952f`）。`released-provenance.json` 记录源文件 hash、生成依赖和各 entry hash。

| 夹具 | 生成与覆盖 |
| --- | --- |
| `v2-released/` | 使用该 tag 的 `exportBackupArchive`、资源编码器及 schema 实际生成。包含显式空的 settings、Copilots、共享会话设置及记忆集合。 |
| `v2-released-missing-settings/` | 同一导出器生成；导出选项勾选设置与 Copilots，但存储中没有对应 key，因此所有全局 entry 缺失。 |
| `v1-released.json` | 该 tag 的 `importLegacyJsonBackup` 接受的 JSON 键值结构，`configVersion=15`；不包含设置与记忆 key。 |
| `v1-released-empty-settings.json` | 相同 V1 结构，包含显式空 settings、Copilots 和记忆集合。 |

每份正式来源夹具包含 1 个会话、3 条消息（当前线程 2 条、历史线程 1 条）和 4 个资源 key。V2 将资源去重为 2 个物理 entry：两个图片 key 共享 `data-url-base64` 内容；文件与链接 key 共享 UTF-8 文本。V1 直接保存相同的字符串资源值。内容含中英文和 emoji。

这些 V1 夹具验证正式版本接受的 JSON 导入契约，不宣称该版本仍提供 V1 导出。V2 夹具则直接来自正式版本导出器。

## 预发布基线夹具

- `v1.json`：JSON 键值备份，包含会话列表和一条中英文消息。
- `v2/`：由预发布基线 `773e30b8ae27eed75bb3541fcac38679fa18968e` 的 V2 导出器生成，包含固定时间及合成会话。
