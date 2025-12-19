import { useCallback, useEffect, useState } from 'react'
import { copyToClipboard } from '@/packages/navigator'

export const useCopied = (text: string) => {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000)
      return () => clearTimeout(timer)
    }
  }, [copied])

  const copy = useCallback(() => {
    copyToClipboard(text)
    setCopied(true)
  }, [text])

  return {
    copied,
    copy,
  }
}
