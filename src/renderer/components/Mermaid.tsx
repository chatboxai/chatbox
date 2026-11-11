/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: Mermaid sanitizes the generated SVG before returning it */
import DataObjectIcon from '@mui/icons-material/DataObject'
import { ChartBarStacked } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gallery, Item } from 'react-photoswipe-gallery'
import { trackJkAutoEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/packages/navigator'
import * as picUtils from '@/packages/pic_utils'
import platform from '@/platform'
import { useUIStore } from '@/stores/uiStore'
import * as toastActions from '../stores/toastActions'

export function MessageMermaid(props: { source: string; theme: 'light' | 'dark'; generating?: boolean }) {
  const { source, theme, generating } = props

  const [svgId, setSvgId] = useState('')
  const [svgCode, setSvgCode] = useState('')
  const [renderError, setRenderError] = useState<string | null>(null)
  useEffect(() => {
    if (generating) {
      return
    }

    let cancelled = false
    setRenderError(null)
    setSvgCode('')
    setSvgId('')
    void (async () => {
      try {
        const { id, svg } = await mermaidCodeToSvgCode(source, theme)
        if (cancelled) {
          return
        }
        setSvgCode(svg)
        setSvgId(id)
      } catch (error) {
        if (cancelled) {
          return
        }
        const reason = getErrorReason(error)
        console.error('Failed to render Mermaid diagram:', error)
        trackJkAutoEvent(JK_EVENTS.MERMAID_RENDER_FAILED, {
          pageName: JK_PAGE_NAMES.CHAT_PAGE,
          content: source,
          contentType: 'mermaid',
          props: {
            content_add_info: {
              content: reason,
            },
          },
        })
        setRenderError(reason)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [source, theme, generating])

  if (generating) {
    // 测试下来，发现这种方法是视觉效果最好的。
    // 如果根据 mermaid 是否正常渲染来判断，有时候残缺的 mermaid 也可以渲染出部分图形，这会造成视觉上的闪屏混乱。
    return <Loading />
  }

  if (renderError) {
    return <MermaidRenderError source={source} reason={renderError} />
  }

  return (
    // <SVGPreview xmlCode={svgCode} />
    <MermaidSVGPreviewDangerous svgId={svgId} svgCode={svgCode} mermaidCode={source} />
  )
}

function MermaidRenderError(props: { source: string; reason: string }) {
  const { source, reason } = props
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-solid border-[var(--chatbox-border-error)]">
      <div className="bg-[var(--chatbox-background-error-secondary)] px-3 py-2 text-sm text-[var(--chatbox-tint-error)]">
        {reason}
      </div>
      <pre className="m-0 overflow-auto whitespace-pre p-3 text-sm">
        <code>{source}</code>
      </pre>
    </div>
  )
}

function getErrorReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name
  }
  return String(error)
}

export function Loading() {
  return (
    <div className="inline-flex items-center gap-2 border border-solid border-gray-500 rounded-lg p-2 my-2">
      <ChartBarStacked size={30} strokeWidth={1} />
      <span>Loading...</span>
    </div>
  )
}

/**
 * 直接将 svg 代码注入到页面中，通过浏览器自身的修复能力处理 svg 代码，再通过 serializeToString 得到规范的 svg 代码。
 * 经过各种测试，发现有时候 mermaid 生成的 svg 代码并不规范，直接转化 base64 将无法完整显示。
 * 这里的做法是直接将 svg 代码注入到页面中，通过浏览器自身的修复能力处理 svg 代码，再通过 serializeToString 得到规范的 svg 代码。
 */
export function MermaidSVGPreviewDangerous(props: {
  svgCode: string
  svgId: string
  mermaidCode: string
  className?: string
  generating?: boolean
}) {
  const { svgId, svgCode, mermaidCode, className, generating } = props
  const { t } = useTranslation()
  const setPictureShow = useUIStore((s) => s.setPictureShow)
  if (!svgCode.includes('</svg') && generating) {
    return <Loading />
  }
  return (
    <div
      className={cn('cursor-pointer my-2', className)}
      onClick={async () => {
        const svg = document.getElementById(svgId)
        if (!svg) {
          return
        }
        const serializedSvgCode = new XMLSerializer().serializeToString(svg)
        const base64 = picUtils.svgCodeToBase64(serializedSvgCode)
        const pngBase64 = await picUtils.svgToPngBase64(base64)
        setPictureShow({
          picture: {
            url: pngBase64,
          },
          extraButtons: [
            {
              onClick: () => {
                copyToClipboard(mermaidCode)
                toastActions.add(t('copied to clipboard'))
              },
              icon: <DataObjectIcon />,
            },
          ],
        })
      }}
    >
      {/* 这里直接注入了 svg 代码 */}
      <div dangerouslySetInnerHTML={{ __html: svgCode }} />
    </div>
  )
}

/**
 * Mobile saves a PNG so the system share sheet treats it as a photo. When rasterizing fails, the
 * original SVG is shared instead so the download still produces a usable file.
 */
export async function downloadSvgPreview(svgBase64: string, t: (key: string, options?: object) => string) {
  const basename = `svg_${Math.random().toString(36).substring(7)}`
  if (platform.type !== 'mobile') {
    await platform.exporter.exportByUrl(basename, svgBase64)
    return
  }
  try {
    const pngBase64 = await picUtils.svgToPngBase64(svgBase64)
    await platform.exporter.exportImageFile(basename, pngBase64)
  } catch (error) {
    try {
      await platform.exporter.exportImageFile(basename, svgBase64)
    } catch (fallbackError) {
      toastActions.add(
        t('Failed to export file: {{error}}', {
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        })
      )
    }
  }
}

export function SVGPreview(props: { xmlCode: string; className?: string; generating?: boolean }) {
  let { xmlCode, className, generating } = props
  const { t } = useTranslation()
  const svgBase64 = useMemo(() => {
    if (!xmlCode.includes('</svg') && generating) {
      return ''
    }
    // xmlns 属性告诉浏览器该 XML 文档使用的是 SVG 命名空间，缺少该属性会导致浏览器无法正确渲染 SVG 代码。
    if (!xmlCode.includes('xmlns="http://www.w3.org/2000/svg"')) {
      xmlCode = xmlCode.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    }
    try {
      return picUtils.svgCodeToBase64(xmlCode)
    } catch (e) {
      console.error(e)
      return ''
    }
  }, [xmlCode, generating])

  const size = useMemo(() => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlCode, 'image/svg+xml')
    const svgEl = doc.documentElement

    let width = parseInt(svgEl.getAttribute('width') || '') || 0
    let height = parseInt(svgEl.getAttribute('height') || '') || 0
    const viewBox = svgEl.getAttribute('viewBox')
    if ((!width || !height) && viewBox) {
      const vb = viewBox.trim().split(/\s+/).map(Number)
      if (vb.length === 4 && Number.isFinite(vb[2]) && Number.isFinite(vb[3])) {
        width = width || Math.max(1, Math.round(vb[2]))
        height = height || Math.max(1, Math.round(vb[3]))
      }
    }
    return { width, height }
  }, [xmlCode])

  if (!svgBase64) {
    return <Loading />
  }

  return (
    <Gallery
      uiElements={[
        {
          name: 'custom-rotate-button',
          ariaLabel: 'Rotate',
          order: 9,
          isButton: true,
          html: {
            isCustomSVG: true,
            inner:
              '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
            outlineID: 'pswp__icn-download',
          },
          appendTo: 'bar',
          onClick: () => void downloadSvgPreview(svgBase64, t),
        },
      ]}
    >
      <div className={cn('cursor-pointer my-2', className)}>
        <Item original={svgBase64} thumbnail={svgBase64} width={size.width} height={size.height}>
          {({ ref, open }) => (
            <img
              className="!w-auto min-w-24"
              ref={ref}
              src={svgBase64}
              alt="svg preview"
              width={size.width}
              // height={size.height}
              onClick={open}
            />
          )}
        </Item>
      </div>
    </Gallery>
  )
}

async function mermaidCodeToSvgCode(source: string, theme: 'light' | 'dark') {
  if (typeof structuredClone !== 'function') {
    await import('core-js/actual/structured-clone.js')
  }
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ theme: theme === 'light' ? 'default' : 'dark', suppressErrorRendering: true })
  const id = `mermaidtmp${Math.random().toString(36).substring(2, 15)}`
  const result = await mermaid.render(id, source)
  // 考虑到 mermaid 工具内部本身已经使用了 dompurify 进行处理，因此可以先假设它的输出是安全的
  // 经过测试，发现 dompurify.sanitize 有时候会导致最终的 svg 显示不完整
  // 考虑到现代浏览器都不会执行 svg 中的 script 标签，所以这里不进行 sanitize。参考：https://stackoverflow.com/questions/7917008/xss-when-loading-untrusted-svg-using-img-tag
  // return dompurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true } })
  return { id, svg: result.svg }
}
