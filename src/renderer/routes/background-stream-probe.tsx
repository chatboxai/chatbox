import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { backgroundStreamPrototypeEnabled } from '@/native/background-stream'
import { handleMobileRequest } from '@/utils/mobile-request'

export const Route = createFileRoute('/background-stream-probe')({ component: BackgroundStreamProbe })

function BackgroundStreamProbe() {
  const [url, setUrl] = useState('http://127.0.0.1:18765/stream?count=20&interval=1000&pauseAt=3&pauseMs=45000')
  const [status, setStatus] = useState('Ready')
  const abort = useRef<AbortController | null>(null)
  if (!backgroundStreamPrototypeEnabled) return <p>Prototype disabled</p>
  const run = async () => {
    if (abort.current) return
    const controller = new AbortController()
    abort.current = controller
    setStatus('Starting')
    let content = ''
    try {
      const response = await handleMobileRequest(
        url,
        'POST',
        new Headers({ 'Content-Type': 'application/json' }),
        '{"stream":true}',
        controller.signal
      )
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Response stream missing')
      const decoder = new TextDecoder()
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        content += decoder.decode(next.value, { stream: true })
        setStatus(`Receiving: ${content.length} characters\n${content}`)
      }
      content += decoder.decode()
      const indices = [...content.matchAll(/"index":(\d+)/g)].map((match) => Number(match[1]))
      const count = Number(new URL(url).searchParams.get('count') ?? 20)
      const valid = indices.length === count && indices.every((index, position) => index === position)
      setStatus(`${valid ? 'PASS' : 'FAIL'} HTTP ${response.status}; ${indices.length}/${count} records\n${content}`)
    } catch (error) {
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}\n${content}`)
    } finally {
      abort.current = null
    }
  }
  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000000,
        padding: 24,
        paddingTop: 64,
        overflow: 'auto',
        background: '#fff',
        color: '#111',
      }}
    >
      <h1>Background stream probe</h1>
      <label>
        Stream URL
        <input
          aria-label="Stream URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          style={{ width: '100%' }}
        />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          style={{ minHeight: 44 }}
          type="button"
          onClick={() => setUrl('http://127.0.0.1:18765/stream?count=12&interval=500')}
        >
          Short stream preset
        </button>
        <button
          style={{ minHeight: 44 }}
          type="button"
          onClick={() => setUrl('http://127.0.0.1:18765/stream?count=20&interval=1000&pauseAt=3&pauseMs=45000')}
        >
          Silent stream preset
        </button>
        <button
          style={{ minHeight: 44 }}
          type="button"
          onClick={() => setUrl('http://127.0.0.1:18765/stream?count=10&interval=500&disconnectAt=2&truncate=1')}
        >
          Broken stream preset
        </button>
        <button
          style={{ minHeight: 44 }}
          type="button"
          onClick={() => {
            void run()
          }}
        >
          Start stream
        </button>
        <button style={{ minHeight: 44 }} type="button" onClick={() => abort.current?.abort()}>
          Cancel stream
        </button>
      </div>
      <pre aria-label="Stream result" style={{ whiteSpace: 'pre-wrap' }}>
        {status}
      </pre>
    </main>
  )
}
