import { App } from '@capacitor/app'
import { buildExecutionHtml } from '@shared/mobile-work/execution-html'
import { workerSource } from '@shared/mobile-work/generated/worker-source'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { receiveExecutionMessage } from './execution-message'
import { capacitorExecution } from './execution-service'

export default function MobileExecutionHost() {
  const job = useSyncExternalStore(
    capacitorExecution.subscribe,
    capacitorExecution.getSnapshot,
    capacitorExecution.getSnapshot
  )
  const frame = useRef<HTMLIFrameElement>(null)
  const page = useMemo(() => {
    if (!job) return null
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')
    return { token, html: buildExecutionHtml(job, workerSource, { type: 'parent', token }) }
  }, [job])

  useEffect(() => {
    let appActive = true
    const update = () => capacitorExecution.setForeground(appActive && document.visibilityState === 'visible')
    update()
    document.addEventListener('visibilitychange', update)
    const subscription = App.addListener('appStateChange', ({ isActive }) => {
      appActive = isActive
      update()
    })
    return () => {
      document.removeEventListener('visibilitychange', update)
      void subscription.then((listener) => listener.remove()).catch(() => undefined)
      capacitorExecution.setForeground(false)
    }
  }, [])

  useEffect(() => {
    if (!job || !page) return
    const receive = (event: MessageEvent) =>
      receiveExecutionMessage(event, frame.current?.contentWindow ?? null, job.id, page.token, capacitorExecution)
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [job, page])

  if (!job || !page) return null
  return (
    <iframe
      ref={frame}
      key={job.id}
      title="Local code execution"
      aria-hidden="true"
      tabIndex={-1}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={page.html}
      style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 0 }}
      onError={() => capacitorExecution.fail(job.id, new Error('Execution host failed'))}
    />
  )
}
