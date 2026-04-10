# Chatbox 验证码登录改造计划（阶段一）

## 背景

当前 Chatbox 账号登录流程依赖 `ticket_id + 浏览器 + 官网授权 + app 轮询`。这条链路对用户来说过于绕，尤其是在 app 内登录场景中，用户需要离开当前界面去浏览器完成授权。

阶段一的目标是把 `chatbox-pro` 中的 Chatbox 账号登录改为应用内邮箱验证码登录，同时保持已登录用户、token 刷新、license 自动激活等既有行为不变。

## 当前链路

1. app 点击登录
2. 请求 `request_login_ticket`
3. 打开官网 `/authorize?ticket_id=...`
4. 用户在官网登录并确认授权
5. app 轮询 `login_status`
6. 成功后拿到 access/refresh token

## 目标链路

1. app 点击登录
2. 弹出验证码登录 modal
3. 用户输入邮箱，调用 `send_email_login_code`
4. 用户输入验证码，调用 `login_or_signup_with_email_code`
5. app 直接获得 access/refresh token
6. 写入本地 token，进入已登录态
7. 按既有逻辑加载 profile、licenses，并自动激活 license

## 第一阶段范围

- 仅修改 `chatbox-pro`
- 完全停用 app 前端对旧 `ticket_id` 登录链路的调用
- 新增 app 内邮箱验证码登录 modal
- 使用新接口：
  - `POST /api/auth/send_email_login_code`
  - `POST /api/auth/login_or_signup_with_email_code`
- 保持现有 token refresh、license 激活、退出登录逻辑不变

## 第二阶段预案

- 官网 `/login` 改为邮箱验证码登录
- app 在跳官网前调用 `/api/auth/web_auth_token/generate`
- 官网收到 `web_auth_token` 后调用 `/api/auth/web_auth_token/exchange` 自动登录

## 升级兼容策略

- 旧版本升级上来的已登录用户保留现有登录态
- 不强制清空 `authInfoStore`
- 新版本只影响“再次登录”入口
- 旧 ticket 登录后端接口继续保留，兼容旧版本 app 与官网现有流程

## 接口约定

### 发送验证码

`POST /api/auth/send_email_login_code`

请求体：

```json
{
  "email": "user@example.com",
  "lang": "en"
}
```

响应体：

```json
{
  "data": {
    "result": "sent"
  }
}
```

### 验证验证码并登录

`POST /api/auth/login_or_signup_with_email_code`

请求体：

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

响应体：

```json
{
  "data": {
    "access_token": "...",
    "refresh_token": "..."
  },
  "success": true
}
```

## 验收项

- 已登录升级用户升级后仍保持登录态
- 未登录用户点击登录后只出现验证码 modal，不再打开浏览器
- 发送验证码成功后进入验证码输入阶段
- 验证码正确后 token 被正确写入本地并进入已登录态
- 登录成功后现有 license 查询与自动激活逻辑仍正常工作
- token 过期后现有 refresh 流不受影响
