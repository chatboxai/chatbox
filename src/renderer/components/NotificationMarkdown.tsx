import { Box } from '@mui/material'
import type { MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'

const NOTIFICATION_ASSET_ORIGIN = 'https://assets.chatboxai.app'
const NOTIFICATION_ASSET_PATH = '/notifications/'
const LOCAL_NOTIFICATION_ASSET_ORIGINS = new Set(['http://127.0.0.1:8003', 'http://localhost:8003'])
const ALLOWED_ELEMENTS = [
  'p',
  'strong',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'ol',
  'ul',
  'li',
  'blockquote',
  'a',
  'img',
  'br',
  'hr',
]

function isHttpsUrl(rawUrl: string) {
  try {
    return new URL(rawUrl).protocol === 'https:'
  } catch {
    return false
  }
}

export function isNotificationAssetUrl(rawUrl: string | undefined) {
  if (!rawUrl) return false
  try {
    const url = new URL(rawUrl)
    const allowedOrigin =
      url.origin === NOTIFICATION_ASSET_ORIGIN ||
      (import.meta.env.DEV && LOCAL_NOTIFICATION_ASSET_ORIGINS.has(url.origin))
    return allowedOrigin && url.pathname.startsWith(NOTIFICATION_ASSET_PATH)
  } catch {
    return false
  }
}

export default function NotificationMarkdown({
  children,
  onLinkClick,
  compact = false,
}: {
  children: string
  onLinkClick: (url: string) => void
  compact?: boolean
}) {
  return (
    <Box
      sx={{
        '& blockquote': {
          borderLeft: 3,
          borderColor: 'var(--chatbox-border-primary)',
          color: 'inherit',
          m: 0,
          my: 1.5,
          pl: 1.5,
        },
        '& h1': {
          fontSize: compact ? '14px' : '16px',
          color: 'inherit',
          fontWeight: 600,
          lineHeight: 1.4,
          mb: '6px',
          mt: '20px',
        },
        '& h2': {
          color: 'inherit',
          fontSize: compact ? '13px' : '14px',
          fontWeight: 600,
          lineHeight: 1.4,
          mb: '6px',
          mt: '20px',
        },
        '& h3': {
          color: 'inherit',
          fontSize: compact ? '13px' : '14px',
          fontWeight: 600,
          lineHeight: 1.4,
          mb: '4px',
          mt: '16px',
        },
        '& h4': {
          fontSize: compact ? '13px' : '14px',
          fontWeight: 600,
          lineHeight: 1.4,
          mb: '4px',
          mt: '16px',
        },
        '& img': { borderRadius: 1.5, display: 'block', height: 'auto', my: 2, maxWidth: '100%' },
        '& hr': {
          border: 0,
          borderTop: 1,
          borderColor: 'var(--chatbox-border-primary)',
          my: '12px',
        },
        '& li': { mb: 0, pl: 0, whiteSpace: 'pre-line' },
        '& li > p': { mb: 0 },
        '& ol, & ul': { mb: 0, mt: 0, pl: '20px' },
        '& p': { mb: compact ? '16px' : '20px', mt: 0, whiteSpace: 'pre-line' },
        '& p:has(+ ul), & p:has(+ ol)': { mb: 0 },
        '& > :first-child': { mt: 0 },
        '& > :last-child': { mb: 0 },
        '& strong': { color: 'inherit', fontWeight: 600 },
        '&& a': { color: 'var(--chatbox-tint-brand)', textDecoration: 'underline', textUnderlineOffset: '2px' },
        color: 'inherit',
        fontSize: compact ? '13px' : '14px',
        lineHeight: compact ? '18px' : '20px',
        overflowWrap: 'anywhere',
      }}
    >
      <ReactMarkdown
        allowedElements={ALLOWED_ELEMENTS}
        components={{
          a: ({ children: linkChildren, href }) => {
            if (!href || !isHttpsUrl(href)) return <>{linkChildren}</>
            return (
              <a
                href={href}
                rel="noopener noreferrer"
                target="_blank"
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault()
                  onLinkClick(href)
                }}
              >
                {linkChildren}
              </a>
            )
          },
          img: ({ alt, src }) =>
            isNotificationAssetUrl(src) ? <img alt={alt ?? ''} loading="lazy" src={src} /> : null,
        }}
        skipHtml
        unwrapDisallowed={false}
      >
        {children}
      </ReactMarkdown>
    </Box>
  )
}
