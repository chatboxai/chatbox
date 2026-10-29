// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'jotai'
import { type PropsWithChildren, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageModelSelect } from './ImageModelSelect'
import { Modal } from './layout/Overlay'
import type { DetailModel } from './ModelSelectorV2/types'

const screenSize = vi.hoisted(() => ({ mobile: false }))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => screenSize.mobile }))
vi.mock('./icons/ModelIcon', () => ({ ModelIcon: () => null }))
vi.mock('./icons/ProviderIcon', () => ({ default: () => null }))
vi.mock('./ModelSelectorV2/DetailCard', () => ({
  DetailCard: ({ model, onClose, mobile }: { model: DetailModel; onClose?: () => void; mobile?: boolean }) => (
    <div>
      {model.description}
      {mobile && <button onClick={onClose}>Close</button>}
    </div>
  ),
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })
  ),
})
HTMLElement.prototype.scrollIntoView = vi.fn()

const description = 'Create detailed images from text and reference images.'
const modelGroups = [
  {
    providerId: ModelProviderEnum.Gemini,
    label: 'Gemini',
    models: [{ modelId: 'image-model', displayName: 'Image model', description }],
  },
]

function SettingsModal({ children, onClose }: PropsWithChildren<{ onClose: () => void }>) {
  const [opened, setOpened] = useState(true)
  return (
    <Modal
      opened={opened}
      onClose={() => {
        onClose()
        setOpened(false)
      }}
      fullScreen
      withCloseButton={false}
      transitionProps={{ duration: 0 }}
    >
      {children}
    </Modal>
  )
}

function mount(opened?: boolean, onModalClose?: () => void, withinPortal?: boolean) {
  const onSelect = vi.fn()
  const selector = (
    <ImageModelSelect opened={opened} withinPortal={withinPortal} onSelect={onSelect} modelGroups={modelGroups}>
      Choose image model
    </ImageModelSelect>
  )
  render(
    <Provider>
      <MantineProvider>
        <style>{'[data-vaul-drawer], [data-vaul-overlay] { animation-name: none !important; }'}</style>
        {onModalClose ? <SettingsModal onClose={onModalClose}>{selector}</SettingsModal> : selector}
      </MantineProvider>
    </Provider>
  )
  return onSelect
}

function mountControlled(initialOpened: boolean) {
  const onChange = vi.fn()
  const onSelect = vi.fn()

  function ControlledSelect() {
    const [opened, setOpened] = useState(initialOpened)
    return (
      <ImageModelSelect
        opened={opened}
        onChange={(value: boolean) => {
          onChange(value)
          setOpened(value)
        }}
        onSelect={onSelect}
        modelGroups={modelGroups}
      >
        Choose image model
      </ImageModelSelect>
    )
  }

  render(
    <Provider>
      <MantineProvider>
        <style>{'[data-vaul-drawer], [data-vaul-overlay] { animation-name: none !important; }'}</style>
        <ControlledSelect />
      </MantineProvider>
    </Provider>
  )
  return { onChange, onSelect }
}

async function openDetail() {
  fireEvent.click(screen.getByRole('button', { name: 'Choose image model' }))
  const option = screen.getByRole('option', { name: 'Image model' })
  fireEvent.mouseEnter(option)
  await screen.findByText(description)
  return option
}

afterEach(() => {
  cleanup()
  screenSize.mobile = false
})

describe('image model details', () => {
  it.each(['click', 'keyboard'])('opens a controlled model list with $0', async (method) => {
    const user = userEvent.setup()
    const { onChange, onSelect } = mountControlled(false)
    const trigger = screen.getByRole('button', { name: 'Choose image model' })

    if (method === 'click') await user.click(trigger)
    else {
      trigger.focus()
      await user.keyboard('{ArrowDown}')
    }

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
    expect(screen.getByRole('option', { name: 'Image model' })).not.toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it.each(['selection', 'Escape', 'outside click'])('closes a controlled model list after $0', async (method) => {
    const user = userEvent.setup()
    const { onChange, onSelect } = mountControlled(true)

    if (method === 'selection') await user.click(screen.getByRole('option', { name: 'Image model' }))
    else if (method === 'Escape') {
      screen.getByRole('button', { name: 'Choose image model' }).focus()
      await user.keyboard('{Escape}')
    } else await user.click(document.body)

    expect(onChange).toHaveBeenCalledExactlyOnceWith(false)
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull())
    if (method === 'selection')
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(ModelProviderEnum.Gemini, 'image-model')
    else expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes the controlled model list when opening mobile details', async () => {
    screenSize.mobile = true
    const user = userEvent.setup()
    const { onChange, onSelect } = mountControlled(true)

    await user.click(screen.getByRole('button', { name: 'Model details' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(await screen.findByRole('dialog', { name: 'Model details' })).not.toBeNull()
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('selects the first described model when opening the list with the keyboard', async () => {
    const user = userEvent.setup()
    const onSelect = mount()
    const trigger = screen.getByRole('button', { name: 'Choose image model' })
    trigger.focus()

    await user.keyboard('{ArrowDown}')

    const option = screen.getByRole('option', { name: 'Image model' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(option.id)
    expect(option.getAttribute('data-combobox-selected')).toBe('true')

    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith(ModelProviderEnum.Gemini, 'image-model')
  })

  it.each(['Enter', 'Escape'])('keeps the active option valid after %s and reopening with the mouse', async (key) => {
    const user = userEvent.setup()
    const onSelect = mount()
    await user.tab()
    const trigger = screen.getByRole('button', { name: 'Choose image model' })
    await user.keyboard(`{ArrowDown}{${key}}`)
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull())
    onSelect.mockClear()

    await user.click(trigger)

    const activeOptionId = trigger.getAttribute('aria-activedescendant')
    if (activeOptionId) expect(document.getElementById(activeOptionId)).not.toBeNull()

    await user.keyboard('{ArrowDown}{Enter}')

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(ModelProviderEnum.Gemini, 'image-model')
  })

  it('focuses the mobile detail and keeps keyboard input from selecting a model', async () => {
    screenSize.mobile = true
    const user = userEvent.setup()
    const onSelect = mount()
    await user.click(screen.getByRole('button', { name: 'Choose image model' }))
    await user.click(screen.getByRole('button', { name: 'Model details' }))

    const detail = await screen.findByRole('dialog', { name: 'Model details' })
    await waitFor(() => expect(detail.contains(document.activeElement)).toBe(true))
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('opens the mobile detail with the keyboard inside the settings modal', async () => {
    screenSize.mobile = true
    const user = userEvent.setup()
    const onModalClose = vi.fn()
    const onSelect = mount(undefined, onModalClose, true)
    const trigger = screen.getByRole('button', { name: 'Choose image model' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))

    await user.keyboard('{ArrowDown}')
    await user.tab()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Model details' }))
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('dialog', { name: 'Model details' })).not.toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onModalClose).not.toHaveBeenCalled()
  })

  it('closes only the model list on Escape from its detail button in the settings modal', async () => {
    screenSize.mobile = true
    const user = userEvent.setup()
    const onModalClose = vi.fn()
    const onSelect = mount(undefined, onModalClose, true)
    const trigger = screen.getByRole('button', { name: 'Choose image model' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    await user.keyboard('{ArrowDown}')
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Model details' }))

    await user.keyboard('{Escape}')

    expect(onModalClose).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull())
    expect(document.activeElement).toBe(trigger)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it.each([
    { inModal: false, closeWith: 'Escape' },
    { inModal: false, closeWith: 'Close' },
    { inModal: true, closeWith: 'Escape' },
    { inModal: true, closeWith: 'Close' },
  ])('returns focus after closing mobile details with $closeWith (modal: $inModal)', async ({ inModal, closeWith }) => {
    screenSize.mobile = true
    const user = userEvent.setup()
    const onModalClose = vi.fn()
    const onSelect = mount(undefined, inModal ? onModalClose : undefined, true)
    const trigger = screen.getByRole('button', { name: 'Choose image model' })
    if (inModal) await waitFor(() => expect(document.activeElement).toBe(trigger))
    else await user.tab()
    await user.keyboard('{ArrowDown}')
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Model details' }))
    await user.keyboard('{Enter}')
    const detail = await screen.findByRole('dialog', { name: 'Model details' })
    await waitFor(() => expect(detail.contains(document.activeElement)).toBe(true))

    if (closeWith === 'Escape') await user.keyboard('{Escape}')
    else await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.queryByText(description)).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(onSelect).not.toHaveBeenCalled()
    expect(onModalClose).not.toHaveBeenCalled()
  })

  it('shows the description when the model list is controlled open', async () => {
    mount(true)
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Image model' }))

    expect(await screen.findByText(description)).not.toBeNull()
  })

  it('keeps the model list open when interacting with its description', async () => {
    const onSelect = mount()
    const option = await openDetail()
    const detail = screen.getByText(description)

    fireEvent.mouseDown(detail)
    fireEvent.click(detail)

    expect(option.closest('.mantine-Combobox-dropdown')?.contains(detail)).toBe(true)
    expect(screen.getByRole('option', { name: 'Image model' })).toBe(option)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes the detail and selects the clicked model', async () => {
    const onSelect = mount()
    fireEvent.click(await openDetail())

    expect(onSelect).toHaveBeenCalledWith(ModelProviderEnum.Gemini, 'image-model')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes the model list and detail on an outside click', async () => {
    mount()
    await openDetail()
    fireEvent.mouseDown(document.body)

    await waitFor(() => expect(screen.queryByRole('option')).toBeNull())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('opens the model list with no stale detail after a selection', async () => {
    mount()
    fireEvent.click(await openDetail())
    fireEvent.click(screen.getByRole('button', { name: 'Choose image model' }))

    expect(screen.getByRole('option', { name: 'Image model' })).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
