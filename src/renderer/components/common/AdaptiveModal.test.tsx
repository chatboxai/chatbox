// @vitest-environment jsdom
import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, MantineProvider, TextInput } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdaptiveModal } from './AdaptiveModal'

vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => true }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.stubGlobal('CSS', { escape: (value: string) => value })

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
})

const modalId = 'adaptive-modal-project-test'
const ProjectModal = NiceModal.create(() => {
  const modal = useModal()
  const [name, setName] = useState('')
  return (
    <AdaptiveModal opened={modal.visible} onClose={() => modal.hide()} onExitTransitionEnd={modal.remove}>
      <TextInput aria-label="Project name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
      <Button onClick={() => modal.hide()}>Create project</Button>
    </AdaptiveModal>
  )
})
NiceModal.register(modalId, ProjectModal)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderProjectModal() {
  render(
    <MantineProvider>
      <NiceModal.Provider />
    </MantineProvider>
  )
  act(() => {
    void NiceModal.show(modalId)
  })
}

function drawerContent() {
  const content = document.querySelector('[data-vaul-drawer]')
  if (!content) throw new Error('Drawer content is missing')
  return content
}

function endAnimation(element: Element, animationName: string) {
  fireEvent(element, Object.assign(new Event('animationend', { bubbles: true }), { animationName }))
}

describe('AdaptiveModal mobile lifecycle', () => {
  it('clears form state after programmatic close and exit animation', () => {
    renderProjectModal()
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    const content = drawerContent()
    expect(content.getAttribute('data-state')).toBe('closed')
    endAnimation(content, 'slideToBottom')

    act(() => {
      void NiceModal.show(modalId)
    })
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('')
  })

  it('clears form state after dismissing the drawer', async () => {
    renderProjectModal()
    const input = screen.getByRole('textbox', { name: 'Project name' })
    fireEvent.change(input, { target: { value: 'Draft' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(drawerContent().getAttribute('data-state')).toBe('closed'))
    endAnimation(drawerContent(), 'slideToBottom')
    act(() => {
      void NiceModal.show(modalId)
    })
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('')
  })

  it('ignores child animations while closing', () => {
    const onExitTransitionEnd = vi.fn()
    const view = (opened: boolean) => (
      <MantineProvider>
        <AdaptiveModal opened={opened} onClose={vi.fn()} onExitTransitionEnd={onExitTransitionEnd}>
          <span>Animated child</span>
        </AdaptiveModal>
      </MantineProvider>
    )
    const { rerender } = render(view(true))
    rerender(view(false))
    endAnimation(screen.getByText('Animated child'), 'child-animation')
    expect(onExitTransitionEnd).not.toHaveBeenCalled()
    endAnimation(drawerContent(), 'slideToBottom')
    expect(onExitTransitionEnd).toHaveBeenCalledTimes(1)
  })

  it('keeps the open form when its enter animation or a child animation ends', () => {
    renderProjectModal()
    const input = screen.getByRole('textbox', { name: 'Project name' })
    fireEvent.change(input, { target: { value: 'A' } })
    endAnimation(drawerContent(), 'slideFromBottom')
    endAnimation(input, 'child-animation')
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('A')
  })
})
