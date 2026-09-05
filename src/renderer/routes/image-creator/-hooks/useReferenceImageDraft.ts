import { useCallback, useEffect, useRef, useState } from 'react'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import { getLogger } from '@/lib/utils'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { queryClient } from '@/stores/queryClient'
import { MAX_REFERENCE_IMAGES } from '../-components/constants'

const log = getLogger('reference-image-draft')

interface ReferenceImage {
  storageKey: string
  sourceRecordId?: string
}

interface SubmissionOwner {
  state: 'submitting'
}

export function useReferenceImageDraft() {
  const [images, setImages] = useState<ReferenceImage[]>([])
  const draft = useRef({
    images: [] as ReferenceImage[],
    uploads: new Map<string, 'draft' | SubmissionOwner>(),
    revision: 0,
    uploadEpoch: 0,
    mounted: true,
  })

  const updateImages = useCallback((next: ReferenceImage[]) => {
    draft.current.images = next
    draft.current.revision += 1
    if (draft.current.mounted) setImages(next)
  }, [])

  const removeBlobs = useCallback(async (keys: string[]) => {
    await Promise.all(
      keys.map(async (key) => {
        try {
          await currentBlobStorage.remove(key)
        } catch (error) {
          log.error('Failed to clean up a reference image:', error)
        }
      })
    )
  }, [])

  const replace = useCallback(
    (next: ReferenceImage[]) => {
      const retained = new Set(next.map((image) => image.storageKey))
      const keys: string[] = []
      for (const [key, owner] of draft.current.uploads) {
        if (owner === 'draft' && !retained.has(key)) {
          draft.current.uploads.delete(key)
          keys.push(key)
        }
      }
      draft.current.uploadEpoch += 1
      updateImages(next)
      return removeBlobs(keys)
    },
    [removeBlobs, updateImages]
  )

  const clear = useCallback(() => replace([]), [replace])

  useEffect(() => {
    draft.current.mounted = true
    return () => {
      draft.current.mounted = false
      void clear()
    }
  }, [clear])

  const addReference = useCallback(
    (storageKey: string, sourceRecordId?: string) => {
      const current = draft.current.images
      if (current.length >= MAX_REFERENCE_IMAGES || current.some((image) => image.storageKey === storageKey)) return
      updateImages([...current, { storageKey, sourceRecordId }])
    },
    [updateImages]
  )

  const removeReference = useCallback(
    (storageKey: string) => {
      updateImages(draft.current.images.filter((image) => image.storageKey !== storageKey))
      if (draft.current.uploads.get(storageKey) === 'draft') {
        draft.current.uploads.delete(storageKey)
        void removeBlobs([storageKey])
      }
    },
    [removeBlobs, updateImages]
  )

  const upload = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return
      const epoch = draft.current.uploadEpoch
      const available = MAX_REFERENCE_IMAGES - draft.current.images.length
      for (const file of Array.from(files)
        .filter((file) => file.type.startsWith('image/'))
        .slice(0, available)) {
        const reader = new FileReader()
        reader.onload = async () => {
          if (typeof reader.result !== 'string') return
          const storageKey = StorageKeyGenerator.picture('image-creator-ref')
          try {
            await currentBlobStorage.set(storageKey, reader.result)
          } catch (error) {
            log.error('Failed to store a reference image:', error)
            return
          }
          if (
            !draft.current.mounted ||
            draft.current.uploadEpoch !== epoch ||
            draft.current.images.length >= MAX_REFERENCE_IMAGES
          ) {
            await removeBlobs([storageKey])
            return
          }
          queryClient.setQueryData(['blob', storageKey], reader.result)
          draft.current.uploads.set(storageKey, 'draft')
          addReference(storageKey)
        }
        reader.onerror = () => log.error('Failed to read a reference image:', file.name)
        reader.readAsDataURL(file)
      }
    },
    [addReference, removeBlobs]
  )

  const beginSubmission = useCallback(() => {
    const submitted = draft.current.images
    const revision = draft.current.revision
    const owner: SubmissionOwner = { state: 'submitting' }
    const keys = submitted.map((image) => image.storageKey).filter((key) => draft.current.uploads.get(key) === 'draft')
    for (const key of keys) draft.current.uploads.set(key, owner)
    let committed = false

    return {
      referenceImages: submitted.map((image) => image.storageKey),
      parentIds: [...new Set(submitted.map((image) => image.sourceRecordId).filter((id): id is string => !!id))],
      commit() {
        committed = true
        for (const key of keys) {
          if (draft.current.uploads.get(key) === owner) draft.current.uploads.delete(key)
        }
      },
      async rollback() {
        if (committed) return
        const selected = new Set(draft.current.images.map((image) => image.storageKey))
        const unowned: string[] = []
        for (const key of keys) {
          if (draft.current.uploads.get(key) !== owner) continue
          if (draft.current.mounted && selected.has(key)) {
            draft.current.uploads.set(key, 'draft')
          } else {
            draft.current.uploads.delete(key)
            unowned.push(key)
          }
        }
        await removeBlobs(unowned)
      },
      complete() {
        if (!committed || !draft.current.mounted || draft.current.revision !== revision) return false
        void clear()
        return true
      },
    }
  }, [clear, removeBlobs])

  return { images, upload, addReference, removeReference, replace, clear, beginSubmission }
}
