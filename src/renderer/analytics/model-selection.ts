import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS } from '@/analytics/jk-events'
import { settingsStore } from '@/stores/settingsStore'

type ModelSelectResult = 'success' | 'failed'
type UpgradeModelPosition = 'list_model' | 'upgrade_modal'

function getPlanTypeLabel() {
  const settings = settingsStore.getState()
  return settings.licenseDetail?.plan || settings.licensePlanName || settings.licenseDetail?.name
}

export function trackListModelClick(pageName: string, modelId?: string | null) {
  trackJkClickEvent(JK_EVENTS.LIST_MODEL_CLICK, {
    pageName,
    content: modelId ?? null,
    contentType: getPlanTypeLabel(),
  })
}

export function trackSelectModelClick(pageName: string, modelId: string, result: ModelSelectResult) {
  trackJkClickEvent(JK_EVENTS.SELECT_MODEL_CLICK, {
    pageName,
    content: modelId,
    contentType: getPlanTypeLabel(),
    props: {
      content_add_info: {
        content: result,
      },
    },
  })
}

export function trackUpgradeModelClick(pageName: string, position: UpgradeModelPosition, modelId: string) {
  trackJkClickEvent(JK_EVENTS.UPGRADE_MODEL_CLICK, {
    pageName,
    content: modelId,
    contentType: getPlanTypeLabel(),
    contentPosition: position,
  })
}
