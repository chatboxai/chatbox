/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const controller = {
    attach: vi.fn(),
    waitForReady: vi.fn(async () => undefined),
    renderHtml: vi.fn(),
    getSession: vi.fn(() => ({
      envelope: {
        bridgeSessionId: 'bridge-session-artifact-1',
      },
    })),
    dispose: vi.fn(),
  }

  return {
    controller,
    createBridgeHostController: vi.fn(() => controller),
  }
})

vi.mock('@/packages/chatbridge/bridge/host-controller', () => ({
  createBridgeHostController: mocks.createBridgeHostController,
}))

import { Artifact } from './Artifact'

describe('Artifact preview bridge surface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:artifact-runtime'),
      configurable: true,
      writable: true,
    })
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    })
  })

  it('keeps HTML preview on the preview-only render-html bridge seam', async () => {
    const { container } = render(<Artifact htmlCode="<html><body><h1>Preview</h1></body></html>" />)

    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    if (!iframe) {
      return
    }

    Object.defineProperty(iframe, 'contentWindow', {
      value: window,
      configurable: true,
    })

    fireEvent.load(iframe)

    await waitFor(() => {
      expect(mocks.createBridgeHostController).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'artifact-preview',
          capabilities: ['render-html-preview'],
        })
      )
    })

    expect(mocks.controller.attach).toHaveBeenCalledTimes(1)
    expect(mocks.controller.renderHtml).toHaveBeenCalledWith('<html><body><h1>Preview</h1></body></html>')
  })
})
