# 产品分析上报

> Last updated: 2026-07

Chatbox 同时使用 Google Analytics（GA）和 Plausible。两者的用户识别方式不同，因此不能直接比较默认的
Active users 与 Unique visitors。

## 指标职责

| 目标 | 统计口径 | 数据源 |
|------|----------|--------|
| 客户端 DAU | 当天触发 `app_open` 的去重安装 UUID | GA |
| 页面访问与功能趋势 | Pageview、路由与自定义事件 | Plausible |
| Web 访问 | `web.chatboxai.app` 的访问趋势 | Plausible |

Plausible 使用每日变化的 IP 与 User-Agent 指纹识别访客。移动网络、Wi-Fi 和 VPN 切换可能让同一安装在一天内
产生多个访客标识，因此 Plausible 的 Unique visitors 不作为客户端安装 DAU。

## `app_open` 事件

渲染进程在应用启动及重新进入前台时发送 `app_open`：

- `client_id` / `user_id` 使用配置中持久化的安装 UUID；
- `session_id` 使用本次前台会话的 Unix 时间戳，超过 30 分钟后创建新会话；
- `engagement_time_msec` 记录页面或应用在前台停留的时间；
- `chatbox_platform_type` 区分 `desktop`、`mobile` 与 `web`；
- `chatbox_platform` 记录产品识别到的具体系统，例如 `darwin`、`win32`、`linux`、`ios` 与 `android`；
- `app_platform` 保留底层运行时报告的平台。

GA 报表应按 `event_name = app_open` 查看 Total users，并按平台维度拆分。不要把混合平台的 GA 属性直接与单个
Plausible 域名比较。

## 授权边界

GA、Plausible、JK 和 Sentry 都必须在设置迁移及用户授权状态加载后初始化。关闭“错误报告和事件追踪”时：

- 不初始化 GA；
- 取消待发送的 `app_open`；
- 设置 GA disable flag，阻止网页脚本继续自动收集；
- 其他分析和错误上报继续遵守各自的运行时授权检查。
