import NiceModal from '@ebay/nice-modal-react'
import { useEffect, useRef, useState } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import i18n from '@/i18n'
import {
  postDemoEnded,
  postDemoProgress,
  postDemoReady,
  postDemoScene,
  subscribeDemoCommands,
} from '@/marketing-demo/bridge'
import { createDemoRouter, DemoRouter } from '@/marketing-demo/DemoChrome'
import { setForcedDemoLayout } from '@/marketing-demo/demo-layout'
import {
  applyDemoImageGeneration,
  applyDemoInputValue,
  applyDemoMessages,
  demoSessionIds,
  renameDemoSessions,
  seedDemoImageModels,
} from '@/marketing-demo/demo-sessions'
import type { DemoLang, DemoSceneId } from '@/marketing-demo/protocol'
import { getSceneDurationMs, parseDemoSearch } from '@/marketing-demo/protocol'
import { getSceneFrame } from '@/marketing-demo/scenes'

function pathForScene(scene: DemoSceneId): string {
  if (scene === 'image-generation') return '/image-creator'
  const sessionId = demoSessionIds[scene]
  if (!sessionId) throw new Error(`demo session missing for ${scene}`)
  return `/session/${sessionId}`
}

export function DemoApp() {
  const initial = parseDemoSearch(window.location.search)
  const [scene, setScene] = useState<DemoSceneId>(initial.scene)
  const [lang, setLang] = useState<DemoLang>(initial.lang)
  const [elapsed, setElapsed] = useState(0)
  const playingRef = useRef(true)
  const elapsedRef = useRef(0)
  const sceneRef = useRef<DemoSceneId>(initial.scene)
  const previewShownRef = useRef(false)
  const [router] = useState(() => createDemoRouter(pathForScene(initial.scene)))

  useEffect(() => {
    const sendReady = () => {
      const currentScene = sceneRef.current
      postDemoReady(currentScene, elapsedRef.current, getSceneDurationMs(currentScene))
    }
    sendReady()
    const readyTimer = window.setInterval(sendReady, 400)
    const stopReadyTimer = () => window.clearInterval(readyTimer)
    const stopReady = window.setTimeout(stopReadyTimer, 8000)
    const unsubscribe = subscribeDemoCommands({
      onSetScene: (next) => {
        stopReadyTimer()
        sceneRef.current = next
        elapsedRef.current = 0
        setElapsed(0)
        setScene(next)
        postDemoScene(next, getSceneDurationMs(next))
      },
      onPlay: () => {
        stopReadyTimer()
        playingRef.current = true
      },
      onPause: () => {
        stopReadyTimer()
        playingRef.current = false
        const currentScene = sceneRef.current
        postDemoProgress(currentScene, elapsedRef.current, getSceneDurationMs(currentScene))
      },
      onSetLang: (next) => {
        stopReadyTimer()
        setLang(next)
        void i18n.changeLanguage(next)
        rendererApplication.settingsStore.setState((state) => {
          state.language = next
        })
        seedDemoImageModels(next)
        void renameDemoSessions(next)
      },
      onSetLayout: (next) => {
        stopReadyTimer()
        setForcedDemoLayout(next)
      },
    })
    return () => {
      window.clearInterval(readyTimer)
      window.clearTimeout(stopReady)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    router.history.push(pathForScene(scene))
  }, [router, scene])

  useEffect(() => {
    document.documentElement.setAttribute('data-demo-scene', scene)
  }, [scene])

  useEffect(() => {
    elapsedRef.current = 0
    setElapsed(0)
    previewShownRef.current = false
    void NiceModal.hide('artifact-preview')
    const durationMs = getSceneDurationMs(scene)
    let last = performance.now()
    let lastPaint = 0
    let lastProgressPost = 0
    let ended = false
    let raf = 0
    const loop = (now: number) => {
      const delta = now - last
      last = now
      if (playingRef.current && !ended) {
        elapsedRef.current = Math.min(durationMs, elapsedRef.current + delta)
        if (now - lastPaint > 50 || elapsedRef.current >= durationMs) {
          lastPaint = now
          setElapsed(elapsedRef.current)
        }
        if (now - lastProgressPost >= 100 || elapsedRef.current >= durationMs) {
          lastProgressPost = now
          postDemoProgress(scene, elapsedRef.current, durationMs)
        }
        if (!ended && elapsedRef.current >= durationMs) {
          ended = true
          postDemoEnded(scene, durationMs)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      void NiceModal.hide('artifact-preview')
    }
  }, [scene])

  useEffect(() => {
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    const block = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.target instanceof HTMLElement) event.target.blur()
    }
    const types = [
      'pointerdown',
      'mousedown',
      'mouseup',
      'click',
      'dblclick',
      'contextmenu',
      'touchstart',
      'keydown',
      'keypress',
      'focusin',
    ] as const
    for (const type of types) window.addEventListener(type, block, true)
    return () => {
      root?.removeAttribute('inert')
      for (const type of types) window.removeEventListener(type, block, true)
    }
  }, [])

  const frame = getSceneFrame(scene, elapsed, lang)

  useEffect(() => {
    if (scene === 'image-generation') return
    applyDemoMessages(scene, frame.messages, frame.sessionTitle)
  }, [frame.messages, frame.sessionTitle, scene])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      applyDemoInputValue(frame.inputText, scene)
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [frame.inputText, scene])

  const imagePhase = frame.imageGeneration?.phase
  const imagePrompt = frame.imageGeneration?.prompt
  const imageKeys = frame.imageGeneration?.images.join('|') ?? ''

  useEffect(() => {
    if (scene !== 'image-generation') {
      void applyDemoImageGeneration({ phase: 'empty', prompt: '', images: [] })
      return
    }
    if (!imagePhase || !imagePrompt) return
    void applyDemoImageGeneration({
      phase: imagePhase,
      prompt: imagePrompt,
      images: imageKeys ? imageKeys.split('|') : [],
    })
  }, [imageKeys, imagePhase, imagePrompt, scene])

  useEffect(() => {
    if (frame.showHtmlPreview && frame.htmlPreviewCode && !previewShownRef.current) {
      previewShownRef.current = true
      void NiceModal.show('artifact-preview', {
        htmlCode: frame.htmlPreviewCode,
        uniqueId: 'demo-html-preview',
        sessionId: demoSessionIds['code-preview'],
      }).catch(() => null)
    }
    if (!frame.showHtmlPreview && previewShownRef.current) {
      previewShownRef.current = false
      void NiceModal.hide('artifact-preview')
    }
  }, [frame.htmlPreviewCode, frame.showHtmlPreview])

  return (
    <div className="relative h-full w-full overflow-hidden select-none">
      <div className="pointer-events-none h-full w-full">
        <DemoRouter router={router} />
      </div>
      <div className="absolute inset-0 z-[9999] cursor-default" aria-hidden />
    </div>
  )
}
