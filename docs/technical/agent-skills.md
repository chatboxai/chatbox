# Agent Skills 技术设计

> Last updated: 2026-02

本文档整理 `feat/skills` 分支合并后的技能系统技术方案，并归档历史设计中的关键决策、实现约束和后续演进方向。

---

## 系统目标

Agent Skills 的核心目标是以低耦合方式扩展模型能力：

- 通过标准 `SKILL.md` 格式发现和解析技能
- 通过 Settings 全局配置（`skills.enabledSkillNames`）控制技能启用范围
- 通过工具调用进行按需加载，避免一次性注入所有技能全文

## 架构分层

| 层次 | 位置 | 职责 |
|------|------|------|
| Main 进程技能层 | `src/main/skills/` | 发现技能目录、解析 `SKILL.md`、注册技能 IPC |
| Shared 类型层 | `src/shared/types/skills.ts` | 技能元数据与配置 Schema |
| Renderer 控制层 | `src/renderer/packages/skills/controller.ts` | 对 IPC 提供类型化封装 |
| 会话工具构建层 | `src/renderer/stores/session/tools-builder.ts` | 在系统指令中拼装技能列表（markdown）与 `load_skill` 工具 |
| UI 层 | Settings | 全局启用/禁用技能 |

## 数据模型与配置

### 全局配置

全局技能开关与启用列表由设置存储管理（`SkillSettingsSchema`），使用版本迁移保证向后兼容。

- `enabledSkillNames`: 启用的技能名列表（内置与用户技能共用同一列表）
- `translationEnabled`: 技能翻译功能开关
- `builtinDefaultsInitialized` / `appliedDefaultBuiltinSkillNames`: 内置技能默认启用的一次性初始化标记

### 会话级覆盖（未实现）

历史设计中曾规划会话级 `enabledSkillNames?: string[]` 覆盖全局配置，当前代码未实现——工具构建只读全局 `skills.enabledSkillNames`。

## 关键流程

### 1) 技能发现与解析（Main）

1. 扫描用户数据目录下 `skills/` 子目录。
2. 对每个候选目录读取 `SKILL.md`。
3. 解析 YAML frontmatter 与正文，提取 `name`、`description` 等元数据。
4. 过滤无效技能（格式错误、缺关键字段），保留可用技能清单。

### 2) 上下文注入与工具注册（Renderer）

`buildToolsForSession()` 中执行以下动作（仅在 agent mode 开启且模型支持 agent 工具时）：

1. 读取全局启用技能集合（`skills.enabledSkillNames`）。
2. 在 `instructions` 中注入 markdown 格式的技能列表（`### Available Skills` 小节）。
3. 注册 `load_skill` 工具（按名称加载技能正文），并注册 `user_exec` / `install_skill` 等配套工具。

该设计遵循“渐进披露（progressive disclosure）”原则。

### 3) UI 管理路径

- Settings Skills 页面：全局启用/禁用、目录打开、刷新扫描

## IPC 通道（技能相关）

当前已归档的技能 IPC 能力包括：

- `skills:discover`
- `skills:load`
- `skills:get-directory`
- `skills:open-directory`
- `skills:execute-script`

## 已归档决策

- 技能规范遵循 agentskills.io（目录 + `SKILL.md`）
- 技能激活采用 `load_skill` + 系统指令内技能列表（markdown）模式
- 内置技能以代码常量内置，而非文件系统预置
- 功能桌面端优先，非桌面端通过 feature flag 降级隐藏
- 会话级技能选择曾计划持久化在 SessionSchema，最终未实现（见上文「会话级覆盖」）

## 错误处理与边界条件

归档记录中的关键边界处理要点：

- 无效 `SKILL.md` 解析失败时跳过，不中断主流程
- 缺失技能目录时自动创建
- 模型不支持 agent 工具或未开启 agent mode 时，不注入技能列表也不注册技能工具
- 被删除技能被引用时返回可读错误，避免会话崩溃

## 演进计划（来自 skills-management-panel 计划）

以下项已整理为后续技术方向：

- 市场检索与安装（skills.sh + curated list）
- GitHub API 安装器与 `source.json` 安装清单
- 更新检查（基于远端 hash/commit 对比）
- 可复用翻译服务（自由翻译链路 + 缓存）

上述内容在合并分支中作为 roadmap 保留，不在本次“已合并能力”范围内默认承诺。

## 相关文档

- 产品说明：[`docs/product/agent-skills.md`](../product/agent-skills.md)
- 工具系统：[`./tools-and-integrations.md`](./tools-and-integrations.md)
