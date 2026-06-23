import NiceModal from '@ebay/nice-modal-react'
import AppStoreRating from './AppStoreRating'
import ArtifactPreview from './ArtifactPreview'
import AttachLink from './AttachLink'
import ClearSessionList from './ClearSessionList'
import ConfirmDangerousAction from './ConfirmDangerousAction'
import ContentViewer from './ContentViewer'
import CreateGroup from './CreateGroup'
import EdgeOneDeploySuccess from './EdgeOneDeploySuccess'
import ExportChat from './ExportChat'
import FileParseError from './FileParseError'
import JsonViewer from './JsonViewer'
import MessageEdit from './MessageEdit'
import ModelEdit from './ModelEdit'
import MoveSessionToGroup from './MoveSessionToGroup'
import ReportContent from './ReportContent'
import SessionSettings from './SessionSettings'
import SessionSummary from './SessionSummary'
import SetGroupColor from './SetGroupColor'
import ThreadNameEdit from './ThreadNameEdit'
import Welcome from './Welcome'
import CopilotSettingsModal from '../routes/copilots/-components/CopilotSettingsModal'

NiceModal.register('welcome', Welcome)
NiceModal.register('file-parse-error', FileParseError)
NiceModal.register('content-viewer', ContentViewer)
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
NiceModal.register('edgeone-deploy-success', EdgeOneDeploySuccess)
NiceModal.register('copilot-settings', CopilotSettingsModal)
NiceModal.register('move-session-to-group', MoveSessionToGroup)
NiceModal.register('session-summary', SessionSummary)
NiceModal.register('create-group', CreateGroup)
NiceModal.register('set-group-color', SetGroupColor)
NiceModal.register('confirm-dangerous-action', ConfirmDangerousAction)
