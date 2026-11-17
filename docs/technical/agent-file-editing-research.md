# Agent 文件编辑工具调研与改进建议

> Last updated: 2026-09
>
> 调研日期：2026-09-14。状态：技术调研与基础改进实现。已实现范围见下文；未执行多模型协议性能评测。
>
> 调研源码基线：`57e010e79d1c2cb26550afcd12e5eb4a41f45f40`。核对范围为 Renderer 文件工具、Desktop IPC、原生沙箱和 Soul 虚拟文件；不将这些路径的结论自动推广到所有移动端后端。

## 结论与适用范围

Chatbox 应保留精确文本替换作为通用编辑入口，先补齐可诊断错误、换行兼容、真实 diff 与同文件修改协调，再评测是否引入 patch 或 Hashline。更换输入格式本身不能解决并发覆盖、审批内容过期或落盘中断。

目标场景包括代码、Markdown、JSON/配置和普通文本。二进制文件、Word/Excel 等结构化文档应继续使用对应领域工具；文本编辑器不承担这些格式的语义修改。

本文区分三类结论：源码核对描述可见行为；作者实验保留其模型与任务边界；Chatbox 建议是待验证设计。外部开发分支的实现不等同于已发布版本，也没有证据表明某一种编辑协议对全部模型最优。

## 已实现能力与兼容性

本次实现基于 `420763279` 的 main，保留 `edits[]` 顺序替换及单次 old/new 调用兼容。

| 能力 | 实现与边界 |
|------|------------|
| 统一匹配 | [file-edits.ts](../../src/shared/file-edits.ts) 同时用于主进程、Soul 和 Node 沙箱脚本；只兼容 CRLF/LF，不放宽缩进、引号和语义空格；保留 BOM 与替换区域外的原始文本；匹配区域内的混合行尾按该区域首个行尾统一 |
| 明确反馈 | 空搜索拒绝；无变化返回 no-op，不写入且不触发写入审批；歧义返回匹配总数和最多五个候选行号；顺序批量任一项匹配失败不写入 |
| 实际 diff | [file-edit-summary.ts](../../src/shared/file-edit-summary.ts) 使用真实 before/after 生成带上下文的有界 diff 和净增删数；before/after 合计超过 1,000,000 字符或任一输入超过 20,000 行时跳过 diff 分词与计算；其余计算限时 100 ms、编辑距离上限 4,000，预览在 8,000 字符内按完整行截断，超预算明确标记不完整；审批兜底复用请求片段 diff，整次统计限时 50 ms、累计 100,000 字符、单对片段合计 10,000 行；片段计数不保证等于整文件净变化，所有审批兜底统计均标记 `~`；模型结果仅保留至多 1,200 字符的完整行摘录 |
| 桌面写入协调 | [file-mutations.ts](../../src/main/file-mutations.ts) 统一真实文件及原生沙箱 write/edit 的主进程队列，使用 realpath 协调已有文件的符号链接别名；不承诺硬链接、跨进程或 OS 级 CAS |
| 审批绑定 | 首次 dry-run 生成 diff 与 SHA-256 内容版本；在 pauseReason 中保存版本，恢复时传回同一版本并复核。内容已变化则拒绝该次编辑，模型需重新读取并提交 |
| 审批 UI | 编辑审批默认显示可用的净增删行数；正文展开后才挂载，在限高区域连续滚动查看，保留 hunk 位置；增删着色且保留 +/- 标记，长行横向滚动。预览不完整时提示先检查文件或请求拆小编辑，不能把局部预览当作完整核对。整文件写入保持原有审批行为 |
| 脚本后端 | 同一 Renderer 内按 session 串行化脚本 write/edit，以覆盖路径别名；不同文件也会排队，缺失 sessionId 的调用共享一个队列。编辑前后读取比较用于发现外部变化。仅当 before/after 与结果标记行的最终输出合计不超过 12,000 UTF-8 字节时返回内部快照计算 diff，较大文件只返回结果及预览不完整标记；快照不进入最终模型工具结果。只解析结果标记行，忽略执行器日志；无法确认结果时要求先读取文件再编辑 |
| 平台覆盖 | Windows/Harmony 使用原生沙箱入口；POSIX 的相对路径、会话根目录、已授权工作目录及额外临时路径均经过 Provider 的受限执行器，不能与主进程队列视为一个全局事务；Cloud Provider 当前为占位实现，未声称云端验证 |

文件审批 pauseReason 新增可选 `editPreview`（内容版本与截断标记），统计新增可选 `approximate` 标志。已核对 `v1.23.2` 的 schema：该版本没有此字段。新版本读取旧暂停记录时，在获得新的版本绑定预览后再继续；不需要数据库版本变更或迁移。备份/导入仍使用原会话结构，新字段随支持它的 schema 保存；旧版本可能丢弃新字段，不能保证旧版执行拥有新的过期保护。新增持久化大小主要来自至多 8,000 字符的审批 diff 以及版本字段；最终工具结果中的 diff 至多 1,200 字符，不保存整文件快照。审批 diff 包含真实文件内容及三行上下文，会随会话进入导出和备份；编辑敏感文件时，其中的敏感文本也可能出现在这些记录中。

主进程编辑（包括 dry-run）和 Node 沙箱编辑均只读取不超过 4 MiB 的普通文本文件；在同一个文件描述符上检查类型、大小，读取期间增长超过上限时拒绝。主进程复用 [bounded-file-read.ts](../../src/main/bounded-file-read.ts)。审批前失败保留错误类别、请求中的编辑序号及固定恢复建议，不暴露匹配行号、次数或原始文件系统错误；无变化仍返回成功。文件不存在、其他读取失败、超限和非普通文件分别使用 `FILE_NOT_FOUND`、`READ_FAILED`、`FILE_TOO_LARGE`、`NOT_REGULAR_FILE`，与写入失败区分。写入失败与沙箱路径拒绝同样使用固定文案，不返回操作系统错误及路径细节。预览返回读取版本，提交成功返回写入后版本；API 错误重试需要新预览时恢复审批暂停。

当前落盘仍为直接写入。文件队列与写前复核不等于临时文件原子替换，也不能消除外部进程在复核后写入的竞态。多文件事务、Hashline、原始快照批量语义和相似度自动应用仍属于独立评测方向。

验证分层：确定性测试覆盖匹配、真实临时文件落盘、过期版本、并发别名、审批上下文和 UI；Node 脚本测试实际启动本机 Node。Windows 专属套件需在 Windows 主机运行，云端与全平台能力不能由这些测试推定。真实 Electron QA 和当前 PR HEAD 的 AI API live 状态记录在 PR 验证部分。

## 1. 方案分类

编辑工具可以拆成四层：模型表达修改、工具定位原文、后端提交变更、结果反馈。协议名称只覆盖其中一部分。

| 协议 | 输入方式 | 适用场景 | 主要代价 |
|------|----------|----------|----------|
| 整文件重写 | 路径与完整新内容 | 新建、小文件、明确的整体重写 | 输出量随文件增长，省略内容或覆盖无关修改的风险较高 |
| 搜索替换 | 旧文本、新文本，可带批量操作 | 多模型通用、局部文本修改 | 复述原文消耗 token；空白与重复内容导致失败 |
| 上下文 patch | 上下文、增删行、文件操作标记 | 多处修改、多文件增删改移 | 模型需掌握语法，仍需处理定位与容错 |
| 行号范围 | 起止行与新内容 | 与窗口化读取配合的局部修改 | 修改导致行号漂移，需校验读取版本 |
| Hashline | 行号与短内容哈希、新内容 | 减少旧文本复述，校验编辑锚点 | read/search/edit 必须协同，短哈希碰撞与范围内部变化仍需处理 |

Aider 的 `diff` 是 SEARCH/REPLACE 格式，`udiff` 才是简化 unified diff；Codex `apply_patch` 也不是标准 `git apply` 输入。[S1][S7]

定位失败的恢复策略是独立维度：严格报错、换行等确定性归一化、相似匹配、模型纠错。AST/LSP 则提供语言层的定位或诊断能力，可与这些协议组合；其语言覆盖和运行成本决定了它不宜成为 Chatbox 通用文本编辑的必需前置条件。

## 2. 历史演进

以下是有来源支持的代表性节点，不是工具发明权或完整产品历史。

| 阶段 | 可核实节点 | 得到的经验 |
|------|------------|------------|
| 2023：输出格式实验 | Aider v0.16.0 调整为 SEARCH/REPLACE；v0.19.0 于 2023-12-20 发布，引入面向 GPT-4 Turbo 的 unified diff [S2] | 格式应降低转义、计数和原文复述负担；收益依赖模型 |
| 2024：编辑反馈成为 ACI 的一部分 | SWE-agent 的经典设计结合窗口化读取、编辑与 lint，阻止特定语法错误进入文件 [S4] | 失败后能否有效恢复，与能否表达修改同样重要 |
| 2025 前后：替换与 patch 并行 | Cline v3.20.0 的 SEARCH/REPLACE 实现；Codex 自定义 patch；OpenCode 源码注明借鉴 Cline 与 Gemini CLI [S5][S6][S7] | 解析器和匹配器逐渐承担模型输出偏差，项目之间相互借鉴 |
| 2026：批量、并发与锚点探索 | Pi 当前实现包含批量替换及文件队列；Cline 当前 SDK 有 patch 执行器；2026-02-12 Hashline 实验探索短哈希定位 [S9][S11][S12] | 多种协议继续共存，可靠性取决于完整读取与写入循环 |

Aider 的 89 题 Python 重构实验中，`gpt-4-1106-preview` 从 SEARCH/REPLACE 的 20% 提升到 simplified unified diff 的 61%。这是特定历史模型与任务上的结果，不能推广为当前所有模型的预期提升。[S3]

Hashline 作者使用 React 文件的机械变异任务，报告 180 题、三次运行、多模型比较；当前页面表格也列出相对 replace 退步的模型，包括 DeepSeek V3.2。该证据支持建立模型与协议矩阵，不支持全面替换现有协议。页面带有后续修订结果，引用时应保留实验版本与采样日期，不能混用不同图表的数字。[S12]

## 3. 开源实现对比

| 项目 | 采样实现 | 有价值的机制 | 采用边界 |
|------|----------|--------------|----------|
| Aider | whole、SEARCH/REPLACE、udiff 等 [S1] | 为不同模型选择不同编辑格式 | 历史 benchmark 不等于 Chatbox 当前模型组合的结果 |
| SWE-agent | 经典 windowed edit + lint [S4] | 编辑反馈直接进入下一轮决策 | 语法门禁可能阻碍需要多个步骤完成的暂时不完整修改 |
| Codex | 自定义 patch，增删改移，上下文定位 [S7] | 逐级匹配空白与部分 Unicode 差异 [S8] | 多文件处理不是全局事务；后续失败可留下已发生变更 |
| OpenCode | old/new、replaceAll、多级 replacer [S6] | 文件锁、真实审批 diff、格式化与 LSP 错误反馈 | trim 与块相似匹配不能证明语义一致，不宜全量照搬 |
| Gemini CLI | exact、flexible、regex、fuzzy，可配置模型纠错 [S10] | 匹配策略观测、纠错时检查最新文件内容 | 模型纠错有额外时延和调用成本；源码存在配置及文件类型分支 |
| Pi | 单文件多处替换，对原始快照匹配 [S9] | 重叠拒绝、文件队列、BOM/EOL 处理、diff/patch、首个修改行 | 原始快照语义与 Chatbox 当前顺序语义不同 |
| Cline | v3.20.0 搜索替换；当前 SDK 另有 patch executor [S5][S11] | 将计算变更与落盘分开，支持真实 diff 预览及 EOL 保留 | executor 存在不代表所有模型、所有前端默认选用它 |
| nav | Hashline，另有 searchReplace 配置 [S13] | read/skim/search 与 edit 共享锚点 | 小项目采用不能证明规模化可靠性或模型普适性 |

Pi 的归一化工具还处理尾部空白、部分引号、连字符与特殊空格，并尝试保留未修改行。OpenCode 有更广的逐行、块锚点等恢复策略。对 Chatbox 的启发是按匹配层级记录成功与错误；不能把更宽松直接等同于更正确。[S6][S9]

## 4. Chatbox 调研基线

### 4.1 基线执行路径与契约

模型可传 `file_path + edits[]`，也可传单次 `old_text + new_text`。两种形式同时出现且 `edits` 非空时，目前优先使用 `edits`。数组按顺序应用，后续操作匹配此前操作修改后的内容，每次要求匹配唯一。

| 位置 | 已核对行为 |
|------|------------|
| [filesystem.ts](../../src/renderer/packages/model-calls/toolsets/filesystem.ts) | schema、参数选择、沙箱/真实路径分流、审批与模型输出；`editSandboxFile` 生成 Node 脚本 |
| [main.ts](../../src/main/main.ts) 的 `fs:edit` | 真实文件异步读取、逐项替换、最终写入 |
| [sandbox/manager.ts](../../src/main/sandbox/manager.ts) 的 `editFile` | 原生沙箱路径校验、逐项替换与最终写入 |
| [soul-file.ts](../../src/renderer/packages/model-calls/toolsets/soul-file.ts) | 虚拟文件替换；通过 `updateSoul` 在 mutation lock 内执行 |
| [file-mutation-stats.ts](../../src/renderer/packages/model-calls/toolsets/file-mutation-stats.ts) | 基于各 old/new 输入片段累计审批增删行数 |
| [edit-file-schema.test.ts](../../src/renderer/packages/model-calls/toolsets/edit-file-schema.test.ts) | 顶层 object schema、禁止组合关键字的兼容性约束 |

普通文件的替换在内存中完成，匹配失败时不写入。这是有价值的单次操作保障。成功结果目前主要包含路径与 edit 数量，错误主要是未找到或不唯一。

源码历史显示：2026-06-02 的 `571d78496` 引入 Agent Mode；2026-06-11 的 `c36b1a114` 调整 edit schema 的 OpenAI 兼容性；2026-06-28 的 `5d268e9f0` 改善工具模型输出；2026-07-15 的 `52f6788f7` 移除沙箱文件工具对 Bash 的依赖。实现优化必须保留现有多 Provider schema 和多后端运行约束。

### 4.2 差距与影响

| 当前事实 | 影响 | 建议方向 |
|----------|------|----------|
| 以 `indexOf` 精确匹配 | 多行 LF 请求与 CRLF 文件可能不匹配 | 匹配视图与原始内容分离，优先处理 EOL |
| 错误只给 edit 序号与短原因 | 模型难以区分重复、过期内容、换行或输入问题 | 有界候选上下文和结构化错误码 |
| 成功不提供实际 diff | 模型和用户不易确认最终修改范围 | 根据真实 before/after 生成 diff |
| 普通文件路径直接 read-modify-write，未见文件级协调 | 两个调用读取同一旧版本后，后写可覆盖先写 | write/edit 共享协调，检查过期预览 |
| 多条路径重复实现替换循环 | 修复可能只覆盖某个平台 | 可复用纯文本内核和统一测试夹具 |
| 统计累加每一项输入片段 | 多项连续修改同一区域时，不等于最终净变化 | 将操作次数与净增删行分开 |
| 空搜索、无变化未单独定义错误 | 反馈难理解，无变化可被记为有效编辑 | 明确输入与 no-op 契约 |

这里的并发结论针对已核对的普通文件入口。Soul 已有 mutation lock；后端自身的额外保障和 RN 原生工具能力需要在实施时分别核对。

## 5. 建议的执行契约

本节描述目标契约；已实现能力与仍待验证的边界按下方实现表区分。

### 5.1 分离计算和提交

```mermaid
flowchart LR
    A[解析与校验参数] --> B[后端授权和路径校验]
    B --> C[读取内容与版本]
    C --> D[计算替换和真实 diff]
    D --> E{已有授权是否覆盖}
    E -->|是| G[协调同文件修改并复核版本]
    E -->|否| F[展示 diff 并等待审批]
    F --> G
    G -->|版本相符| H[提交与结果记录]
    G -->|版本变化| I[拒绝过期提交并提供恢复信息]
    H --> J[有界 diff 与诊断反馈]
```

纯文本计算层负责匹配、变更范围、错误分类与 diff 数据；平台层负责文件读取、路径和符号链接约束、授权、版本复核与提交。远程沙箱不能直接导入宿主模块时，使用受控打包产物或同一套契约夹具验证语义，不强行把所有 I/O 收敛到 Renderer。

审批期间不长期占用文件锁。预览绑定内容版本，批准后在文件协调范围内复核；发生变化时，不把旧审批直接套用到不同的实际 diff。已有授权覆盖的操作继续直接执行，新增一致性检查不意味着每次新增审批。

### 5.2 匹配策略

建议第一阶段仅启用精确匹配和 EOL 兼容。BOM 在读取时单独处理并保留；不能为了匹配而把整个文件的 Unicode、缩进或尾空白重写。

后续可增加候选建议：忽略尾空白、缩进差异或块相似度用于生成“可能要编辑的位置”，默认不直接写入。Python 缩进、Markdown 两空格换行、字符串内空格和 Unicode 都可能有真实语义。

任何归一化都会改变匹配空间；必须在该空间重新检查歧义，并把替换范围映射回原始内容。多候选时返回歧义，不因某个候选先被遍历到就自动选中。

如增加替换全部的能力，应显式表达，并可携带预期匹配次数。它只表示文字替换，不承诺 AST 级符号重命名。

### 5.3 批量语义

Chatbox 当前使用顺序语义，第一阶段保持不变。对 `foo → bar`、`bar → baz`，第二项可能匹配第一项新生成的内容，或因为新增匹配而变得不唯一。

原始快照语义则先在同一份原文上定位全部操作，拒绝重叠或嵌套，再按偏移逆序应用。它更适合一次提出多个独立修改，但不能静默替换现有顺序契约。

将原始快照语义作为独立评测候选。只有明确工具版本、历史调用回放与暂停恢复行为后才切换；不为未发布的实验协议新增持久化兼容层。两个参数入口的兼容可以保留，但新模型提示只推荐一个规范形式，组合条件继续遵守现有顶层 schema 约束。

### 5.4 区分三种写入保障

| 保障 | 解决的问题 | 不能替代的能力 |
|------|------------|----------------|
| 全部匹配后才写 | 后续 edit 匹配失败不留下前半段修改 | 写入中断、并发覆盖 |
| 单文件原子替换 | 尽量避免截断或半写文件对读者可见 | 外部进程同时修改、断电耐久性、多文件事务 |
| 并发协调与版本校验 | 防止协调范围内的读改写冲突，发现过期内容 | 未参与协议的外部编辑器、远程后端原生 CAS 能力 |

同文件队列必须由该文件写入的共同所有者管理，覆盖 write 和 edit，并避免路径别名绕过协调。符号链接如何解析仍服从各后端现有授权语义。

“重新读一下 hash 再写”存在检查到写入之间的竞态，不应声称强 CAS。具备原生条件写入的后端使用其能力；不具备时明确只能降低冲突风险。临时文件加 rename 也需分别验证 Windows、权限/ACL、符号链接与失败清理，不能用一个通用写法宣称全平台原子性。

取消在实际写入完成后到达时，结果必须保留已修改事实，不能仅返回取消而诱导盲目重试。多文件协议如暂不提供事务，应准确报告已应用、未应用及状态不确定的文件。

### 5.5 错误与反馈

推荐的错误分类包括 `INVALID_EDIT`、`NOT_FOUND`、`AMBIGUOUS_MATCH`、`STALE_CONTENT`、`WRITE_FAILED`；成功结果另外区分 `changed` 与 `no_op`。具体命名在实现时与既有错误体系协调。

对模型输出示例：

```text
Status: error
Reason: AMBIGUOUS_MATCH
Edit: 2
Matches: 3
Candidate lines: 18, 47, 92
Applied edits: 0
Recovery: Read one candidate region and include enough surrounding text to make old_text unique.
```

候选正文与成功 diff 都设输出预算，超限提供行范围和重读提示。未找到时不推断一定由过期读取导致。错误内容继续遵守原文件读取授权，不将完整文件、敏感片段或用户路径上传到分析服务。

UI 展示真实 before/after 的 diff；模型收到紧凑 diff、净增删行数、修改范围与匹配策略。格式化等后置操作若改变文件，必须进入最终结果，不能只展示格式化前的变更。第一阶段无需默认执行格式化或启动 LSP。

## 6. 实施优先级与验收

本表是建议顺序，不是已启动的项目计划。正式排期时再按仓库计划生命周期登记 owner、状态与交付阶段。

| 阶段 | 工作范围 | 验收条件 |
|------|----------|----------|
| A：保持协议，补齐保障 | 统一替换契约；EOL/BOM；输入/no-op；结构化错误；真实 diff；同文件协调及审批版本复核 | 现有参数和顺序语义兼容；各后端夹具结果一致；匹配失败无写入；可控并发不丢改动；实际变化与显示一致 |
| B：受控恢复与批量评测 | 候选建议；评测原始快照语义；可选轻量诊断 | 误改率不增加；失败恢复调用成本下降；批量语义和历史恢复边界明确 |
| C：协议实验 | replace、patch、Hashline 的多模型比较 | 同预算对比完整循环成本；证明目标模型收益后才选择默认协议 |

阶段 A 中，诊断和 diff 与写入保障可按依赖拆分交付。后端不支持某项保障时报告实际覆盖，不把 mock 或共享内核单测当作平台落盘验证。

## 7. 评测设计

### 7.1 确定性契约测试

| 维度 | 必需样例 |
|------|----------|
| 文本表示 | LF、CRLF、混合换行、BOM、无末尾换行、中文、特殊空格、引号、Markdown 硬换行 |
| 定位 | 零匹配、唯一匹配、多匹配、重复函数、相似配置段、重叠出现的子串 |
| 参数 | 空 old、相同 old/new、空 edits、双入口输入、类型错误 |
| 批量 | 多处独立修改、前项生成后项目标、重叠/嵌套、最后一项失败 |
| 并发 | edit/edit、write/edit、审批期间外部修改、路径别名、取消与写入交错 |
| 落盘 | 写入失败、空间不足、临时文件清理、权限保留、真实后端支持范围 |
| 反馈 | 真实 diff、净增删数、候选截断、部分成功与状态不确定的准确报告 |

### 7.2 多模型任务评测

固定模型精确 ID、Provider/API、采样参数、提示词、工具描述、文件内容、调用和 token/时间上限。每个任务运行在独立临时工作区，使用相同任务集合和多个重复样本，记录逐任务配对差异、样本量与不确定性。

协议比较应有两组：只变更编辑协议的受控比较，以及允许配套 read/search 输出变化的完整系统比较。Hashline 必须计入读取锚点的输入 token，patch 必须计入解析失败的重试，模型纠错必须计入隐藏调用。

任务覆盖代码与 Chatbox 常见文档：局部修复、跨段落修改、重复文本消歧、中文 Markdown、JSON 配置、大文件小改动、多文件修改、读取后文件变化。机械变异适合检查执行正确性；真实任务还需要测试和人工核对，不能仅靠与唯一参考文件逐字相等判定正确。

| 指标 | 定义 |
|------|------|
| 首次正确编辑率 | 第一次提交即定位正确且符合任务要求，不只统计工具返回 success |
| 预算内任务成功率 | 在同一调用/token/时间预算内完成任务 |
| 误改与无关变化 | 修改错误区域、改变未授权区域或未触及内容的比例 |
| 恢复成本 | 失败后额外读取、编辑和模型纠错调用数 |
| 完整成本 | read→edit→retry 的全部输入/输出 token、调用费用和耗时分布 |
| 状态可靠性 | 部分写入、并发丢改动、错误成功报告、取消后状态误报 |

不以“应用成功率上升”单独批准宽松匹配；任务正确率与无关变化是共同验收条件。某模型获益不自动推广到同一供应商的其他模型；协议在会话内保持稳定，切换需有明确理由。

真实 API 凭据只通过现有受管机制加载。多模型协议评测尚未执行；本次生产代码改动需通过当前 PR HEAD 的 AI API live gate，用户可见 diff 的真实应用 QA 与验证结果记录在 PR 中。

## 8. 来源与复核入口

采样日期均为 2026-09-14。可固定的源码使用 commit permalink；标为历史版本的资料只证明该版本行为，动态页面用于原作者说明或历史记录。

- **S1**：[Aider Edit formats](https://aider.chat/docs/more/edit-formats.html)。格式名称、whole/diff/udiff 与模型选择。
- **S2**：[Aider Release history](https://aider.chat/HISTORY.html)、[v0.19.0 release](https://github.com/Aider-AI/aider/releases/tag/v0.19.0)。历史变更与发布时间。
- **S3**：[Aider unified diff 实验](https://aider.chat/docs/unified-diffs.html)。89 题重构测试及 20%→61% 的边界。
- **S4**：[SWE-agent ACI](https://github.com/SWE-agent/SWE-agent/blob/main/docs/background/aci.md)。经典窗口化编辑和 lint 设计；不代表所有当前配置。
- **S5**：[Cline v3.20.0 diff.ts](https://github.com/cline/cline/blob/v3.20.0/src/core/assistant-message/diff.ts)。历史 SEARCH/REPLACE 实现。
- **S6**：[OpenCode edit.ts](https://github.com/anomalyco/opencode/blob/df23b7f9488a38e6f8064a0739d4f8cde86d7cfb/packages/opencode/src/tool/edit.ts)。多级匹配、文件锁、diff、格式化和 LSP。
- **S7**：[Codex parser.rs](https://github.com/openai/codex/blob/3abbf9fe2c6b6910e9de61f6a0c5bb468f74b5c8/codex-rs/apply-patch/src/parser.rs)、[lib.rs](https://github.com/openai/codex/blob/3abbf9fe2c6b6910e9de61f6a0c5bb468f74b5c8/codex-rs/apply-patch/src/lib.rs)。自定义 grammar、文件操作和部分落盘边界。
- **S8**：[Codex seek_sequence.rs](https://github.com/openai/codex/blob/3abbf9fe2c6b6910e9de61f6a0c5bb468f74b5c8/codex-rs/apply-patch/src/seek_sequence.rs)。逐级空白及 Unicode 匹配。
- **S9**：[Pi edit.ts](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/edit.ts)、[edit-diff.ts](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/edit-diff.ts)。原始快照批量语义、文件队列、归一化与结果反馈。
- **S10**：[Gemini CLI edit.ts](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/tools/edit.ts)、[editCorrector.ts](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/utils/editCorrector.ts)。策略记录和有条件的模型纠错。
- **S11**：[Cline SDK apply-patch.ts](https://github.com/cline/cline/blob/main/sdk/packages/core/src/extensions/tools/executors/apply-patch.ts)。动态开发分支采样；compute/apply 分离、换行处理与预览入口。
- **S12**：[Hashline 原始实验](https://stencil.so/blog/the-harness-problem)。原日期 2026-02-12，页面包含后续修订表格；数据未独立复现。
- **S13**：[nav 仓库](https://github.com/sandst1/nav)。动态开发分支采样；Hashline 与 searchReplace 配置。

相关文档：[工具与集成系统](./tools-and-integrations.md)、[Chat 代码执行](./code-execution.md)、[Agent Soul 与 Memories](./agent-soul-memories.md)。
