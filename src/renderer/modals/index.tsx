import NiceModal from '@ebay/nice-modal-react'
import AppStoreRating from './AppStoreRating'
import ArtifactPreview from './ArtifactPreview'
import AttachLink from './AttachLink'
import ClearSessionList from './ClearSessionList'
import EdgeOneDeploySuccess from './EdgeOneDeploySuccess'
import ExportChat from './ExportChat'
import JsonViewer from './JsonViewer'
import MessageEdit from './MessageEdit'
import ModelEdit from './ModelEdit'
import OcrContentViewer from './OcrContentViewer'
import ProviderSelector from './ProviderSelector'
import ReportContent from './ReportContent'
import SessionSettings from './SessionSettings'
import ThreadNameEdit from './ThreadNameEdit'
import Welcome from './Welcome'

NiceModal.register('welcome', Welcome)
NiceModal.register('provider-selector', ProviderSelector)
NiceModal.register('session-settings', SessionSettings)
NiceModal.register('app-store-rating', AppStoreRating)
NiceModal.register('artifact-preview', ArtifactPreview)
NiceModal.register('clear-session-list', ClearSessionList)
NiceModal.register('export-chat', ExportChat)
NiceModal.register('message-edit', MessageEdit)
NiceModal.register('json-viewer', JsonViewer)
NiceModal.register('attach-link', AttachLink)
NiceModal.register('report-content', ReportContent)
NiceModal.register('model-edit', ModelEdit)
NiceModal.register('thread-name-edit', ThreadNameEdit)
NiceModal.register('ocr-content-viewer', OcrContentViewer)
NiceModal.register('edgeone-deploy-success', EdgeOneDeploySuccess)
