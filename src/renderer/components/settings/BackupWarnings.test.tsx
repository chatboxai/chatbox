// @vitest-environment jsdom

import type { BackupWarning } from '@chatbox/core/backup'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import zh from '../../../../packages/chatbox-i18n/src/locales/zh-Hans/translation.json'
import { BackupWarnings } from './BackupWarnings'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
})
afterEach(cleanup)

async function showWarnings(
  warnings: BackupWarning[],
  preservedSessions: { id: string; name: string; legacyTopology: string }[] = []
) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'zh-Hans',
    resources: { 'zh-Hans': { translation: zh } },
    interpolation: { escapeValue: false },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <MantineProvider>
        <BackupWarnings warnings={warnings} preservedSessions={preservedSessions} />
      </MantineProvider>
    </I18nextProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
}

it('shows localized causes using stable reason codes independently of diagnostic wording', async () => {
  await showWarnings([
    {
      code: 'session-read-failed',
      itemType: 'session',
      itemId: 'one',
      reason: 'session-missing',
      message: 'New wording',
    },
    {
      code: 'session-read-failed',
      itemType: 'session',
      itemId: 'two',
      reason: 'session-id-mismatch',
      message: 'Other wording',
    },
    {
      code: 'resource-read-failed',
      itemType: 'resource',
      itemId: 'image',
      reason: 'resource-missing',
      message: 'Not found',
    },
  ])
  expect(screen.getAllByText('2 个对话未包含在备份中')).toHaveLength(2)
  expect(screen.getByText('原因：在本地存储中找不到该对话的数据。')).toBeTruthy()
  expect(screen.getByText('原因：对话 ID 与存储记录的 ID 不一致。')).toBeTruthy()
  expect(screen.getByText('原因：在本地存储中找不到该附件或图片。')).toBeTruthy()
  expect(screen.queryByText('New wording')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '收起详情' }))
  expect(screen.queryByText('原因：在本地存储中找不到该对话的数据。')).toBeNull()
})

it('shows unclassified diagnostics as text and keeps external-file explanations localized', async () => {
  await showWarnings([
    { code: 'session-read-failed', itemType: 'session', itemId: 'old', message: '<script>diagnostic</script>' },
    { code: 'session-read-failed', itemType: 'session', itemId: 'empty', message: '  ' },
    {
      code: 'external-resource-skipped',
      itemType: 'resource',
      itemId: 'file.pdf',
      message: 'External file was not included',
    },
  ])
  expect(screen.getByText('原因：<script>diagnostic</script>')).toBeTruthy()
  expect(document.querySelector('script')).toBeNull()
  expect(
    screen.getByText(zh['The original external file is not managed by Chatbox and was not included.'])
  ).toBeTruthy()
  expect(screen.queryByText('External file was not included')).toBeNull()
  expect(screen.getAllByText(/^原因：/)).toHaveLength(1)
})

it('distinguishes fully preserved legacy conversations from missing conversations', async () => {
  await showWarnings([], [{ id: 'legacy', name: 'Legacy', legacyTopology: 'unreachable fork pivot contains messages' }])
  expect(screen.getByText('1 个对话已按旧格式保留')).toBeTruthy()
  expect(screen.getByText('该对话的分支关系不完整，消息和分支已按旧版 JSON 格式完整保留。')).toBeTruthy()
  expect(screen.queryByText(/个对话未包含在备份中/)).toBeNull()
  expect(screen.getByText('原因：unreachable fork pivot contains messages')).toBeTruthy()
})
