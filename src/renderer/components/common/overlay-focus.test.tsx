/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest'
import { blurActiveElementWithin, handoffFocusToOverlay } from './overlay-focus'

describe('overlay focus handoff', () => {
  it('blurs the previously focused element and focuses the overlay target', () => {
    document.body.innerHTML = `
      <textarea id="message-input"></textarea>
      <div id="overlay" tabindex="-1"></div>
    `

    const input = document.getElementById('message-input') as HTMLTextAreaElement
    const overlay = document.getElementById('overlay') as HTMLDivElement

    input.focus()
    expect(document.activeElement).toBe(input)

    handoffFocusToOverlay(overlay)

    expect(document.activeElement).toBe(overlay)
  })

  it('does not blur when focus is already inside the overlay target', () => {
    document.body.innerHTML = `
      <div id="overlay" tabindex="-1">
        <button id="inside">Inside</button>
      </div>
    `

    const overlay = document.getElementById('overlay') as HTMLDivElement
    const inside = document.getElementById('inside') as HTMLButtonElement

    inside.focus()
    handoffFocusToOverlay(overlay)

    expect(document.activeElement).toBe(inside)
  })

  it('only blurs focus when the active element is inside the target subtree', () => {
    document.body.innerHTML = `
      <div id="outside">
        <button id="outside-button">Outside</button>
      </div>
      <div id="overlay">
        <button id="inside-button">Inside</button>
      </div>
    `

    const overlay = document.getElementById('overlay') as HTMLDivElement
    const inside = document.getElementById('inside-button') as HTMLButtonElement
    const outside = document.getElementById('outside-button') as HTMLButtonElement

    inside.focus()
    blurActiveElementWithin(overlay)
    expect(document.activeElement).toBe(document.body)

    outside.focus()
    blurActiveElementWithin(overlay)
    expect(document.activeElement).toBe(outside)
  })
})
