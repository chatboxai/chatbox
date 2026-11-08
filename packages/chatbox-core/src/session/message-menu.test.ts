import { describe, expect, it } from 'vitest'
import {
  clipMessageMenuPreview,
  getMessageMenuEntries,
  type MessageMenuAvailability,
  splitMessageMenuTitle,
} from './message-menu'

const all: MessageMenuAvailability = {
  stop: true,
  retry: true,
  replyBelow: true,
  edit: true,
  copy: true,
  generateMoreImages: true,
  selectText: true,
  quote: true,
  report: true,
  viewJson: false,
  delete: true,
}

describe('getMessageMenuEntries', () => {
  it('orders assistant entries with report and delete after a divider', () => {
    expect(getMessageMenuEntries({ role: 'assistant' }, all)).toEqual([
      'retry',
      'edit',
      'copy',
      'select-text',
      'quote',
      'divider',
      'report',
      'delete',
    ])
  })

  it('offers reply again below for user messages and never report', () => {
    expect(getMessageMenuEntries({ role: 'user' }, all)).toEqual([
      'reply-below',
      'edit',
      'copy',
      'select-text',
      'quote',
      'divider',
      'delete',
    ])
  })

  it('swaps retry and edit for stop while a reply streams', () => {
    expect(getMessageMenuEntries({ role: 'assistant', generating: true }, all)).toEqual([
      'stop',
      'copy',
      'select-text',
      'quote',
      'divider',
      'delete',
    ])
  })

  it('hides edit on a failed reply', () => {
    expect(getMessageMenuEntries({ role: 'assistant', error: 'boom' }, all)).toEqual([
      'retry',
      'copy',
      'select-text',
      'quote',
      'divider',
      'report',
      'delete',
    ])
    expect(getMessageMenuEntries({ role: 'assistant', errorCode: 429 }, all)).not.toContain('edit')
  })

  it('replaces text actions with generate more images in image sessions', () => {
    expect(getMessageMenuEntries({ role: 'assistant' }, all, { pictureSession: true })).toEqual([
      'retry',
      'generate-more-images',
      'quote',
      'divider',
      'report',
      'delete',
    ])
    expect(getMessageMenuEntries({ role: 'user' }, all, { pictureSession: true })).toContain('edit')
  })

  it('hides edit for Chatbox AI replies', () => {
    expect(getMessageMenuEntries({ role: 'assistant', model: 'Chatbox-AI 4' }, all)).not.toContain('edit')
  })

  it('applies caller availability and drops the divider when one side is empty', () => {
    expect(
      getMessageMenuEntries(
        { role: 'assistant' },
        { ...all, retry: false, edit: false, report: false, delete: false, viewJson: false }
      )
    ).toEqual(['copy', 'select-text', 'quote'])
    expect(getMessageMenuEntries({ role: 'user' }, { ...all, viewJson: true })).toEqual([
      'reply-below',
      'edit',
      'copy',
      'select-text',
      'quote',
      'divider',
      'view-json',
      'delete',
    ])
  })
})

describe('clipMessageMenuPreview', () => {
  it('clips the preview to 20 characters on one line', () => {
    expect(clipMessageMenuPreview('押金一般在交房检查无问题后 7 个工作日内退还，\n具体以合同约定为准。')).toBe(
      '押金一般在交房检查无问题后 7 个工作日…'
    )
    expect(clipMessageMenuPreview(' short\n')).toBe('short')
  })
})

describe('splitMessageMenuTitle', () => {
  it('splits the title around the author wherever the translation puts it', () => {
    expect(splitMessageMenuTitle('DeepSeek：押金…', 'DeepSeek')).toEqual({
      before: '',
      emphasis: 'DeepSeek',
      after: '：押金…',
    })
    expect(splitMessageMenuTitle('« Mover » : bonjour', 'Mover')).toEqual({
      before: '« ',
      emphasis: 'Mover',
      after: ' » : bonjour',
    })
  })

  it('leaves titles without the author whole', () => {
    expect(splitMessageMenuTitle('Assistant', undefined)).toBeUndefined()
    expect(splitMessageMenuTitle('Assistant', 'DeepSeek')).toBeUndefined()
  })
})
