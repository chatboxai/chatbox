import { formatSystemToolDetails } from '@shared/mobile-work/authorization-text'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { throwIfWorkAborted } from '@shared/mobile-work/abort'
import {
  createMobileSystemToolGroups,
  type MobileSystemToolsNative,
  type PickedWorkPhoto,
  type SystemToolAuthorization,
} from '@shared/mobile-work/system-tools'
import { MAX_WORKSPACE_FILE_BYTES } from '@shared/mobile-work/workspace-path'
import i18n from '@/i18n'
import { blobToBase64, CapacitorWorkspace } from './CapacitorWorkspace'
import { confirmWorkAction } from './confirmation'

type NativeValue<T> = Promise<{ value: T }>
export interface CapacitorSystemToolsPlugin {
  calendarRead(args: { start: number; end: number }): NativeValue<unknown>
  calendarSave(args: {
    id: string | null
    title: string
    start: number
    end: number
    allDay: boolean
  }): NativeValue<string>
  remindersRead(args: { completed: boolean }): NativeValue<unknown>
  reminderCreate(args: { title: string; due: number | null }): NativeValue<string>
  reminderComplete(args: { id: string; completed: boolean }): NativeValue<boolean>
  photoSave(args: { uri: string }): NativeValue<boolean>
  healthRead(args: { kind: string; start: number; end: number }): NativeValue<unknown>
}

const plugin = registerPlugin<CapacitorSystemToolsPlugin>('MobileSystemTools')

export function adaptCapacitorSystemTools(native: CapacitorSystemToolsPlugin): MobileSystemToolsNative {
  return {
    calendarRead: async (start, end) => (await native.calendarRead({ start, end })).value,
    calendarSave: async (id, title, start, end, allDay) =>
      (await native.calendarSave({ id, title, start, end, allDay })).value,
    remindersRead: async (completed) => (await native.remindersRead({ completed })).value,
    reminderCreate: async (title, due) => (await native.reminderCreate({ title, due })).value,
    reminderComplete: async (id, completed) => (await native.reminderComplete({ id, completed })).value,
    photoSave: async (uri) => (await native.photoSave({ uri })).value,
    healthRead: async (kind, start, end) => (await native.healthRead({ kind, start, end })).value,
  }
}

const readGrants = new Set<string>()

async function authorize(
  request: SystemToolAuthorization,
  sessionId: string,
  providerLabel: string,
  providerIdentity: string,
  signal?: AbortSignal,
  onAllow?: () => void
): Promise<boolean> {
  const key = JSON.stringify([sessionId, providerIdentity, request.capability, request.disclosure])
  const reusableRead =
    request.operation === 'read' && request.capability !== 'photos' && request.capability !== 'health'
  if (reusableRead && readGrants.has(key)) return true
  const labels = {
    calendar: i18n.t('Calendar'),
    reminders: i18n.t('Reminders'),
    photos: i18n.t('Photos'),
    health: i18n.t('Health'),
  }
  const disclosure =
    request.operation === 'read'
      ? request.disclosure === 'health-model'
        ? i18n.t('Health information returned by this tool will be sent to {{provider}} for this conversation.', {
            provider: providerLabel,
          })
        : i18n.t('Information returned by this tool will be sent to {{provider}} for this conversation.', {
            provider: providerLabel,
          })
      : ''
  const allowed = await confirmWorkAction(
    {
      onConfirm: onAllow,
      title: labels[request.capability],
      message: [formatSystemToolDetails(request.details, i18n.t, i18n.language), disclosure]
        .filter(Boolean)
        .join('\n\n'),
      confirmText: String(request.operation === 'write' ? i18n.t('Confirm') : i18n.t('Allow')),
      cancelText: String(i18n.t('Cancel')),
    },
    signal,
    () => reusableRead && readGrants.has(key)
  )
  if (allowed && reusableRead) readGrants.add(key)
  return allowed
}

export function pickSystemPhotoFiles(signal?: AbortSignal): Promise<File[] | null> {
  throwIfWorkAborted(signal)
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.style.display = 'none'
    let settled = false
    const finish = (files: File[] | null, error?: Error) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      input.remove()
      if (error) reject(error)
      else resolve(files)
    }
    const abort = () => finish(null, new Error('Tool execution stopped'))
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])))
    input.addEventListener('cancel', () => finish(null))
    signal?.addEventListener('abort', abort, { once: true })
    document.body.appendChild(input)
    try {
      input.click()
    } catch (error) {
      finish(null, error instanceof Error ? error : new Error('Photo picker is unavailable'))
    }
  })
}

async function compatiblePhoto(file: File): Promise<{ filename: string; blob: Blob }> {
  if (file.size > MAX_WORKSPACE_FILE_BYTES) throw new Error('Image exceeds the 10 MB execution limit')
  if (/^image\/(?:jpeg|png)$/i.test(file.type)) {
    const extension = file.type.toLowerCase() === 'image/png' ? 'png' : 'jpg'
    return { filename: `${file.name.replace(/\.[^.]*$/, '') || 'photo'}.${extension}`, blob: file }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('This image format cannot be decoded on this device'))
    })
    image.src = url
    await loaded
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32_000_000)
      throw new Error('Image dimensions are too large')
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image conversion is unavailable')
    context.drawImage(image, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Image conversion failed'))),
        'image/jpeg',
        0.9
      )
    )
    if (blob.size > MAX_WORKSPACE_FILE_BYTES) throw new Error('Image exceeds the 10 MB execution limit')
    return { filename: `${file.name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`, blob }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function createCapacitorSystemToolGroups(options: {
  sessionId: string
  providerLabel: string
  providerIdentity?: string
  workspace: CapacitorWorkspace
  signal?: AbortSignal
}) {
  const selected = new Map<string, File>()
  let photoSelection: Promise<File[] | null> | undefined
  options.signal?.addEventListener('abort', () => selected.clear(), { once: true })
  const native =
    Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('MobileSystemTools')
      ? adaptCapacitorSystemTools(plugin)
      : null
  return createMobileSystemToolGroups(
    {
      signal: options.signal,
      authorize: (request) =>
        authorize(
          request,
          options.sessionId,
          options.providerLabel,
          options.providerIdentity ?? options.providerLabel,
          options.signal,
          request.capability === 'photos' && request.operation === 'read'
            ? () => {
                photoSelection = pickSystemPhotoFiles(options.signal)
                void photoSelection.catch(() => undefined)
              }
            : undefined
        ),
      pickPhotos: async () => {
        selected.clear()
        if (!photoSelection) throw new Error('Choose photos through the confirmation button')
        const selection = photoSelection
        photoSelection = undefined
        const files = await selection
        if (!files?.length) return null
        if (files.length > 10) throw new Error('Choose up to ten photos')
        return files.map((file, index): PickedWorkPhoto => {
          const uri = `selected-photo:${index}`
          selected.set(uri, file)
          return { uri, filename: file.name, mimeType: file.type }
        })
      },
      importPhoto: async (asset) => {
        const file = selected.get(asset.uri)
        if (!file) throw new Error('Selected photo is no longer available')
        selected.delete(asset.uri)
        const { filename, blob } = await compatiblePhoto(file)
        throwIfWorkAborted(options.signal)
        return options.workspace.importPhoto(options.sessionId, { filename, base64: await blobToBase64(blob) })
      },
      preparePhotoExport: (path) => options.workspace.preparePhotoExport(options.sessionId, path),
    },
    native
  )
}
