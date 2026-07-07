import NiceModal from '@ebay/nice-modal-react'
import AttachLink from './AttachLink'
import ClearSessionList from './ClearSessionList'
import ContentViewer from './ContentViewer'
import ExportChat from './ExportChat'
import FileParseError from './FileParseError'
import JsonViewer from './JsonViewer'
import MessageEdit from './MessageEdit'
import ModelEdit from './ModelEdit'
import SessionSettings from './SessionSettings'
import ThreadNameEdit from './ThreadNameEdit'
import Welcome from './Welcome'
import WorkspaceEdit from './WorkspaceEdit'

NiceModal.register('welcome', Welcome)
NiceModal.register('file-parse-error', FileParseError)
NiceModal.register('content-viewer', ContentViewer)
NiceModal.register('session-settings', SessionSettings)
NiceModal.register('clear-session-list', ClearSessionList)
NiceModal.register('export-chat', ExportChat)
NiceModal.register('message-edit', MessageEdit)
NiceModal.register('json-viewer', JsonViewer)
NiceModal.register('attach-link', AttachLink)
NiceModal.register('model-edit', ModelEdit)
NiceModal.register('thread-name-edit', ThreadNameEdit)
NiceModal.register('workspace-edit', WorkspaceEdit)
