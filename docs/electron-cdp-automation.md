# Electron CDP Automation Guide

Chatbox 桌面端基于 Electron 26 (Chromium 116)，通过 Chrome DevTools Protocol (CDP) 实现 UI 自动化。本文档记录了实际操作中的经验、陷阱和最佳实践。

## 启动

```bash
# 标准启动（使用用户默认数据目录）
pnpm exec electron-vite dev -- --remote-debugging-port=9333

# 使用独立数据目录（推荐用于测试/截图）
pnpm exec electron-vite dev -- --remote-debugging-port=9333 --user-data-dir=/tmp/chatbox-test
```

> **注意**: `ELECTRON_EXTRA_LAUNCH_ARGS` 环境变量不可靠，始终使用 `--` 分隔符传参。

### 端口管理

- Chrome 常占用 9222，建议使用 9333 等其他端口
- 启动前必须彻底清理：

```bash
pkill -9 -f "electron"
sleep 3  # 等待端口释放
```

- **验证启动成功**: 日志中必须出现 `DevTools listening on ws://...`，否则 CDP 端口没有绑定成功
- **端口残留陷阱**: 进程被杀后端口可能残留（TCP TIME_WAIT），新实例无法绑定（日志报 `Cannot start http server for devtools`），但旧端口仍可连接。此时所有 CDP 操作（包括 `Page.captureScreenshot`）都会永久超时

## 连接

Playwright / agent-browser 的 `connectOverCDP` 与 Electron 26 不兼容，必须用原始 WebSocket：

```js
const WebSocket = require('/path/to/chatbox-pro/node_modules/ws')

const pages = await (await fetch('http://127.0.0.1:9333/json')).json()
const page = pages.find(p => p.title === 'Chatbox')  // 过滤 DevTools 页面
const ws = new WebSocket(page.webSocketDebuggerUrl)
```

### 基础 CDP 封装

```js
let msgId = 1

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++
    const timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 60000)
    function handler(data) {
      const msg = JSON.parse(data.toString())
      if (msg.id === id) {
        clearTimeout(timeout)
        ws.off('message', handler)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

// Runtime.evaluate 封装 — 注意 IIFE 包裹
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', {
    expression: `(function() { ${expr} })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}

// 初始化
await send('Page.enable')
await send('Runtime.enable')
```

## 等待应用加载

React 应用挂载到 `#root`，之前会显示 splash screen：

```js
for (let i = 0; i < 30; i++) {
  const len = await evaluate(`return document.getElementById('root')?.innerHTML?.length || 0`)
  if (len > 100) break
  await sleep(1000)
}
await sleep(3000) // 额外等待 React hydration 完成
```

## 数据目录与配置

### config.json 格式

`--user-data-dir` 下的 `config.json` 是应用的持久化存储。关键注意：

- **必须使用正确的 configVersion**: 当前为 `15`；更高的伪造版本会跳过必要迁移，更低的版本会重复执行历史迁移
- **zustand persist version**: settings 中的 `__version` 字段对应 zustand persist 版本，当前为 `6`
- **最佳实践**: 先用默认目录启动一次，复制生成的 config.json 作为基础模板

```bash
# 1. 用默认目录启动一次
pnpm exec electron-vite dev -- --user-data-dir=/tmp/chatbox-base
# 2. 等应用加载完后关闭
# 3. 复制作为模板
cp /tmp/chatbox-base/config.json /tmp/chatbox-test/config.json
# 4. 修改需要的字段
```

### 通过 IPC 读写配置

```js
// 读取
const settings = await evaluate(`
  return new Promise(async (r) => {
    const s = await window.electronAPI.invoke('getStoreValue', 'settings')
    r(JSON.stringify(s))
  })
`)

// 写入（注意 value 需要 JSON.stringify）
await evaluate(`
  return new Promise(async (r) => {
    const s = await window.electronAPI.invoke('getStoreValue', 'settings') || {}
    s.language = 'en'
    await window.electronAPI.invoke('setStoreValue', 'settings', JSON.stringify(s))
    r('ok')
  })
`)
```

> **陷阱**: IPC 写入的值不会自动反映到 zustand store state。zustand persist 使用 `skipHydration: true`，只在初始化时加载一次。修改 IPC store 后需要 `Page.reload` + 重新连接 WebSocket。

### License 激活

仅设置 `licenseKey` 不够，`isPremium` 检查需要 `licenseInstances[licenseKey]` 有值：

```bash
# 1. 调用激活 API 获取 instanceId
curl -X POST https://api.chatboxai.app/api/license/activate \
  -H 'Content-Type: application/json' \
  -d '{"licenseKey":"xxx","instanceName":"test"}'
# 返回: {"data":{"valid":true,"instanceId":"instant-id-xxx"}}
```

```python
# 2. 写入 config.json
settings['licenseKey'] = 'xxx'
settings['licenseActivationMethod'] = 'manual'
settings['licenseInstances'] = { 'xxx': 'instant-id-xxx' }
```

Premium 状态影响的功能：
- MCP 内置云端服务器（Fetch, EdgeOne Pages, arXiv, Context7）
- 部分高级 Skills

### MCP 内置服务器配置

```python
settings['mcp'] = {
    'enabledBuiltinServers': ['fetch', 'edgeone-pages', 'arxiv', 'context7'],
    'servers': []
}
```

## Agent Mode 面板交互

Agent Mode 使用 Mantine Popover，通过 hover 触发（`keepMounted` + `opened` state）。

### 打开面板

```js
await evaluate(`
  const icon = document.querySelector('.tabler-icon-robot')
  const btn = icon.closest('button')
  btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: window }))
  btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }))
  btn.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, view: window }))
`)
await sleep(800)
```

### Hover 子项（触发子面板）

```js
// 需要同时用 JS 事件 + CDP Input 才能可靠触发
async function hoverItem(text) {
  const pos = await evaluate(`
    for (const p of document.querySelectorAll('[class*="Popover-dropdown"]')) {
      if (p.getBoundingClientRect().width === 0) continue
      for (const el of p.querySelectorAll('span, div')) {
        if (el.textContent?.trim().includes('${text}')) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 10 && r.height < 50) {
            const row = el.closest('[class*="cursor"]') || el.parentElement
            row?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: window }))
            row?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, view: window }))
            return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) })
          }
        }
      }
    }
    return null
  `)
  if (!pos) return false
  const { x, y } = JSON.parse(pos)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await sleep(2000)
  return true
}
```

### 面板标签名（多语言）

| 功能 | EN | ZH |
|------|----|----|
| 模式标题 | Agent Mode | 智能体模式 |
| 联网搜索 | Web Search | 联网搜索 |
| 代码执行 | Code Execution | 代码执行 |
| 技能 | Skills | Skills |
| MCP | MCP | MCP |
| 知识库 | Knowledge Base | 知识库 |

### 关闭面板

```js
await evaluate(`
  const icon = document.querySelector('.tabler-icon-robot')
  icon?.closest('button')?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
  icon?.closest('button')?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))
`)
```

## 截图

### Page.captureScreenshot 的限制

**Electron 窗口必须在前台且可见**，否则 `captureScreenshot` 会永久挂起。这是 Chromium Compositor 的限制。

在 CLI 环境中（窗口通常在后台），截图大概率失败。可行的替代方案：

1. **手动截图**: `Cmd+Shift+4` (macOS)
2. **`Page.startScreencast`**: 可返回帧数据，但窗口不可见时帧为空白
3. **`Emulation.setDeviceMetricsOverride`**: 有时能让截图工作（强制 compositor 渲染），但不稳定

```js
// 设置视口（有时能让后台截图工作）
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 800,
  deviceScaleFactor: 2,
  mobile: false,
})
await sleep(2000)

// 截图
const result = await send('Page.captureScreenshot', { format: 'png' })
const buffer = Buffer.from(result.data, 'base64')
fs.writeFileSync('screenshot.png', buffer)
```

### Page.reload 后的重连

`Page.reload` 会改变 page ID，旧的 WebSocket 连接变为 stale。必须重新获取 page 信息并建立新连接：

```js
await send('Page.reload')
ws.close()
await sleep(10000)

// 重新连接
const pages = await (await fetch('http://127.0.0.1:9333/json')).json()
const newPage = pages.find(p => p.title === 'Chatbox')
ws = new WebSocket(newPage.webSocketDebuggerUrl)
await new Promise(r => ws.on('open', r))
await send('Page.enable')
await send('Runtime.enable')
```

## Message Layout Modal

新用户首次使用时，index 路由会显示 Message Layout 选择器。

### 关键特性

- **不是 overlay/modal**: 是通过三目运算符替代整个内容区的条件渲染（`src/renderer/routes/index.tsx:252`）
- **触发条件**: `settings.messageLayout` 为 `undefined`
- **zustand persist 覆盖问题**: 即使在 config 中设置 `messageLayout: 'left'`，zustand persist 的 `SettingsSchema.parse()` 会把缺失字段显式设为 `undefined`，merge 时覆盖 defaults

### 自动化中的处理

CDP 点击 Save 按钮不触发 React 事件处理（包括 `element.click()`、CDP `Input.dispatchMouseEvent`、React fiber `memoizedProps.onClick()` 都不行——zustand state 不更新）。已知的可靠方案：

1. **让用户手动点击 Save**（最简单）
2. **在 session 路由截图**: session 页面（`/session/$sessionId`）不包含此 modal
3. **修改源码**: 临时在 `defaults.ts` 取消注释 `messageLayout: 'left'` + 删除 config 中的 `settings` key + 清除 Vite 缓存（`rm -rf node_modules/.vite .vite out/`）

## RTK 注意事项

如果安装了 RTK (Rust Token Killer)，它会过滤 `ls`, `grep`, `curl` 等命令的输出。在自动化脚本中使用 `node -e` 替代这些命令：

```js
// 代替 curl
node -e "fetch('http://127.0.0.1:9333/json').then(r=>r.json()).then(console.log)"

// 代替 ls
node -e "require('fs').readdirSync('/path').forEach(f=>console.log(f))"
```
