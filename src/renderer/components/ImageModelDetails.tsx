import { Stack } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import type { ImageModelGroup } from '@/hooks/useImageModelGroups'
import type { ImageModelOption } from '@/packages/image-model-catalog'
import { useOverlayManager } from './layout/Overlay'
import { DRAWER_SURFACE_STYLE, MODEL_SELECTOR_SURFACE_CLASS } from './ModelSelectorV2/constants'
import { DetailCard } from './ModelSelectorV2/DetailCard'
import type { DetailModel } from './ModelSelectorV2/types'

export function getImageModelDetail(group: ImageModelGroup, model: ImageModelOption): DetailModel {
  return {
    providerId: group.providerId,
    providerName: group.label,
    modelId: model.modelId,
    name: model.displayName,
    description: model.description?.trim() || undefined,
    type: 'image',
  }
}

export function ImageModelDetailDrawer({
  model,
  onClose,
  onRestoreFocus,
}: {
  model: DetailModel | null
  onClose: () => void
  onRestoreFocus: () => void
}) {
  const { t } = useTranslation()
  const isTopOverlay = useOverlayManager(!!model)
  return (
    <Drawer.Root open={!!model} onOpenChange={(open) => !open && onClose()} noBodyStyles autoFocus>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 outline-none"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            onRestoreFocus()
          }}
          onEscapeKeyDown={(event) => {
            if (!isTopOverlay) event.preventDefault()
          }}
        >
          <Stack
            gap={0}
            className={`rounded-t-[16px] border border-b-0 border-solid ${MODEL_SELECTOR_SURFACE_CLASS}`}
            style={DRAWER_SURFACE_STYLE}
          >
            <div aria-hidden className="mx-auto my-3 h-1 w-14 rounded-full bg-chatbox-tint-tertiary opacity-70" />
            <Drawer.Title className="hidden">{t('Model details')}</Drawer.Title>
            {model && <DetailCard model={model} onClose={onClose} mobile />}
            <div className="h-[--mobile-safe-area-inset-bottom] min-h-4" />
          </Stack>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
