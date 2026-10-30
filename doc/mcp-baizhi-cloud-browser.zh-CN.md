# 在 Chatbox 中连接百智云浏览器

[English](./mcp-baizhi-cloud-browser.md)

[百智云浏览器](https://baizhibrowser.cloud/zh/)（Baizhi Cloud Browser，也即
CapyBrowser）通过 MCP 提供运行、档案、人工交接和下载管理。网页导航、点击和读取
需要 Agent 已有兼容 CDP 客户端；连接此 MCP 不会自动安装页面工具或替换 Chatbox
的浏览器能力。

百智云浏览器与 Baizhi Cloud Agent Toolkit 同属百智云，是两个独立服务。
单独配置本连接的凭据，不假定 Toolkit 应用专用 Key 可用于浏览器。应用 Key
及平台个人 Key 的当前适用方式以[浏览器接入指南](https://capybrowser.app.baizhi.cloud/docs/installation.md)为准。
浏览器启动和运行按服务定价计费。

## 添加自定义 HTTP 服务

使用提供 **设置 → MCP → 自定义 MCP 服务器** 的 Chatbox 版本。
此说明复用现有自定义表单，不依赖市场条目。

1. 选择 **添加服务器 → 添加自定义服务器**。
2. 名称填写 `百智云浏览器`，类型选择 **远程（http/sse）**，协议保持 **自动（推荐）**。
3. URL 填写 `https://capybrowser.app.baizhi.cloud/mcp`。
4. 在 **HTTP Header** 中按表单的 `NAME=VALUE` 格式填写一行：

   ```text
   Authorization=Bearer <自己的浏览器 Key>
   ```

   在本地用本人 Key 替换占位符，只保留一个 `Bearer` 前缀。此处是普通文本输入区，
   不是专用密码框；不要分享其中的内容、含 Key 的截图或设置导出。本指南不承诺
   凭据已加密保存。
5. 核对目标地址和请求头，点击 **连接**；检查显示的工具或连接错误后再 **保存**。
   保存配置或发现工具不代表每个工具均有权限，也不代表完整网页任务已能运行。

新增自定义条目默认启用；不需要使用时关闭条目开关，不要将占位凭据留在已启用
连接中。此示例不改模型设置、不安装本地代理、不自动批准工具。

## 使用、更换凭据与移除

创建运行前阅读接入指南，核对身份、价格及 Agent 的 CDP 页面工具。
人工操作时暂停 Agent，保留同一运行，交还控制后再继续。结束自己创建的运行，
分别核对资源释放和最终账单；观看、等待、断开或禁用 MCP 不会结束运行或停止计费。

更换 Key 时 **编辑** 同一条目，替换 Authorization 行，重新连接再保存。
认证失败时检查 Key 的适用范围和单个 Bearer 前缀，不要反复重试可能计费的工具。
禁用时关闭条目开关；移除时选择 **编辑 → 删除** 并确认，只操作该条目，保留其他
连接。移除本地连接不等于撤销云端 Key 或结束已创建的云端运行。

工具输入发送至百智云，网页操作会访问目标站点；使用前审阅服务条款与隐私说明。
账号与服务问题可查看[控制台](https://capybrowser.app.baizhi.cloud/)及
[接入指南](https://capybrowser.app.baizhi.cloud/docs/installation.md)。

## 维护与支持

[配置示例源码](https://github.com/ctcbyzx/chatbox/blob/fd229d87d6e2659724e8e3c95c3c862fd59901a2/doc/mcp-baizhi-cloud-browser.zh-CN.md)。

维护者：[ctcbyzx](https://github.com/ctcbyzx)（[Chaitin 公共接入仓](https://github.com/chaitin/baizhi-cloud-browser)贡献者）。更多接入方式见[公开接入材料](https://github.com/ctcbyzx/baizhi-cloud-browser)。

配置问题可到[接入维护仓 Issues](https://github.com/ctcbyzx/baizhi-cloud-browser/issues)反馈，附客户端版本和脱敏错误信息。账号或账务问题请通过服务控制台处理。
