# 移动端本地工作模式

> Last updated: 2026-09

React Native 与 Capacitor 移动端使用会话 `settings.agentMode`，沿用桌面端的聊天/工作模式选择和消息操作策略。执行与系统工具不要求 Chatbox License，也不依赖 Chatbox API。模型请求仍使用用户配置的提供方。

## 执行与文件

共享 `LocalWorkMode` 按会话串行调度完整工具操作，包括工作区快照、执行和文件提交。`MobileExecutionService` 调度独立 WebView Worker，QuickJS 在其中解释模型生成的 JavaScript。React Native 使用隐藏 WebView，Capacitor 使用隔离 iframe 承载 Worker；应用主上下文不执行生成代码。每次脚本使用新上下文，文件跨调用持久化。

Worker 随应用打包，包含 QuickJS WASM、ExcelJS 和 PptxGenJS；不从 CDN 下载运行时。Metro、Vite 和类型检查调用根目录 `scripts/build-mobile-work-worker.cjs` 生成被忽略的资源文件。代码执行没有网络、Node、Shell 或原生 App 桥接；系统能力通过独立工具访问。

限制为每个文件 10 MiB、执行工作区 20 MiB、128 个文件；QuickJS 堆上限 32 MiB，执行期限 20 秒，宿主额外提供超时和 Worker 销毁。文档库运行在 Worker 内，其内存不属于 QuickJS 堆；额外限制实际 ZIP 解压量、单元格、幻灯片和元素数。切后台、取消或执行进程退出会中断任务；后续执行应检查已保存文件。

工作附件保留本地原始字节。输入目录只读，成果通过 `create_download` 复制并写入共享 Blob 存储。成果引用参与标准会话备份资源收集和恢复映射，因此在另一设备恢复备份后可重建本地成果。删除会话时停止相关执行，等待在途文件操作结束后清理该会话的本地工作区（包括输入、副本和成果）；迟到的写入不能重建已删除目录。导入同 ID 会话后重新启用工作区。中间工作区文件不包含在备份中；恢复后可打开或分享已交付成果，继续执行时从附件重建工作区。

## 文档和网站

默认工具包括文件读写、`parse_file`、代码执行、成果交付与 `load_skill({name})`。`list_files` 可按相对目录过滤；`search_files` 做有结果上限的字面量文本搜索；`edit_file` 按唯一原文依次替换，全部匹配后才写入文件。`read_file` 使用零起点字符分页，二进制文件需交给对应图片或文档工具。

DOCX、XLSX 和 PPTX 的纯文本解析复用 Worker 中的本地解析服务。普通聊天上传附件时也可使用，不要求工作模式、Skill 或 Chatbox license；RN 与 Capacitor 的 Document Parser 设置提供 Local 选项，普通附件的本地解析失败时沿用桌面端的 License 条件回退到 Chatbox AI 云端解析并消耗算力；显式关闭解析或选择第三方解析器的配置仍受尊重。`parse_file({path})` 将正文存到 `parsed/` 下的文本文件，仅返回路径、最多 512 字符预览和截断标记，再通过 `read_file` 分页读取。普通附件正文沿用 Blob 存储与附件上下文机制。解析输入上限 10 MiB、输出上限 100000 字符；超出安全结构限制的文档报错。解析请求与代码执行共用可销毁 Worker 宿主，但不创建 QuickJS VM，也不初始化文档生成器。

随应用提供 documents、spreadsheets、presentations、websites 四个任务 skill，按需返回 Word 文本、Excel、PPT 和静态网站的运行时说明。所有文件和文档方法均需 await。`docs.readDocument` 读取 DOCX 主文及表格文本，`docs.readPresentation` 按幻灯片顺序读取 PPTX 文本，保留段落、制表符和显式换行；不提供版面渲染、图片提取或 PDF 解析。Excel 支持 xlsx，计算由 JavaScript 完成，不重算公式；读取后写出的是新数据表，不保留原样式、图表及公式。PPT 创建支持文字、图片、表格和形状。

视觉模型可使用 `view_image` 查看工作区 PNG、JPEG、GIF、WebP 和 BMP。宿主在读取尺寸上限检查后缩小图片，非 JPEG 源以 PNG 保留透明度；每个请求最多携带最近五张工具图片。结果只持久化共享 `image_storage_key` 引用，支持原生工具图片的协议直接携带图片，Chat Completions 协议在工具结果后追加真实用户图片消息。RN 使用与 Expo SDK 匹配的原生图片处理模块，Capacitor 使用 Canvas。

网站交付将经典 HTML/CSS/JS 与本地资源打包为独立 HTML，使用无 App 原生桥接的受限预览容器。可信外层 CSP 与不共享来源的内层 iframe 阻止网络请求、自动跳转、表单提交和远程子框架，本地脚本及交互继续可用；RN 同时限制原生导航。支持经典脚本及 CSS 引用；ES modules、Node/npm 项目、多页面导航和运行时本地 fetch 需要先构建为独立前端产物。缺失资源和不支持的静态引用返回明确错误。

## 内置 Skill 与按需权限

能力菜单沿用桌面端的 Chat / Work 选择，展示联网搜索和系统服务。两端在模型不支持工具调用时禁用工作模式；草稿含附件时禁止切换模式。设备服务在工作模式下可用。执行期间需保持应用在前台；进入后台会中断当前执行，用户返回后可重试消息。设置 → Skills 展示 documents、spreadsheets、presentations、websites 四个内置 Skill 的用途及开关，Agent 菜单提供同页入口。开关存入全局 `mobileSkillPreferences`，下一次请求生效；spreadsheets、presentations 默认关闭，其余 Skill 默认开启。设备服务由会话设备服务选择、宿主支持和系统授权控制。关闭的内容 Skill 不进入目录；Worker 拒绝对应的 docs 方法。基础文件工具与 `parse_file` 不受 Skill 开关影响。文档库在首次调用获准的文档方法时初始化。系统服务收于 Device services 子菜单；主菜单在有服务启用时显示数量，子菜单可返回一级菜单。系统服务默认关闭，选择存入会话 `settings.localWorkCapabilities`。已启用且宿主可用的 photos、calendar、reminders、health 会作为内置 skill 出现在目录中；关闭的能力不注册，生成期间锁定能力选择。

模型最初只获得 skill 的 name、description 简短目录和基础工具。调用 `load_skill({name})` 后返回完整 instructions，并让对应系统工具的 schema 从下一模型步骤开始可见；加载本身不查询数据、不申请系统权限。文件和任务 skill 只加载所需编程说明，不打开无关系统服务。内部工具注册与模型可见工具通过 `prepareStep.activeTools` 分开。

`src/shared/skills/catalog.ts` 定义跨宿主 `SkillCatalog` 和 `LoadedSkill`，复用现有 `SkillMetadata`。桌面与移动端共用加载结果的文本格式；移动端的 `builtin-skills.ts` 提供适配 QuickJS、files/docs 和本地系统工具的内容。桌面文件目录与 Electron controller 留在桌面适配器中。移动目录只包含随应用打包的内置内容；不提供第三方 skill 安装或从服务端下载 skill。

照片选择使用系统选择器；iOS 原生模块提供照片保存、日历、提醒事项及 HealthKit。日历创建申请仅写权限，读取/修改申请完整权限；重复事件修改交给系统日历。健康按类型申请只读权限，返回步数、限定区间的合并睡眠时长或运动汇总。空读取不能用来判断拒绝授权。

系统操作前显示本地化的任务级授权，日期按设备时区显示，全天事件注明不含结束日期。提醒事项的完成确认使用本次请求已读取或创建的标题；未知 ID 需先读取提醒事项。照片保存显示文件名。健康汇总发给当前模型提供方前明确披露接收方。工具调用和代码执行权限分离。原生写操作一旦已提交，返回真实写入结果；取消不声称撤销已发生的系统变化。

系统服务的数据发送提示使用用户配置的提供方名称和模型名称。可复用的读取授权以独立的提供方与模型身份区分，同名提供方不共享授权。

移动 Skill 设置独立于桌面 `skills` 配置。字段缺失时按上述默认值解析，已发布版本的数据无需迁移；设置备份和导入通过统一设置 schema 保留这些布尔偏好，存储增量不超过四个开关；schema 仅保留这四项内容偏好，设备服务选择独立存储于会话设置。
