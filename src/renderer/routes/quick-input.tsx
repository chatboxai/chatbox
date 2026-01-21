import { Box, TextInput } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/quick-input')({
  component: QuickInputWindow,
})

function QuickInputWindow() {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
    // Notify main process that window is ready
    if (window.electronAPI) {
      window.electronAPI.send('quick-input:ready')
    }
  }, [])

  // Handle Enter key - submit
  const handleSubmit = () => {
    const trimmedText = inputValue.trim()
    console.log('QuickInput: handleSubmit called with text:', trimmedText)
    if (trimmedText) {
      // Send submit event to main process
      // The main process will close the window after forwarding the message
      if (window.electronAPI) {
        console.log('QuickInput: Sending quick-input:submit to main process')
        window.electronAPI.send('quick-input:submit', { text: trimmedText })
      } else {
        console.error('QuickInput: window.electronAPI is not available')
      }
    } else {
      console.log('QuickInput: Text is empty, not submitting')
    }
  }

  // Handle Escape key - cancel
  const handleCancel = () => {
    if (window.electronAPI) {
      window.electronAPI.invoke('quick-input:close')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        padding: '20px',
        boxSizing: 'border-box',
      }}
    >
      <TextInput
        ref={inputRef}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('Type your message...') || 'Type your message...'}
        size="lg"
        style={{
          width: '100%',
          maxWidth: '600px',
        }}
        styles={{
          input: {
            fontSize: '18px',
            textAlign: 'center',
            padding: '16px 24px',
          },
        }}
        aria-label={t('Quick Input') || 'Quick Input'}
      />
    </Box>
  )
}
