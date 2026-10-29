// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import zh from '../../../../packages/chatbox-i18n/src/locales/zh-Hans/translation.json'
import { BackupWarnings, type BackupWarningPage } from './BackupWarnings'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
})
afterEach(cleanup)

async function showWarnings(overrides: Partial<BackupWarningPage> = {}) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'zh-Hans',
    resources: { 'zh-Hans': { translation: zh } },
    interpolation: { escapeValue: false },
  })
  const props: BackupWarningPage = {
    summaries: [{ id: 'resources', label: '30 个附件未包含在备份中' }],
    items: [{ id: 'first', label: 'first.png', reason: '资源不存在' }],
    expanded: true,
    hasMore: true,
    onExpandedChange: vi.fn(),
    onLoadMore: vi.fn(),
    ...overrides,
  }
  const view = (page: BackupWarningPage) => (
    <I18nextProvider i18n={i18n}>
      <MantineProvider>
        <BackupWarnings {...page} />
      </MantineProvider>
    </I18nextProvider>
  )
  const rendered = render(view(props))
  return { props, replacePage: (next: Partial<BackupWarningPage>) => rendered.rerender(view({ ...props, ...next })) }
}

it('requests more details without retaining the previous page', async () => {
  const { props, replacePage } = await showWarnings()
  expect(screen.getByText('30 个附件未包含在备份中')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh['Show more'] }))
  expect(props.onLoadMore).toHaveBeenCalledOnce()
  replacePage({ items: [{ id: 'second', label: 'second.png', reason: '不可读' }], hasMore: false })
  expect(screen.queryByText('first.png')).toBeNull()
  expect(screen.getByText('second.png')).toBeTruthy()
  expect(screen.queryByRole('button', { name: zh['Show more'] })).toBeNull()
})

it('delegates expansion and hides unloaded details', async () => {
  const { props, replacePage } = await showWarnings({ expanded: false, items: [] })
  expect(screen.queryByText('first.png')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
  expect(props.onExpandedChange).toHaveBeenCalledWith(true)
  replacePage({ expanded: true, items: [{ id: 'one', label: 'one', reason: '资源不存在' }] })
  expect(screen.getByText('原因：资源不存在')).toBeTruthy()
})

it('renders diagnostic text without executing markup', async () => {
  await showWarnings({ items: [{ id: 'one', label: 'file', reason: '<script>diagnostic</script>' }] })
  expect(screen.getByText('原因：<script>diagnostic</script>')).toBeTruthy()
  expect(document.querySelector('script')).toBeNull()
})
