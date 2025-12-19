import type { BrowserWindow } from 'electron'
import log from 'electron-log/main'

export function handleDeepLink(mainWindow: BrowserWindow, link: string) {
  const normalizedLink = link.replace(/^chatbox-dev:\/\//, 'chatbox://')
  const url = new URL(normalizedLink)

  console.log('🔗 Parsed URL:', { hostname: url.hostname, pathname: url.pathname, params: url.searchParams.toString() })

  // handle `chatbox://mcp/install?server=`
  if (url.hostname === 'mcp' && url.pathname === '/install') {
    const encodedConfig = url.searchParams.get('server') || ''
    mainWindow.webContents.send('navigate-to', `/settings/mcp?install=${encodeURIComponent(encodedConfig)}`)
  }

  // handle `chatbox://provider/import?config=`
  if (url.hostname === 'provider' && url.pathname === '/import') {
    const encodedConfig = url.searchParams.get('config') || ''
    mainWindow.webContents.send('navigate-to', `/settings/provider?import=${encodeURIComponent(encodedConfig)}`)
  }

  // handle `chatbox://auth/callback?ticket_id=xxx&status=success`
  // // 不需要，实际跳回到 app 后业务hooks useLogin 会处理后续动作
  // if (url.hostname === 'auth' && url.pathname === '/callback') {
  //   const ticketId = url.searchParams.get('ticket_id') || ''
  //   const status = url.searchParams.get('status') || ''
  //   log.info('✅ Auth callback received:', { ticketId, status })
  //   mainWindow.webContents.send('navigate-to', `/settings/provider/chatbox-ai?ticket_id=${ticketId}&status=${status}`)
  // }
}
