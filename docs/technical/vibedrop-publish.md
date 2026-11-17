# HTML Artifact 发布：VibeDrop 集成设计

> Last updated: 2026-07
>
> Status: Implemented；三个仓库的交付 PR 已合并，运行时集成仍依赖部署环境中的服务绑定与密钥。
>
> 替换原 EdgeOne MCP 匿名发布，改为可登录、可管理的 VibeDrop 集成。

## 背景与目标

改造前 HTML artifact 的「发布」走 EdgeOne（`src/renderer/packages/edgeone.ts`，纯 renderer 直连 `mcp.edgeone.site`），**完全匿名**——只带随机 `X-Installation-ID`，无用户身份，用户发布后无法管理已发布的站点。

目标：
- 登录 chatboxai 的用户可直接发布到 VibeDrop，之后在 VibeDrop 用同一邮箱登录即可管理发布过的站点。
- 发布时弹 modal，用户可选「公开 / 仅通过链接访问」，并提示可在 VibeDrop 管理。
- 未登录则引导登录 chatboxai。
- chatbox-backend 与 VibeDrop 打通鉴权：backend 作为「可信 partner」为用户签发 VibeDrop key，VibeDrop 信任并记录 key+内容来源为 chatbox。
- VibeDrop 提供内容广场，展示公开页面，worker 实时分类打标 + 截图预览。

## 关键发现

VibeDrop（Cloudflare Workers + Hono + D1 + R2 + KV）**已预留 partner 通道**：
- `POST /v1/integrations/issue-key`：`Bearer <partner-secret>` + `{email}` → upsert 用户、签发 `vd_p_xxx` key 绑定该 email、记 `issuedBy=partner`。
- `POST /v1/sites/inline`：`{html, title?, slug?}` 部署单页，返回 `{site, claimUrl}`。
- `GET /v1/auth/me`：用户 magic-link 登录后，同邮箱下 partner 签发的 key 及其站点自动出现（无需 claim）。

chatbox-backend：email 为主键身份（邮箱验证码登录，email 已验证），客户端持 JWT（`x-chatbox-access-token`，`TokenChecker` 解出 email），已有 HMAC 签名 / 阿里云 Green 审核（`pkg/services/guardrail`，`TextModerationPlus` service `query_security_check_pro`，`RiskLevel=high` 拒绝，fail-open）等成熟模式。

## 锁定的决策

| 维度 | 决定 |
|---|---|
| chatbox tier | **不过期、不限站点数**、单站点 64MB、`inline` 上限提到 16MB、**保留广告条**、无密码/自定义域名 |
| 鉴权 | 客户端经 backend `issue-key` 拿 `vd_p` key（backend 幂等缓存），再直连 VibeDrop 发布 |
| 默认可见性 | 仅通过链接访问（`unlisted`） |
| 重复发布 | 复用 slug 覆盖更新（slug 存 session 消息元数据） |
| EdgeOne | 直接替换移除 |
| 未登录 / 无邮箱 | 引导登录 chatboxai；**chatbox 用户必须有邮箱**，无邮箱时提示绑定 |
| 内容审核 | VibeDrop 侧新增阿里云 Green 审核，镜像 backend 语义 |
| 截图/打标 worker | Cloudflare Queue 实时消费 |

## 数据流

```
① 用户已登录 chatbox（JWT，email 已验证）
② 点发布 → modal（选 公开 / 仅链接）
③ 客户端 → chatbox-backend  POST /api/vibedrop/issue-key（带 JWT）
     backend 取 email（空则返回 email_required）
     查 vibedrop_keys 表命中则返回；未命中 → 调 VibeDrop /v1/integrations/issue-key
       Bearer <PARTNER_SECRET> + {email} → vd_p_xxx（tier=chatbox, issuedBy=chatbox）
     存表幂等，返回 {vd_key, tier}
④ 客户端缓存 key（按邮箱），直连 VibeDrop  POST /v1/sites/inline
     Bearer vd_p_xxx + {html, title, visibility, slug?}
     → {url, slug}
⑤ modal 展示 URL + 「用 chatbox 邮箱登录 app.vibedrop.cc 管理」
```

## 分仓实施

### chatbox-backend（worktree `chatbox-backend-vibedrop`）
- 新表 `vibedrop_keys(id, user_email uniqueIndex, vd_key, vd_key_id, tier, created_at, updated_at)` + model + repo，做幂等复用。
- `config.yaml`：`vibedrop.partner_secret`（env `VIBEDROP_PARTNER_SECRET`）、`vibedrop.api_base`。
- `internal/api/controllers/vibedrop-controller.go`：`POST /api/vibedrop/issue-key`（`TokenChecker`）。email 空 → `email_required`；命中表直接返回；否则调 VibeDrop 签发并存表。
- `internal/api/app.go` 注册路由。

### vibedrop-server（worktree `vibedrop-server-vibedrop`）
- **Schema + 迁移 `0004_*.sql`**：`sites` 加 `visibility('unlisted'|'public', default unlisted)`、`tags(JSON)`、`previewStatus(default pending)`、`moderationStatus(default pending)`；`apiKeys.tier` 放开含 `'chatbox'`。
- **TIERS**（`lib/shared.ts`）：新增 `chatbox { ttlHours:Infinity, maxSites:Infinity, maxSizeMB:64, ads:true, password:false, customDomain:false }`；`Tier` 类型联合同步扩展；`inline` 上限 1MB→16MB。
- **issue-key**（`routes/integrations.ts`）：partner→tier 映射，chatbox partner 签发 `tier:'chatbox'`。
- **publish**（`routes/sites.ts` + `lib/publish.ts`）：接收 `visibility`；`computeSiteExpiry` 对 chatbox 返回不过期；`syncClaimedKeyToPlan` 优先级 `pro>chatbox>free`；`toSiteDTO` 回传 visibility/url。
- **serving**（`apps/serving/src/index.ts`）：`public` 去 noindex，`unlisted` 保留。
- **阿里云审核**（新 `lib/moderation.ts`）：Worker 内调 Green（签名 v3，AK/SK secret binding），文本 `TextModerationPlus`，`RiskLevel=high` 拒绝，fail-open。`public` 发布同步过文本审核，图片审核入 queue。
- **Queue worker**（新 `apps/processor/`）：publish 成功且 public → 入队；消费：截图（Browser Rendering）→ R2 → 回写 ogImage/previewStatus；AI 分类打标 → tags；图片二次审核。
- **广场**（`routes/explore.ts` + dashboard/web 页）：`GET /v1/explore` 返回 `public AND approved AND ready`。
- **举报/下架**：`POST /v1/sites/:slug/report` + 管理端下架。

### chatbox-pro（worktree `chatbox-pro-vibedrop`）
- `src/renderer/packages/vibedrop.ts` 替换 `edgeone.ts`：`issueVibedropKey()`（调 backend）+ `publishToVibedrop()`（直连 inline）。
- settings 缓存 key（按邮箱），账号切换/登出清理。
- `src/renderer/modals/VibedropPublish.tsx`：未登录引导 / 无邮箱提示 / 可见性选择（默认 unlisted）/ 成功态 URL + 管理入口。
- `src/renderer/components/Markdown.tsx`：`onClickDeploy` 改打开新 modal；首发 slug 存消息元数据，再发复用 slug 覆盖更新。
- HTML artifact 发布按钮由 `vibedrop.ts` 和 `VibedropPublish.tsx` 承接；builtin `edgeone-pages` MCP 作为独立的模型侧发布工具继续保留。
- i18n：源码加 key，`pnpm translate` 生成，勿手改 locale JSON。

## 接口契约

```
# backend
POST /api/vibedrop/issue-key            Header x-chatbox-access-token
  → 200 { vd_key, tier }
  → 400 { error: "email_required" }

# vibedrop
POST /v1/integrations/issue-key         Bearer <partner_secret>
  { email } → 201 { key, keyId, userId, tier:"chatbox" }
POST /v1/sites/inline                   Bearer <vd_key>
  { html, title?, slug?, visibility } → { site:{ slug, url, visibility } }
GET  /v1/explore?cursor=&tag=           → { items:[{slug,title,ogImage,tags,url}], nextCursor }
POST /v1/sites/:slug/report             { reason }
```

## 里程碑 / 依赖

```
M1 backend issue-key + 表        ─┐
M2 vibedrop tier/visibility/inline ┼─ 主链路 MVP（可登录发布+管理）
M3 chatbox-pro 发布链路 + modal   ─┘
M4 vibedrop 阿里云审核（public 前置）
M5 vibedrop Queue worker（截图+打标）
M6 vibedrop 广场 explore + 举报下架
```

## 配置 / 密钥

- **backend**：`vibedrop.partner_secret`（env `VIBEDROP_PARTNER_SECRET`）、`vibedrop.api_base`。
- **vibedrop api**：secret `PARTNER_KEYS="chatbox:<secret>"`、`ALIYUN_GREEN_AK`/`ALIYUN_GREEN_SECRET`（可选 `ALIYUN_GREEN_REGION`/`ALIYUN_GREEN_ENDPOINT`）；binding `PREVIEW_QUEUE`（producer，队列 `vibedrop-preview`）；迁移 `0004`、`0005`。
- **vibedrop processor**（新 worker `apps/processor`）：consumer 绑定 `vibedrop-preview` + DLQ；R2 `SITES`、KV `META`、D1 `DB`；Browser Rendering `BROWSER`；Workers AI `AI`。

## 实施状态（2026-07）

三个 repo 的 `feat/vibedrop-publish` 交付 PR 均已合并：
- chatbox-backend [#473](https://github.com/chatboxai/chatbox-backend/pull/473)
- vibedrop-server [#1](https://github.com/themez/vibedrop-server/pull/1)
- chatbox-pro [#796](https://github.com/chatboxai/chatbox-pro/pull/796)

M1–M6 全部完成并通过本地可验证项（backend `go build`；vibedrop `turbo typecheck` 6 包 + `vitest` 132 通过；chatbox-pro tsc 对改动文件 0 回归）。运行时依赖（阿里云签名、Browser Rendering 截图、Workers AI 打标、Queue）需线上部署绑定 + 密钥后端到端验证。

## 开放项（不阻塞主链路）

- Browser Rendering / Workers AI 套餐与成本。
- 广场热度排序、AI 打标的预定义标签集。
- 审核 fail-open 时 pending 内容是否先对 public 隐藏（建议是）。
